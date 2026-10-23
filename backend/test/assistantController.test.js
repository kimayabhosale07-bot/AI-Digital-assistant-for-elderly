const test = require('node:test');
const assert = require('node:assert/strict');
const { chatWithAssistant, transcribeAssistantAudio, getAudioFileType, MAX_AUDIO_BYTES, parseModelResponse, safePatientContext, safeConversation, safeProviderErrorDetails, getGeminiTimeoutMs, classifyGeminiFailure, getAssistantProviders, buildProviderRequest, parseProviderResponse } = require('../src/controllers/assistantController');

function request(ip, body) { return { ip, body, socket: { remoteAddress: ip } }; }
function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('missing provider configuration returns a friendly fallback without claiming a record answer', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousGroqKey = process.env.GROQ_API_KEY;
  const previousProvider = process.env.ASSISTANT_PROVIDER;
  const originalFetch = global.fetch;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  process.env.ASSISTANT_PROVIDER = 'auto';
  global.fetch = async () => { throw new Error('fetch should not be called'); };
  try {
    const res = response();
    await chatWithAssistant(request('assistant-test-no-key', { messages: [{ role: 'user', content: 'What medicine do I take?' }] }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.unavailable, true);
    assert.equal(res.body.reason, 'not_configured');
    assert.equal(res.body.action, null);
    assert.match(res.body.reply, /no live ai provider is configured/i);
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousGroqKey;
    if (previousProvider === undefined) delete process.env.ASSISTANT_PROVIDER;
    else process.env.ASSISTANT_PROVIDER = previousProvider;
  }
});

test('conversation response is parsed into a draft action, never a save operation', () => {
  const parsed = parseModelResponse({
    candidates: [{ content: { parts: [{ text: '{"reply":"Please confirm this schedule.","action":{"type":"add_medicine","fields":{"medicineName":"Dolo 650","dosage":"one tablet","time":"08:00","frequency":"daily"}}}' }] } }],
  });
  assert.equal(parsed.action.type, 'add_medicine');
  assert.equal(parsed.action.fields.medicineName, 'Dolo 650');
  assert.match(parsed.reply, /confirm/i);
});

test('patient context is reduced to known medication and appointment fields', () => {
  const context = safePatientContext({
    medicines: [{ medId: 'med-1', medicineName: 'Medicine', dosage: '1 tablet', time: '08:00', frequency: 'daily', todayStatus: 'pending', secret: 'not forwarded' }],
    appointments: [{ doctorName: 'Dr. Example', date: '2026-10-24', time: '17:00', location: 'Clinic', phone: 'not forwarded' }],
    extra: 'not forwarded',
  });
  assert.deepEqual(Object.keys(context.medicines[0]).sort(), ['dosage', 'frequency', 'id', 'name', 'time', 'todayStatus']);
  assert.deepEqual(Object.keys(context.appointments[0]).sort(), ['date', 'doctor', 'location', 'time']);
  assert.equal(context.medicinesAvailable, true);
  assert.equal(context.appointmentsAvailable, true);
  const unavailable = safePatientContext({ medicines: null, appointments: [] });
  assert.equal(unavailable.medicinesAvailable, false);
  assert.equal(unavailable.appointmentsAvailable, true);
});

test('Gemini conversation omits the initial assistant prefill and ends on the latest user turn', () => {
  const contents = safeConversation([
    { role: 'assistant', content: 'Hello from the local greeting.' },
    { role: 'user', content: 'Add my medicine.' },
    { role: 'assistant', content: 'What dosage?' },
    { role: 'user', content: 'I do not know the dose yet.' },
  ]);
  assert.equal(contents[0].role, 'user');
  assert.equal(contents.at(-1).role, 'user');
  assert.equal(contents.length, 3);
});

test('provider error diagnostics retain status/message and redact keys and patient text', () => {
  const details = safeProviderErrorDetails({
    error: {
      code: 400,
      status: 'INVALID_ARGUMENT',
      message: 'Invalid request for API key AQ.fake-secret and patient Meftal 10 mg.',
    },
  }, 400, 'AQ.fake-secret', {
    messages: [{ role: 'user', content: 'Meftal 10 mg' }],
    context: { medicines: [{ name: 'Meftal', dosage: '10 mg' }] },
  });
  assert.equal(details.httpStatus, 400);
  assert.equal(details.providerStatus, 'INVALID_ARGUMENT');
  assert.equal(details.providerCode, 400);
  assert.doesNotMatch(details.message, /AQ\.fake-secret|Meftal|10 mg/);
  assert.match(details.message, /\[redacted\]/);
});

test('Gemini request uses the supported GenerateContent structure without deprecated temperature', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  const previousProvider = process.env.ASSISTANT_PROVIDER;
  const originalFetch = global.fetch;
  const originalInfo = console.info;
  let requestUrl;
  let requestOptions;
  const timingLogs = [];
  process.env.GEMINI_API_KEY = 'test-only-key';
  process.env.GEMINI_MODEL = 'gemini-3.8-flash';
  process.env.ASSISTANT_PROVIDER = 'gemini';
  console.info = (message, details) => { timingLogs.push({ message, details }); };
  global.fetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"reply":"Hello there.","action":null}' }] } }] }),
    };
  };
  try {
    const res = response();
    await chatWithAssistant(request('assistant-test-request-shape', {
      messages: [
        { role: 'assistant', content: 'Local greeting.' },
        { role: 'user', content: 'Hello.' },
      ],
      patientContext: { medicines: [], appointments: [] },
    }), res);
    const body = JSON.parse(requestOptions.body);
    assert.equal(requestUrl, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    assert.equal(requestOptions.headers['x-goog-api-key'], 'test-only-key');
    assert.equal(body.contents[0].role, 'user');
    assert.equal(body.contents.at(-1).role, 'user');
    assert.deepEqual(body.generationConfig, { responseMimeType: 'application/json', maxOutputTokens: 700 });
    assert.equal(res.body.unavailable, false);
    assert.deepEqual(timingLogs.map(log => log.message), [
      '[Assistant] Live provider request started:',
      '[Assistant] Live provider response headers received:',
      '[Assistant] Live provider request completed:',
    ]);
    assert.equal(timingLogs[1].details.httpStatus, 200);
    assert.equal(typeof timingLogs[1].details.elapsedMs, 'number');
    assert.equal(JSON.stringify(timingLogs).includes('Hello.'), false);
    assert.equal(JSON.stringify(timingLogs).includes('test-only-key'), false);
  } finally {
    global.fetch = originalFetch;
    console.info = originalInfo;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
    if (previousProvider === undefined) delete process.env.ASSISTANT_PROVIDER;
    else process.env.ASSISTANT_PROVIDER = previousProvider;
  }
});

test('Gemini timeout is configurable, defaults to 30 seconds, and is capped at 60 seconds', () => {
  assert.equal(getGeminiTimeoutMs(undefined), 30_000);
  assert.equal(getGeminiTimeoutMs('45000'), 45_000);
  assert.equal(getGeminiTimeoutMs('90000'), 60_000);
  assert.equal(getGeminiTimeoutMs('invalid'), 30_000);
  assert.equal(getGeminiTimeoutMs('500'), 1_000);
});

test('Gemini failure classifier distinguishes timeout, network, HTTP, and invalid-key failures', () => {
  assert.equal(classifyGeminiFailure({ error: Object.assign(new Error('timeout'), { name: 'TimeoutError' }) }), 'timeout');
  assert.equal(classifyGeminiFailure({ error: Object.assign(new TypeError('fetch failed'), { code: 'ECONNRESET' }) }), 'network_error');
  assert.equal(classifyGeminiFailure({ httpStatus: 503, providerStatus: 'UNAVAILABLE' }), 'service_unavailable');
  assert.equal(classifyGeminiFailure({ httpStatus: 400, providerStatus: 'INVALID_ARGUMENT', providerMessage: 'API key not valid.' }), 'invalid_api_key');
});

test('OpenAI adapter builds a server-only JSON chat request and parses its response', () => {
  const provider = { name: 'openai', key: 'server-only-key', model: 'gpt-4.1-mini', endpoint: 'https://api.openai.com/v1/chat/completions' };
  const request = buildProviderRequest(provider, 'Carewise safety instructions.', [{ role: 'user', content: 'Hello.' }], 5000);
  assert.equal(request.url, provider.endpoint);
  assert.equal(request.headers.Authorization, 'Bearer server-only-key');
  assert.equal(request.body.model, 'gpt-4.1-mini');
  assert.deepEqual(request.body.messages.map(message => message.role), ['system', 'user']);
  assert.deepEqual(request.body.response_format, { type: 'json_object' });
  assert.equal(request.body.max_completion_tokens, 700);
  assert.deepEqual(parseProviderResponse('openai', {
    choices: [{ message: { content: '{"reply":"Hello there.","action":null}' } }],
  }), { reply: 'Hello there.', action: null });
});

test('Groq adapter builds and parses a chat completion with the configured supported model', () => {
  const provider = { name: 'groq', key: 'server-only-groq-key', model: 'openai/gpt-oss-20b', endpoint: 'https://api.groq.com/openai/v1/chat/completions' };
  const request = buildProviderRequest(provider, 'Carewise safety instructions.', [{ role: 'user', content: 'Hello.' }], 5000);
  assert.equal(request.url, provider.endpoint);
  assert.equal(request.headers.Authorization, 'Bearer server-only-groq-key');
  assert.equal(request.body.model, 'openai/gpt-oss-20b');
  assert.deepEqual(request.body.response_format, { type: 'json_object' });
  assert.deepEqual(parseProviderResponse('groq', {
    choices: [{ message: { content: '{"reply":"Hello there.","action":null}' } }],
  }), { reply: 'Hello there.', action: null });
});

test('Groq assistant reply returns a draft action without saving and does not retry quota failures', async () => {
  const previous = Object.fromEntries(['ASSISTANT_PROVIDER', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY'].map(name => [name, process.env[name]]));
  const originalFetch = global.fetch;
  const originalInfo = console.info;
  const originalError = console.error;
  let calls = 0;
  process.env.ASSISTANT_PROVIDER = 'groq';
  delete process.env.GEMINI_API_KEY;
  process.env.GROQ_API_KEY = 'test-only-groq-key';
  delete process.env.OPENAI_API_KEY;
  console.info = () => {};
  console.error = () => {};
  try {
    global.fetch = async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"reply":"Please review and confirm these details.","action":{"type":"add_medicine","fields":{"medicineName":"Example medicine"}}}' } }] }) };
    };
    const res = response();
    // Avoid the deterministic missing-field medicine workflow; this test covers
    // the Groq provider adapter and confirms that model actions remain drafts.
    await chatWithAssistant(request('assistant-test-groq-action', { messages: [{ role: 'user', content: 'What should I consider before taking a medicine?' }] }), res);
    assert.equal(calls, 1);
    assert.equal(res.body.provider, 'groq');
    assert.equal(res.body.action.type, 'add_medicine');
    assert.match(res.body.reply, /confirm/i);
    assert.equal(res.body.saved, undefined);

    calls = 0;
    global.fetch = async () => {
      calls += 1;
      return { ok: false, status: 429, json: async () => ({ error: { message: 'Rate limit exceeded.' } }) };
    };
    const limited = response();
    await chatWithAssistant(request('assistant-test-groq-quota', { messages: [{ role: 'user', content: 'Hello.' }] }), limited);
    assert.equal(calls, 1);
    assert.equal(limited.body.unavailable, true);
    assert.equal(limited.body.reason, 'quota_exceeded');
    assert.equal(limited.body.action, null);

    calls = 0;
    global.fetch = async () => {
      calls += 1;
      return { ok: false, status: 503, json: async () => ({ error: { message: 'Temporary provider outage.' } }) };
    };
    const unavailable = response();
    await chatWithAssistant(request('assistant-test-groq-outage', { messages: [{ role: 'user', content: 'Hello again.' }] }), unavailable);
    assert.equal(calls, 1);
    assert.equal(unavailable.body.unavailable, true);
    assert.equal(unavailable.body.reason, 'service_unavailable');
    assert.equal(unavailable.body.action, null);
  } finally {
    global.fetch = originalFetch;
    console.info = originalInfo;
    console.error = originalError;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('Groq transcription uploads validated audio using the configured backend key and Whisper model', async () => {
  const previous = Object.fromEntries(['GROQ_API_KEY', 'GROQ_STT_MODEL', 'GROQ_REQUEST_TIMEOUT_MS'].map(name => [name, process.env[name]]));
  const originalFetch = global.fetch;
  const originalInfo = console.info;
  let requestOptions;
  process.env.GROQ_API_KEY = 'test-only-groq-key';
  process.env.GROQ_STT_MODEL = 'whisper-large-v3-turbo';
  global.fetch = async (url, options) => {
    requestOptions = options;
    assert.equal(url, 'https://api.groq.com/openai/v1/audio/transcriptions');
    return { ok: true, status: 200, json: async () => ({ text: 'Please remind me about my medicine.' }) };
  };
  console.info = () => {};
  try {
    const audioReq = { ...request('assistant-test-groq-transcription'), body: Buffer.from('mock-audio'), headers: { 'content-type': 'audio/webm;codecs=opus' }, get(name) { return this.headers[name]; } };
    const res = response();
    await transcribeAssistantAudio(audioReq, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.text, 'Please remind me about my medicine.');
    assert.equal(requestOptions.headers.Authorization, 'Bearer test-only-groq-key');
    assert.equal(requestOptions.body.get('model'), 'whisper-large-v3-turbo');
    assert.equal(requestOptions.body.get('response_format'), 'json');
    assert.equal(requestOptions.body.get('file').type, 'audio/webm');
  } finally {
    global.fetch = originalFetch;
    console.info = originalInfo;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('Groq transcription validates audio and returns clear missing-key and empty-transcript errors', async () => {
  const previousKey = process.env.GROQ_API_KEY;
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls += 1; return { ok: true, status: 200, json: async () => ({ text: '  ' }) }; };
  try {
    const badType = response();
    await transcribeAssistantAudio({ ...request('assistant-test-audio-type'), body: Buffer.from('audio'), headers: { 'content-type': 'application/octet-stream' } }, badType);
    assert.equal(badType.statusCode, 415);
    assert.equal(fetchCalls, 0);

    delete process.env.GROQ_API_KEY;
    const missingKey = response();
    await transcribeAssistantAudio({ ...request('assistant-test-audio-key'), body: Buffer.from('audio'), headers: { 'content-type': 'audio/webm' } }, missingKey);
    assert.equal(missingKey.statusCode, 503);
    assert.match(missingKey.body.error, /GROQ_API_KEY/);

    process.env.GROQ_API_KEY = 'test-only-groq-key';
    const emptyTranscript = response();
    await transcribeAssistantAudio({ ...request('assistant-test-audio-empty'), body: Buffer.from('audio'), headers: { 'content-type': 'audio/webm' } }, emptyTranscript);
    assert.equal(emptyTranscript.statusCode, 422);
    assert.match(emptyTranscript.body.error, /No speech was recognized/);
    assert.equal(fetchCalls, 1);
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
  }
});

test('Groq transcription reports rate limiting without retrying', async () => {
  const previousKey = process.env.GROQ_API_KEY;
  const originalFetch = global.fetch;
  let calls = 0;
  process.env.GROQ_API_KEY = 'test-only-groq-key';
  global.fetch = async () => {
    calls += 1;
    return { ok: false, status: 429, json: async () => ({ error: { message: 'Rate limit exceeded.' } }) };
  };
  try {
    const res = response();
    await transcribeAssistantAudio({ ...request('assistant-test-audio-quota'), body: Buffer.from('mock-audio'), headers: { 'content-type': 'audio/webm' } }, res);
    assert.equal(calls, 1);
    assert.equal(res.statusCode, 429);
    assert.match(res.body.error, /rate or usage limit/i);
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
  }
});

test('Groq transcription returns bounded timeout, authentication, and network errors without retries', async () => {
  const previousKey = process.env.GROQ_API_KEY;
  const originalFetch = global.fetch;
  process.env.GROQ_API_KEY = 'test-only-groq-key';
  let calls = 0;
  try {
    for (const [mockFetch, expectedStatus, expectedText] of [
      [async () => { calls += 1; throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }, 504, /too long/i],
      [async () => { calls += 1; return { ok: false, status: 401, json: async () => ({}) }; }, 503, /could not authenticate/i],
      [async () => { calls += 1; throw new TypeError('network failure'); }, 502, /could not connect/i],
    ]) {
      calls = 0;
      global.fetch = mockFetch;
      const res = response();
      await transcribeAssistantAudio({ ...request(`assistant-test-audio-failure-${expectedStatus}`), body: Buffer.from('mock-audio'), headers: { 'content-type': 'audio/webm' } }, res);
      assert.equal(res.statusCode, expectedStatus);
      assert.match(res.body.error, expectedText);
      assert.equal(calls, 1);
    }
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
  }
});

test('Groq transcription rejects oversized clips and recognizes supported audio MIME types', async () => {
  assert.equal(MAX_AUDIO_BYTES, 10 * 1024 * 1024);
  assert.equal(getAudioFileType('audio/webm;codecs=opus'), 'webm');
  assert.equal(getAudioFileType('audio/ogg'), 'ogg');
  assert.equal(getAudioFileType('audio/mp4'), 'm4a');
  assert.equal(getAudioFileType('image/png'), null);
  const previousKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'test-only-groq-key';
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('Oversized audio must not be uploaded.'); };
  try {
    const res = response();
    await transcribeAssistantAudio({ ...request('assistant-test-audio-size'), body: Buffer.alloc(MAX_AUDIO_BYTES + 1), headers: { 'content-type': 'audio/webm' } }, res);
    assert.equal(res.statusCode, 413);
    assert.match(res.body.error, /10 MB/);
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
  }
});

test('automatic provider selection tries Gemini then the configured Groq fallback', async () => {
  const previousEnv = Object.fromEntries(['GEMINI_API_KEY', 'GEMINI_MODEL', 'GROQ_API_KEY', 'GROQ_CHAT_MODEL', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'ASSISTANT_PROVIDER', 'GEMINI_REQUEST_TIMEOUT_MS'].map(name => [name, process.env[name]]));
  const originalFetch = global.fetch;
  const originalError = console.error;
  const originalInfo = console.info;
  const calls = [];
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  process.env.GEMINI_MODEL = 'gemini-test-model';
  process.env.GROQ_API_KEY = 'groq-test-key';
  process.env.GROQ_CHAT_MODEL = 'openai/gpt-oss-20b';
  delete process.env.OPENAI_API_KEY;
  process.env.ASSISTANT_PROVIDER = 'auto';
  process.env.GEMINI_REQUEST_TIMEOUT_MS = '5000';
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('generativelanguage.googleapis.com')) return {
      ok: false,
      status: 429,
      json: async () => ({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded.' } }),
    };
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"reply":"I am here to help.","action":null}' } }] }),
    };
  };
  console.error = () => {};
  console.info = () => {};
  try {
    assert.deepEqual(getAssistantProviders().providers.map(provider => provider.name), ['gemini', 'groq']);
    const res = response();
    await chatWithAssistant(request('assistant-test-provider-failover', {
      messages: [{ role: 'user', content: 'A private test transcript.' }],
    }), res);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /generativelanguage\.googleapis\.com/);
    assert.equal(calls[1].url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(calls[1].options.headers.Authorization, 'Bearer groq-test-key');
    const groqBody = JSON.parse(calls[1].options.body);
    assert.equal(groqBody.model, 'openai/gpt-oss-20b');
    assert.equal(groqBody.messages.at(-1).content, 'A private test transcript.');
    assert.equal(res.body.mode, 'live');
    assert.equal(res.body.provider, 'groq');
    assert.equal(res.body.reply, 'I am here to help.');
    assert.equal(JSON.stringify(calls.map(call => call.url)).includes('test-key'), false);
  } finally {
    global.fetch = originalFetch;
    console.error = originalError;
    console.info = originalInfo;
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('timed-out Gemini fetch returns a clean fallback and logs no request content', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousTimeout = process.env.GEMINI_REQUEST_TIMEOUT_MS;
  const previousProvider = process.env.ASSISTANT_PROVIDER;
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  let observedSignal;
  let loggedDetails;
  process.env.GEMINI_API_KEY = 'test-only-key';
  process.env.ASSISTANT_PROVIDER = 'gemini';
  process.env.GEMINI_REQUEST_TIMEOUT_MS = '1000';
  global.fetch = async (_url, options) => {
    observedSignal = options.signal;
    return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  };
  console.warn = (_message, details) => { loggedDetails = details; };
  console.info = () => {};
  try {
    const res = response();
    await chatWithAssistant(request('assistant-test-timeout', {
      messages: [{ role: 'user', content: 'Private medicine detail must not appear in logs.' }],
    }), res);
    assert.equal(res.body.unavailable, true);
    assert.equal(res.body.reason, 'timeout');
    assert.equal(observedSignal.aborted, true);
    assert.equal(loggedDetails.timeoutMs, 1_000);
    assert.equal(loggedDetails.errorName, 'TimeoutError');
    assert.equal(JSON.stringify(loggedDetails).includes('Private medicine detail'), false);
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
    console.info = originalInfo;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousProvider === undefined) delete process.env.ASSISTANT_PROVIDER;
    else process.env.ASSISTANT_PROVIDER = previousProvider;
    if (previousTimeout === undefined) delete process.env.GEMINI_REQUEST_TIMEOUT_MS;
    else process.env.GEMINI_REQUEST_TIMEOUT_MS = previousTimeout;
  }
});

test('Gemini quota and service errors return clear demo-mode guidance without retrying', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousTimeout = process.env.GEMINI_REQUEST_TIMEOUT_MS;
  const previousProvider = process.env.ASSISTANT_PROVIDER;
  const originalFetch = global.fetch;
  const originalError = console.error;
  const originalInfo = console.info;
  process.env.GEMINI_API_KEY = 'test-only-key';
  process.env.ASSISTANT_PROVIDER = 'gemini';
  process.env.GEMINI_REQUEST_TIMEOUT_MS = '5000';
  global.fetch = async () => { throw new Error('Each test response must be configured below.'); };
  console.error = () => {};
  console.info = () => {};
  try {
    for (const [status, providerStatus, expectedReason, expectedCopy] of [
      [429, 'RESOURCE_EXHAUSTED', 'quota_exceeded', /quota/i],
      [503, 'UNAVAILABLE', 'service_unavailable', /temporarily unavailable/i],
    ]) {
      let requestCalls = 0;
      global.fetch = async () => {
        requestCalls += 1;
        return {
          ok: false,
          status,
          json: async () => ({ error: { code: status, status: providerStatus, message: 'Temporary provider response.' } }),
        };
      };
      const res = response();
      await chatWithAssistant(request(`assistant-test-provider-${status}`, {
        messages: [{ role: 'user', content: 'Hello.' }],
      }), res);
      assert.equal(requestCalls, 1);
      assert.equal(res.body.reason, expectedReason);
      assert.equal(res.body.unavailable, true);
      assert.equal(res.body.demoModeAvailable, true);
      assert.equal(res.body.action, null);
      assert.match(res.body.reply, expectedCopy);
    }

    let invalidRequestCalls = 0;
    global.fetch = async () => {
      invalidRequestCalls += 1;
      return { ok: false, status: 400, json: async () => ({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Malformed request.' } }) };
    };
    const invalidRes = response();
    await chatWithAssistant(request('assistant-test-invalid-no-demo', {
      messages: [{ role: 'user', content: 'Hello.' }],
    }), invalidRes);
    assert.equal(invalidRequestCalls, 1);
    assert.equal(invalidRes.body.reason, 'http_400');
    assert.equal(invalidRes.body.demoModeAvailable, false);
  } finally {
    global.fetch = originalFetch;
    console.error = originalError;
    console.info = originalInfo;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousProvider === undefined) delete process.env.ASSISTANT_PROVIDER;
    else process.env.ASSISTANT_PROVIDER = previousProvider;
    if (previousTimeout === undefined) delete process.env.GEMINI_REQUEST_TIMEOUT_MS;
    else process.env.GEMINI_REQUEST_TIMEOUT_MS = previousTimeout;
  }
});
