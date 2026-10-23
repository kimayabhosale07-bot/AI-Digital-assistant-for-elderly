const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const DEFAULT_GEMINI_TIMEOUT_MS = 30_000;
const MAX_GEMINI_TIMEOUT_MS = 60_000;
const crypto = require('crypto');
const {
  getMissingMedicineFields,
  extractMedicineDetails,
  hasMedicineSchedulingIntent,
  isMedicineWorkflowReply,
  isMedicineFieldReply,
  createMedicineDraftId,
  verifyMedicineDraftId,
  createPendingMedicineAction,
} = require('./assistantMedicineActions');
let requestSequence = 0;
const requestWindows = new Map();
const ALLOWED_ACTIONS = new Set(['none', 'add_medicine', 'add_appointment', 'mark_taken']);

function hasAppointmentSchedulingIntent(message) {
  return /\b(?:add|schedule|book|create|set up)\b/i.test(message)
    && /\b(?:appointment|doctor|visit|clinic)\b|\bDr\.?\s/i.test(message);
}

function extractAppointmentDetails(messages) {
  const text = messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
  const visitProvider = text.match(/\bvisit\s+(Dr\.?\s+[A-Z][A-Za-z.'-]*(?:\s+(?!Dr\b|visit\b|appointment\b|on\b|at\b|in\b)[A-Z][A-Za-z.'-]*)?)/i)?.[1];
  const doctorMatches = [...text.matchAll(/\bDr\.?\s+[A-Z][A-Za-z.'-]*(?:\s+(?!Dr\b|visit\b|appointment\b|on\b|at\b|in\b)[A-Z][A-Za-z.'-]*)?/gi)];
  const doctorName = (visitProvider || doctorMatches.at(-1)?.[0] || '').replace(/\s+/g, ' ').trim();
  let date = '';
  const namedDate = text.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i)
    || text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (namedDate) {
    const day = Number(namedDate[1].match(/^\d/) ? namedDate[1] : namedDate[2]);
    const monthName = namedDate[1].match(/^\d/) ? namedDate[2] : namedDate[1];
    const year = Number(namedDate[1].match(/^\d/) ? namedDate[3] : namedDate[3]);
    const month = new Date(`${monthName} 1, ${year}`).getMonth() + 1;
    const valid = new Date(Date.UTC(year, month - 1, day));
    if (valid.getUTCFullYear() === year && valid.getUTCMonth() === month - 1 && valid.getUTCDate() === day) {
      date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  } else {
    date = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] || '';
  }
  const clock = text.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  const time = clock
    ? `${String((Number(clock[1]) % 12) + (clock[3].toLowerCase().startsWith('p') ? 12 : 0)).padStart(2, '0')}:${clock[2] || '00'}`
    : text.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/)?.[0] || '';
  const locationReply = messages.filter(message => message.role === 'user').at(-1)?.content?.trim() || '';
  const standaloneLocation = /^[A-Z][A-Za-z .,'-]{1,100}$/.test(locationReply)
    && !/\b(?:appointment|visit|doctor|Dr\.?|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b/i.test(locationReply)
    ? locationReply
    : '';
  const location = text.match(/\b(?:address|location)\s*[:,-]?\s*([^\n.!?]+)/i)?.[1]?.trim()
    || standaloneLocation
    || text.match(/\bin\s+([A-Z][\w ,'-]+(?:,\s*[A-Z][\w '-]+)*)\s*$/i)?.[1]?.trim()
    || '';
  return { doctorName, date, time, location };
}

function getMissingAppointmentFields(fields) {
  return [!fields.doctorName && 'doctor name', !fields.date && 'date', !fields.time && 'exact time', !fields.location && 'address or location'].filter(Boolean);
}

function safeText(value, maxLength = 300) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function getGeminiTimeoutMs(value = process.env.GEMINI_REQUEST_TIMEOUT_MS) {
  const configured = Number(value);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_GEMINI_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(configured), 1_000), MAX_GEMINI_TIMEOUT_MS);
}

function classifyGeminiFailure({ error, httpStatus, providerStatus, providerMessage } = {}) {
  if (httpStatus) {
    if (httpStatus === 429) return 'quota_exceeded';
    if (httpStatus === 503) return 'service_unavailable';
    const providerSaysInvalidKey = /api key (is )?(not valid|invalid)|invalid api key|incorrect api key/i.test(providerMessage || '');
    if (providerSaysInvalidKey || providerStatus === 'UNAUTHENTICATED' || providerStatus === 'invalid_api_key') return 'invalid_api_key';
    return `http_${httpStatus}`;
  }
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
  if (error instanceof TypeError || /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_)/.test(error?.code || '')) return 'network_error';
  return 'request_error';
}

function takeRateLimitSlot(key) {
  const now = Date.now();
  const window = requestWindows.get(key);
  if (!window || now - window.startedAt >= WINDOW_MS) {
    requestWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (window.count >= MAX_REQUESTS_PER_WINDOW) return false;
  window.count += 1;
  return true;
}

function safeConversation(messages) {
  const recent = messages.slice(-10).map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: safeText(message.content, 1200) }],
  }));
  const lastUser = recent.findLastIndex(message => message.role === 'user');
  if (lastUser < 0) return [];
  const conversationThroughLatestUser = recent.slice(0, lastUser + 1);
  const firstUser = conversationThroughLatestUser.findIndex(message => message.role === 'user');
  return conversationThroughLatestUser.slice(firstUser);
}

function collectSensitiveStrings(value, output = []) {
  if (typeof value === 'string') {
    if (value.length >= 3) output.push(value);
  } else if (Array.isArray(value)) {
    value.forEach(item => collectSensitiveStrings(item, output));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectSensitiveStrings(item, output));
  }
  return output;
}

function safeProviderErrorDetails(body, httpStatus, apiKey, requestData) {
  const providerError = body?.error && typeof body.error === 'object' ? body.error : {};
  const providerCode = typeof providerError.code === 'string' ? safeText(providerError.code, 80) : undefined;
  let message = safeText(providerError.message, 1200);
  const redactions = [...new Set([
    apiKey,
    ...collectSensitiveStrings(requestData),
  ].filter(value => typeof value === 'string' && value.length >= 3))].sort((a, b) => b.length - a.length);
  for (const secret of redactions) message = message.split(secret).join('[redacted]');
  message = message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 800);

  return {
    httpStatus,
    providerStatus: safeText(providerError.status, 80) || undefined,
    providerCode: Number.isFinite(providerError.code) ? providerError.code : providerCode,
    message: message || 'The AI provider returned an error without a safe message.',
    category: classifyGeminiFailure({ httpStatus, providerStatus: providerError.status || providerCode, providerMessage: message }),
  };
}

function safePatientContext(context) {
  return {
    medicinesAvailable: Array.isArray(context?.medicines),
    medicines: (Array.isArray(context?.medicines) ? context.medicines : []).slice(0, 50).map(item => ({
      id: safeText(item.medId, 100),
      name: safeText(item.medicineName, 100),
      dosage: safeText(item.dosage, 80),
      time: safeText(item.time, 20),
      frequency: safeText(item.frequency, 50),
      todayStatus: ['pending', 'taken', 'missed'].includes(item.todayStatus) ? item.todayStatus : 'pending',
    })),
    appointmentsAvailable: Array.isArray(context?.appointments),
    appointments: (Array.isArray(context?.appointments) ? context.appointments : []).slice(0, 30).map(item => ({
      doctor: safeText(item.doctorName, 100),
      date: safeText(item.date, 20),
      time: safeText(item.time, 20),
      location: safeText(item.location, 120),
    })),
  };
}

function fallbackReply(message) {
  const text = message.toLowerCase();
  if (/\b(medicine|medication|pill|dose|appointment|doctor|visit|took|taken)\b/.test(text)) {
    return 'I’m having trouble reaching my conversation service, so I can’t safely check or change your records right now. Please try again shortly, or use the Medicines and Appointments sections.';
  }
  if (/\b(lonely|sad|worried|afraid|scared|upset|anxious)\b/.test(text)) {
    return 'I’m sorry this feels difficult. I’m here with you. Would you like to tell me a little more about what’s on your mind?';
  }
  return 'I’m here with you. My conversation service is temporarily unavailable, but you can try again in a moment. What would you like to talk about?';
}

function parseModelResponse(data) {
  const raw = data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
  if (!raw) throw new Error('empty_model_response');
  const normalized = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(normalized);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_model_response');
  const action = parsed.action && typeof parsed.action === 'object' ? parsed.action : {};
  const type = ALLOWED_ACTIONS.has(action.type) ? action.type : 'none';
  const fields = action.fields && typeof action.fields === 'object' ? action.fields : {};
  return {
    reply: safeText(parsed.reply, 1000) || 'I’m here with you. What would you like to do next?',
    action: type === 'none' ? null : {
      type,
      fields: Object.fromEntries(Object.entries(fields).slice(0, 10).map(([key, value]) => [key, safeText(value, 120)])),
    },
  };
}

function getAssistantProviders(env = process.env) {
  const available = {
    gemini: env.GEMINI_API_KEY ? {
      name: 'gemini',
      key: env.GEMINI_API_KEY,
      model: safeText(env.GEMINI_MODEL, 80) || 'gemini-3.8-flash',
      endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(safeText(env.GEMINI_MODEL, 80) || 'gemini-3.8-flash')}:generateContent`,
    } : null,
    openai: env.OPENAI_API_KEY ? {
      name: 'openai',
      key: env.OPENAI_API_KEY,
      model: safeText(env.OPENAI_MODEL, 80) || 'gpt-4.1-mini',
      endpoint: 'https://api.openai.com/v1/chat/completions',
    } : null,
    groq: env.GROQ_API_KEY ? {
      name: 'groq',
      key: env.GROQ_API_KEY,
      model: safeText(env.GROQ_CHAT_MODEL, 100) || 'openai/gpt-oss-20b',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    } : null,
  };
  const preference = safeText(env.ASSISTANT_PROVIDER, 20).toLowerCase() || 'auto';
  if (!['auto', 'gemini', 'groq', 'openai'].includes(preference)) return { preference, providers: [], invalidPreference: true };
  const providers = preference === 'auto'
    ? [available.gemini, available.groq, available.openai].filter(Boolean)
    : [available[preference]].filter(Boolean);
  return { preference, providers, invalidPreference: false };
}

function buildProviderRequest(provider, systemInstruction, messages, timeoutMs) {
  const history = safeConversation(messages);
  if (provider.name !== 'gemini') {
    return {
      url: provider.endpoint,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` },
      body: {
        model: provider.model,
        messages: [
          { role: 'system', content: systemInstruction },
          ...history.map(message => ({ role: message.role === 'model' ? 'assistant' : 'user', content: message.parts.map(part => part.text).join('\n') })),
        ],
        max_completion_tokens: 700,
        response_format: { type: 'json_object' },
      },
    };
  }
  return {
    url: provider.endpoint,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.key },
    body: {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: history,
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 700 },
    },
  };
}

function parseProviderResponse(providerName, body) {
  if (providerName !== 'gemini') {
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('empty_model_response');
    return parseModelResponse({ candidates: [{ content: { parts: [{ text }] } }] });
  }
  return parseModelResponse(body);
}

function canFailOver(category) {
  return ['quota_exceeded', 'service_unavailable', 'timeout', 'network_error', 'invalid_api_key'].includes(category);
}

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const AUDIO_TYPES = new Map([
  ['audio/webm', 'webm'], ['audio/ogg', 'ogg'], ['audio/mp4', 'm4a'],
  ['audio/mpeg', 'mp3'], ['audio/mpga', 'mpga'], ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'], ['audio/flac', 'flac'],
]);

function getAudioFileType(contentType) {
  return AUDIO_TYPES.get(safeText(contentType, 100).split(';')[0].toLowerCase()) || null;
}

async function transcribeAssistantAudio(req, res) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!takeRateLimitSlot(ip)) return res.status(429).json({ error: 'Please wait a moment before recording another message.' });
  const audioType = getAudioFileType(req.get?.('content-type') || req.headers?.['content-type']);
  const audio = req.body;
  if (!audioType) return res.status(415).json({ error: 'This recording format is not supported. Try another browser or type your message.' });
  if (!Buffer.isBuffer(audio) || audio.length === 0) return res.status(400).json({ error: 'The recording was empty. Please try again or type your message.' });
  if (audio.length > MAX_AUDIO_BYTES) return res.status(413).json({ error: 'The recording is too large. Keep voice messages under 10 MB.' });
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'Groq speech recognition is not configured. Add GROQ_API_KEY to backend/.env and restart the backend.' });

  const startedAt = Date.now();
  const timeoutMs = getGeminiTimeoutMs(process.env.GROQ_REQUEST_TIMEOUT_MS);
  const model = safeText(process.env.GROQ_STT_MODEL, 100) || 'whisper-large-v3-turbo';
  const form = new FormData();
  form.append('file', new Blob([audio], { type: req.get?.('content-type')?.split(';')[0] || req.headers?.['content-type'] }), `carewise-voice.${audioType}`);
  form.append('model', model);
  form.append('response_format', 'json');

  try {
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const status = response.status;
      console.warn('[Assistant] Groq transcription returned HTTP error:', { httpStatus: status, model, elapsedMs: Date.now() - startedAt });
      if (status === 429) return res.status(429).json({ error: 'Groq speech recognition reached its rate or usage limit. Please try again later or type your message.' });
      if (status === 503 || status >= 500) return res.status(503).json({ error: 'Speech recognition is temporarily unavailable. Please try again or type your message.' });
      if (status === 401 || status === 403) return res.status(503).json({ error: 'Groq speech recognition could not authenticate. Check GROQ_API_KEY in backend/.env.' });
      return res.status(502).json({ error: 'Speech recognition could not process this recording. Please try again or type your message.' });
    }
    const result = await response.json();
    const text = typeof result?.text === 'string' ? result.text.trim().slice(0, 4000) : '';
    if (!text) return res.status(422).json({ error: 'No speech was recognized. Try speaking clearly, or type your message.' });
    console.info('[Assistant] Groq transcription completed:', { model, elapsedMs: Date.now() - startedAt, transcriptCharacters: text.length });
    return res.status(200).json({ text });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    console.warn('[Assistant] Groq transcription request failed:', { model, errorName: error?.name || 'Error', failure: timeout ? 'timeout' : 'network_error', elapsedMs: Date.now() - startedAt });
    return res.status(timeout ? 504 : 502).json({ error: timeout
      ? 'Speech recognition took too long. Please try a shorter recording or type your message.'
      : 'Carewise could not connect to speech recognition. Check the backend connection and try again.' });
  }
}

async function chatWithAssistant(req, res) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!takeRateLimitSlot(ip)) {
    return res.status(429).json({ error: 'Please wait a moment before sending another message.' });
  }

  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 30
    || messages.some(message => !message || !['user', 'assistant'].includes(message.role)
      || typeof message.content !== 'string' || message.content.length > 2000)) {
    return res.status(400).json({ error: 'Send a short conversation message and try again.' });
  }
  const latest = safeText([...messages].reverse().find(message => message.role === 'user')?.content, 1200);
  if (!latest) return res.status(400).json({ error: 'Please type or say a message first.' });

  const appointmentMessages = req.body?.appointmentMessages;
  if (appointmentMessages !== undefined && (!Array.isArray(appointmentMessages) || appointmentMessages.length > 30
    || appointmentMessages.some(message => !message || message.role !== 'user' || typeof message.content !== 'string' || message.content.length > 2000))) {
    return res.status(400).json({ error: 'Appointment conversation details are invalid. Please send the request again.' });
  }
  const appointmentHistory = appointmentMessages?.length ? appointmentMessages : [{ role: 'user', content: latest }];
  const hasNewAppointmentIntent = hasAppointmentSchedulingIntent(latest);
  const appointmentDraftId = typeof req.body?.appointmentDraftId === 'string' && /^[a-z0-9-]{16,64}$/i.test(req.body.appointmentDraftId)
    ? req.body.appointmentDraftId
    : null;
  const appointmentReply = /^(?:add|schedule|book|confirm|yes|save)\s+(?:that\s+)?appointment[.! ]*$/i.test(latest)
    || /\badd\s+that\s+appointment\b/i.test(latest);
  const appointmentFieldReply = /\b(?:Dr\.?\s|doctor|appointment|visit|January|February|March|April|May|June|July|August|September|October|November|December|address|location|Pune|Maharashtra|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b/i.test(latest);
  if (hasNewAppointmentIntent || (appointmentDraftId && (appointmentReply || appointmentFieldReply))) {
    const fields = extractAppointmentDetails(appointmentHistory);
    const draftId = appointmentDraftId || crypto.randomUUID();
    const missing = getMissingAppointmentFields(fields);
    const workflow = { state: missing.length ? 'collecting_details' : 'awaiting_confirmation', draftId, fields, missingFields: missing };
    if (missing.length) {
      return res.status(200).json({
        reply: `I have ${[fields.doctorName, fields.date, fields.time, fields.location].filter(Boolean).join(', ') || 'your appointment details'}. I still need ${missing.join(', ')}.`,
        action: null, unavailable: false, mode: 'confirmation_workflow', appointmentWorkflow: workflow,
      });
    }
    return res.status(200).json({
      reply: `I have an appointment with ${fields.doctorName} on ${fields.date} at ${fields.time}, at ${fields.location}. Please confirm this exact appointment before I save it.`,
      action: { type: 'add_appointment', fields: { ...fields, idempotencyKey: draftId } },
      unavailable: false, mode: 'confirmation_workflow', appointmentWorkflow: workflow,
    });
  }

  const medicineMessages = req.body?.medicineMessages;
  if (medicineMessages !== undefined && (!Array.isArray(medicineMessages) || medicineMessages.length > 30
    || medicineMessages.some(message => !message || message.role !== 'user' || typeof message.content !== 'string' || message.content.length > 2000))) {
    return res.status(400).json({ error: 'Medicine conversation details are invalid. Please send the schedule again.' });
  }
  const medicineHistory = medicineMessages?.length ? medicineMessages : [{ role: 'user', content: latest }];
  const hasNewMedicineIntent = hasMedicineSchedulingIntent([messages.findLast?.(message => message.role === 'user') || { role: 'user', content: latest }]);
  const activeDraft = req.body?.medicineDraftId
    ? verifyMedicineDraftId(req.body.medicineDraftId, req.body?.userId)
    : null;
  const hasActiveDraft = Boolean(activeDraft && !activeDraft.error);
  const workflowReply = isMedicineWorkflowReply(latest);
  const fieldReply = isMedicineFieldReply(latest);
  if (hasNewMedicineIntent || (hasActiveDraft && (workflowReply || fieldReply))) {
    const fields = extractMedicineDetails(medicineHistory);
    let medicineDraftId = hasActiveDraft ? req.body.medicineDraftId : null;
    if (req.body?.userId && !medicineDraftId) {
      try { medicineDraftId = createMedicineDraftId(req.body.userId); }
      catch (_) { medicineDraftId = null; }
    }
    const workflowBase = {
      state: 'collecting_details',
      draftId: medicineDraftId,
      fields,
      missingFields: [],
    };
    const missing = getMissingMedicineFields(fields);
    if (missing.length) {
      const clarification = fields.ambiguousProduct
        ? `You said ${fields.medicineName || 'this medicine'} ${fields.strength}. Which exact product name and strength are printed on the package label? They do not clearly match, so I will not guess.`
        : missing.length === 1 && missing[0] === 'time'
          ? `I have ${fields.medicineName}, ${fields.dosage}, ${fields.frequency}${fields.mealInstructions ? ` ${fields.mealInstructions}` : ''}. What exact clock time should I use? “Every morning” does not specify a time.`
          : `I have ${[
          fields.medicineName && `medicine ${fields.medicineName}`,
          fields.strength && `strength ${fields.strength}`,
          fields.quantity && `quantity ${fields.quantity}`,
          fields.route && `route ${fields.route}`,
          fields.mealInstructions && `meal instructions ${fields.mealInstructions}`,
          fields.times.length && `time${fields.times.length > 1 ? 's' : ''} ${fields.times.join(' and ')}`,
          fields.frequency && `frequency ${fields.frequency}`,
        ].filter(Boolean).join(', ')}. I still need ${missing.join(', ')}.`;
      workflowBase.missingFields = missing;
      workflowBase.clarification = clarification;
      return res.status(200).json({ reply: `${clarification} I will keep the details you already gave me.`, action: null, unavailable: false, mode: 'confirmation_workflow', medicineWorkflow: workflowBase });
    }
    if (!req.body?.userId) {
      return res.status(200).json({ reply: 'Your schedule details are complete, but I cannot prepare a save without the current Carewise profile. Sign in again, then repeat the schedule.', action: null, unavailable: false, mode: 'confirmation_workflow', medicineWorkflow: { ...workflowBase, missingFields: ['signed-in Carewise profile'] } });
    }
    try {
      const fieldsWithToken = createPendingMedicineAction(req.body.userId, fields, medicineDraftId);
      const instruction = fields.instructions ? ` Instructions: ${fields.instructions}.` : '';
      const reply = `I have ${fields.medicineName}, ${fields.dosage}, ${fields.frequency}, at ${fields.times.join(' and ')}.${instruction} Please confirm this exact schedule before I save it.`;
      return res.status(200).json({
        reply,
        action: { type: 'add_medicine', fields: fieldsWithToken },
        unavailable: false,
        mode: 'confirmation_workflow',
        medicineWorkflow: { ...workflowBase, state: 'awaiting_confirmation', missingFields: [] },
      });
    } catch (error) {
      console.error('[Assistant] Could not prepare a medicine confirmation:', { errorName: error?.name || 'Error' });
      return res.status(200).json({ reply: 'I have the schedule details, but secure confirmation is unavailable. No medicine was saved. Please try again later.', action: null, unavailable: true, reason: 'confirmation_unavailable' });
    }
  }

  const { preference, providers, invalidPreference } = getAssistantProviders();
  if (invalidPreference) return res.status(200).json({ reply: 'The AI provider setting is invalid. Set ASSISTANT_PROVIDER to auto, gemini, groq, or openai.', action: null, unavailable: true, reason: 'invalid_provider' });
  if (!providers.length) return res.status(200).json({ reply: 'No live AI provider is configured. Add a provider key to backend/.env and restart the backend.', action: null, unavailable: true, reason: 'not_configured' });

  const context = safePatientContext(req.body?.patientContext);
  const timeoutMs = getGeminiTimeoutMs();
  const requestStartedAt = Date.now();
  const requestDeadline = requestStartedAt + timeoutMs;
  const requestId = ++requestSequence;
  let operation = 'request_setup';
  const systemInstruction = [
    'You are Carewise Companion, a warm, patient, respectful companion for an older adult. Use simple, clear language and ask one question at a time.',
    'Use the supplied patient records only for factual answers about medicines and appointments. Never invent a dose, schedule, appointment, health reading, or record.',
    'If a record category says it is unavailable, say you could not load that information. An unavailable category is not the same as an empty schedule.',
    'You are not a clinician. Do not diagnose or recommend changing prescribed medicines. For urgent symptoms, encourage contacting local emergency help or the care team.',
    'When a user asks to create a medicine or appointment, gather missing details and return a draft action. Never claim it has been saved. The app will show a separate confirmation before saving.',
    'For medicine, required fields are medicineName, dosage, time (24-hour HH:MM), frequency. Do not infer dosage or time. For appointment, required fields are doctorName, date (YYYY-MM-DD), time (HH:MM), location. Ask one concise follow-up for missing or ambiguous details.',
    'When a user says they took medicine, identify an exact matching scheduled medicine from context. If there is not exactly one clear match, ask which medicine. Return mark_taken only with the exact medId, and do not claim it was recorded.',
    'Return ONLY valid JSON with shape {"reply":"string","action":null|{"type":"none|add_medicine|add_appointment|mark_taken","fields":{...}}}.',
    `Patient records (read-only context): ${JSON.stringify(context)}`,
  ].join('\n');

  try {
    let lastFailure;
    for (let index = 0; index < providers.length; index += 1) {
      const provider = providers[index];
      const remainingMs = requestDeadline - Date.now();
      if (remainingMs <= 0) throw new DOMException('Assistant request deadline exceeded', 'TimeoutError');
      const providerTimeoutMs = providers.length > 1 ? Math.min(remainingMs, Math.ceil(timeoutMs / providers.length)) : remainingMs;
      const providerRequest = buildProviderRequest(provider, systemInstruction, messages, providerTimeoutMs);
      operation = `${provider.name}_fetch_response_headers`;
      console.info('[Assistant] Live provider request started:', { requestId, provider: provider.name, model: provider.model, attempt: 1, remainingTimeoutMs: providerTimeoutMs });
      let response;
      try {
        response = await fetch(providerRequest.url, {
          method: 'POST',
          headers: providerRequest.headers,
          body: JSON.stringify(providerRequest.body),
          signal: AbortSignal.timeout(providerTimeoutMs),
        });
      } catch (error) {
        const category = classifyGeminiFailure({ error });
        lastFailure = { provider, category, error };
        console.warn('[Assistant] Live provider request failed before response headers:', {
          requestId,
          provider: provider.name,
          errorName: error?.name || 'Error',
          errorCode: /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_)/.test(error?.code || '') ? error.code : undefined,
          elapsedMs: Date.now() - requestStartedAt,
        });
        if (preference === 'auto' && index < providers.length - 1 && canFailOver(category)) continue;
        throw Object.assign(error, { assistantCategory: category, assistantProvider: provider.name });
      }

      console.info('[Assistant] Live provider response headers received:', {
        requestId,
        provider: provider.name,
        httpStatus: response.status,
        elapsedMs: Date.now() - requestStartedAt,
      });
      if (!response.ok) {
        let errorBody = null;
        try { errorBody = await response.json(); } catch (_) { /* Do not log unparsed response bytes. */ }
        const details = safeProviderErrorDetails(errorBody, response.status, provider.key, { messages, context });
        console.error('[Assistant] Live provider returned HTTP error:', { provider: provider.name, ...details, elapsedMs: Date.now() - requestStartedAt });
        lastFailure = { provider, category: details.category, details };
        if (preference === 'auto' && index < providers.length - 1 && canFailOver(details.category)) continue;
        break;
      }

      operation = `${provider.name}_response_body`;
      const result = parseProviderResponse(provider.name, await response.json());
      console.info('[Assistant] Live provider request completed:', { requestId, provider: provider.name, httpStatus: response.status, elapsedMs: Date.now() - requestStartedAt, outcome: 'success' });
      return res.status(200).json({ ...result, unavailable: false, mode: 'live', provider: provider.name });
    }

    const category = lastFailure?.category || 'provider_unavailable';
    const friendlyProviderMessages = {
      quota_exceeded: 'The configured live AI provider reached a quota or rate limit. Check its account limits or configure another live provider.',
      service_unavailable: 'The live AI service is temporarily unavailable. Please try again later or switch to another configured live provider.',
      invalid_api_key: `The configured ${lastFailure?.provider?.name || 'AI'} API key was rejected. Check its backend/.env configuration.`,
      timeout: 'The live AI provider did not respond before the request timed out. Please retry shortly.',
      network_error: 'Carewise could not connect to the live AI provider. Check backend network access and try again.',
    };
    console.info('[Assistant] Live AI request completed:', { requestId, elapsedMs: Date.now() - requestStartedAt, outcome: category });
    return res.status(200).json({
      reply: friendlyProviderMessages[category] || fallbackReply(latest),
      action: null,
      unavailable: true,
      reason: category,
      demoModeAvailable: ['quota_exceeded', 'service_unavailable'].includes(category),
    });
  } catch (error) {
    const category = error.assistantCategory || classifyGeminiFailure({ error });
    const errorCode = /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_)/.test(error?.code || '') ? error.code : undefined;
    if (category === 'timeout') {
      console.warn('[Assistant] Live AI request timed out:', { requestId, timeoutMs, elapsedMs: Date.now() - requestStartedAt, operation, errorName: error.name || 'AbortError' });
    } else if (category === 'network_error') {
      console.error('[Assistant] Live AI network failure:', { requestId, provider: error.assistantProvider, elapsedMs: Date.now() - requestStartedAt, operation, errorName: error.name || 'Error', errorCode });
    } else {
      console.error('[Assistant] Live AI request failed:', { requestId, provider: error.assistantProvider, elapsedMs: Date.now() - requestStartedAt, operation, category, errorName: error.name || 'Error' });
    }
    console.info('[Assistant] Live AI request completed:', { requestId, provider: error.assistantProvider, elapsedMs: Date.now() - requestStartedAt, outcome: category });
    const friendly = category === 'timeout'
      ? 'The live AI provider did not respond before the request timed out. Please retry shortly.'
      : category === 'network_error'
        ? 'Carewise could not connect to the live AI provider. Check backend network access and try again.'
        : fallbackReply(latest);
    return res.status(200).json({ reply: friendly, action: null, unavailable: true, reason: category, demoModeAvailable: false });
  }
}

module.exports = { chatWithAssistant, transcribeAssistantAudio, getAudioFileType, MAX_AUDIO_BYTES, fallbackReply, parseModelResponse, safePatientContext, safeConversation, safeProviderErrorDetails, getGeminiTimeoutMs, classifyGeminiFailure, getAssistantProviders, buildProviderRequest, parseProviderResponse, hasAppointmentSchedulingIntent, extractAppointmentDetails, getMissingAppointmentFields };
