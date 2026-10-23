const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractMedicineDetails,
  getMissingMedicineFields,
  createMedicineDraftId,
  createPendingMedicineAction,
  confirmAssistantMedicine,
} = require('../src/controllers/assistantMedicineActions');
const { chatWithAssistant } = require('../src/controllers/assistantController');

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function mockDb({ failFirstTransaction = false, userExists = true } = {}) {
  const medicines = new Map();
  let transactionCalls = 0;
  const medicineCollection = { doc: id => ({ kind: 'medicine', id }), where: (field, operator, value) => ({ kind: 'query', field, operator, value }) };
  return {
    medicines,
    get transactionCalls() { return transactionCalls; },
    collection(name) { return name === 'users' ? { doc: id => ({ kind: 'user', id }) } : medicineCollection; },
    async runTransaction(callback) {
      transactionCalls += 1;
      if (failFirstTransaction && transactionCalls === 1) throw Object.assign(new Error('temporary Firestore outage'), { code: 14 });
      const writes = [];
      const transaction = {
        async get(ref) {
          if (ref.kind === 'user') return { exists: userExists, id: ref.id };
          if (ref.kind === 'query') {
            const docs = [...medicines.entries()].filter(([, data]) => data.userId === ref.value).map(([id, data]) => ({ id, data: () => data }));
            return { docs };
          }
          const data = medicines.get(ref.id);
          return { exists: Boolean(data), id: ref.id, data: () => data };
        },
        create(ref, data) { writes.push([ref.id, data]); },
      };
      const result = await callback(transaction);
      writes.forEach(([id, data]) => medicines.set(id, data));
      return result;
    },
  };
}

const ambiguousFirst = 'Hello, add Meftal 650-500 mg, one tablet with water, every day before breakfast at 8 am.';
const repeatedRequest = 'Add Meftal 650-500 mg, one tablet with water, every day before breakfast at 8 am.';
const labelClarification = 'The package label says Meftal 500 mg; take one tablet with water every day before breakfast at 8 am.';
const validSchedule = 'Add medicine Meftal 500 mg, one tablet with water, every day before breakfast at 8 am.';

function userMessage(content) { return { role: 'user', content }; }

async function chat(body, ip = `medicine-test-${Math.random()}`) {
  const res = response();
  await chatWithAssistant({ ip, body: { userId: 'existing-profile', messages: [userMessage(body.latest)], medicineDraftId: body.draftId, medicineMessages: body.medicineMessages || [userMessage(body.latest)] } }, res);
  return res.body;
}

test('parses semantic fields separately and flags a compound strength as ambiguous', () => {
  const fields = extractMedicineDetails([userMessage(ambiguousFirst)]);
  assert.equal(fields.medicineName, 'Meftal');
  assert.equal(fields.strength, '650-500 mg');
  assert.equal(fields.quantity, '1 tablet');
  assert.deepEqual(fields.times, ['08:00']);
  assert.equal(fields.frequency, 'Daily');
  assert.equal(fields.route, 'oral');
  assert.match(fields.mealInstructions, /before breakfast/);
  assert.equal(fields.ambiguousProduct, true);
  assert.ok(getMissingMedicineFields(fields).includes('the exact product and strength as written on the package label'));
});

test('only resolves a compound strength when the user explicitly reads the package label', () => {
  const fields = extractMedicineDetails([userMessage(ambiguousFirst), userMessage(labelClarification)]);
  assert.equal(fields.medicineName, 'Meftal');
  assert.equal(fields.strength, '500 mg');
  assert.equal(fields.ambiguousProduct, false);
  assert.deepEqual(getMissingMedicineFields(fields), []);
});

test('covers the ten-turn report: retains stable draft, asks a specific clarification, ignores unrelated topic, and never confirms ambiguity', async () => {
  const previous = Object.fromEntries(['ASSISTANT_ACTION_SECRET', 'ASSISTANT_PROVIDER', 'GROQ_API_KEY', 'GEMINI_API_KEY'].map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  process.env.ASSISTANT_ACTION_SECRET = 'test-only-action-signing-secret';
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const turns = [ambiguousFirst];
  let draftId;
  try {
    const first = await chat({ latest: turns.at(-1), medicineMessages: turns.map(userMessage) }, 'medicine-ten-turn-1');
    assert.equal(first.medicineWorkflow.state, 'collecting_details');
    assert.match(first.reply, /exact product name and strength.*package label/i);
    draftId = first.medicineWorkflow.draftId;

    turns.push(repeatedRequest);
    const repeated = await chat({ latest: turns.at(-1), draftId, medicineMessages: turns.map(userMessage) }, 'medicine-ten-turn-2');
    assert.equal(repeated.medicineWorkflow.draftId, draftId);
    assert.match(repeated.reply, /exact product name and strength/i);

    turns.push('500 mg');
    const strengthReply = await chat({ latest: turns.at(-1), draftId, medicineMessages: turns.map(userMessage) }, 'medicine-ten-turn-3');
    assert.equal(strengthReply.medicineWorkflow.draftId, draftId);
    assert.equal(strengthReply.action, null);
    assert.match(strengthReply.reply, /exact product name and strength/i);

    turns.push('Yes, save it.');
    const prematureConfirmation = await chat({ latest: turns.at(-1), draftId, medicineMessages: turns.slice(0, 3).map(userMessage) }, 'medicine-ten-turn-4');
    assert.equal(prematureConfirmation.action, null);
    assert.match(prematureConfirmation.reply, /exact product name and strength/i);

    turns.push("I'm hungry.");
    const unrelated = await chat({ latest: turns.at(-1), draftId, medicineMessages: turns.slice(0, 3).map(userMessage) }, 'medicine-ten-turn-5');
    assert.equal(unrelated.unavailable, true);
    assert.equal(unrelated.action, null);
    assert.equal(turns.length, 5, 'the medicine draft history remains available in the client state');

    turns.push('Confirm. Please add it in the medicine log.');
    const laterConfirmation = await chat({ latest: turns.at(-1), draftId, medicineMessages: turns.slice(0, 3).map(userMessage) }, 'medicine-ten-turn-6');
    assert.equal(laterConfirmation.action, null);
    assert.equal(laterConfirmation.medicineWorkflow.draftId, draftId);
    assert.match(laterConfirmation.reply, /exact product name and strength/i);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test('keeps missing-field questions specific and retains fields through an AI outage', async () => {
  const prev = process.env.ASSISTANT_ACTION_SECRET;
  process.env.ASSISTANT_ACTION_SECRET = 'test-only-action-signing-secret';
  try {
    const fields = extractMedicineDetails([userMessage('Add medicine Meftal at 8 am every morning.')]);
    assert.deepEqual(getMissingMedicineFields(fields), ['strength', 'how many tablets, capsules, or other units']);
    const draftId = createMedicineDraftId('existing-profile');
    const result = await chat({ latest: '500 mg one tablet with water.', draftId, medicineMessages: [userMessage('Add medicine Meftal at 8 am every morning.'), userMessage('500 mg one tablet with water.')] }, 'medicine-outage-retention');
    assert.equal(result.medicineWorkflow.state, 'awaiting_confirmation');
    assert.equal(result.action.fields.medicineName, 'Meftal');
    assert.equal(result.action.fields.strength, '500 mg');
    assert.equal(result.action.fields.quantity, '1 tablet');
    assert.deepEqual(result.action.fields.times, ['08:00']);
  } finally {
    if (prev === undefined) delete process.env.ASSISTANT_ACTION_SECRET;
    else process.env.ASSISTANT_ACTION_SECRET = prev;
  }
});

test('complete schedule can be confirmed, and a repeated confirmation is idempotent', async () => {
  const prev = process.env.ASSISTANT_ACTION_SECRET;
  process.env.ASSISTANT_ACTION_SECRET = 'test-only-action-signing-secret';
  const fields = extractMedicineDetails([userMessage(validSchedule)]);
  const draftId = createMedicineDraftId('existing-profile');
  const first = createPendingMedicineAction('existing-profile', fields, draftId);
  const repeated = createPendingMedicineAction('existing-profile', fields, draftId);
  assert.equal(first.confirmationToken, repeated.confirmationToken);
  const token = first.confirmationToken;
  const db = mockDb();
  try {
    for (let i = 0; i < 2; i += 1) {
      const res = response();
      await confirmAssistantMedicine({ body: { confirmationToken: token, userId: 'existing-profile', confirmed: true }, app: { locals: { db } } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
    }
    assert.equal(db.medicines.size, 1);
    const saved = [...db.medicines.values()][0];
    assert.equal(saved.medicineName, 'Meftal');
    assert.equal(saved.dosage, '500 mg, 1 tablet');
    assert.match(saved.instructions, /oral/);
    assert.match(saved.instructions, /before breakfast/);
    assert.match(saved.instructions, /with water/);
  } finally {
    if (prev === undefined) delete process.env.ASSISTANT_ACTION_SECRET;
    else process.env.ASSISTANT_ACTION_SECRET = prev;
  }
});

test('save failure reports no success and the same signed draft succeeds on retry', async () => {
  const previous = process.env.ASSISTANT_ACTION_SECRET;
  const originalError = console.error;
  process.env.ASSISTANT_ACTION_SECRET = 'test-only-action-signing-secret';
  console.error = () => {};
  const token = createPendingMedicineAction('existing-profile', extractMedicineDetails([userMessage(validSchedule)])).confirmationToken;
  const db = mockDb({ failFirstTransaction: true });
  try {
    const failed = response();
    await confirmAssistantMedicine({ body: { confirmationToken: token, userId: 'existing-profile', confirmed: true }, app: { locals: { db } } }, failed);
    assert.equal(failed.statusCode, 503);
    assert.equal(failed.body.success, undefined);
    assert.equal(db.medicines.size, 0);
    const retry = response();
    await confirmAssistantMedicine({ body: { confirmationToken: token, userId: 'existing-profile', confirmed: true }, app: { locals: { db } } }, retry);
    assert.equal(retry.body.success, true);
    assert.equal(db.medicines.size, 1);
  } finally {
    console.error = originalError;
    if (previous === undefined) delete process.env.ASSISTANT_ACTION_SECRET;
    else process.env.ASSISTANT_ACTION_SECRET = previous;
  }
});
