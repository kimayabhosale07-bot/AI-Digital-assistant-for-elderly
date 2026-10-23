const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chatWithAssistant,
  extractAppointmentDetails,
  getMissingAppointmentFields,
} = require('../src/controllers/assistantController');
const { extractMedicineDetails, createMedicineDraftId } = require('../src/controllers/assistantMedicineActions');
const { addAppointment } = require('../src/controllers/appointmentController');

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
const user = content => ({ role: 'user', content });

async function chatTurn(latest, body = {}, ip = `routing-${Math.random()}`) {
  const res = response();
  await chatWithAssistant({ ip, body: { messages: [user(latest)], ...body } }, res);
  return res.body;
}

const appointmentRequest = 'Add Dr. Visit Dr. Aditya Virna on 24 October 2026, 10am address Pune, Maharashtra';
const medicineRequest = 'Add meftal 650 mg, 1 tablet with water every morning before breakfast at 8 am';

test('routes the exact Dr. Visit request to appointment details and never medicine extraction', async () => {
  const old = Object.fromEntries(['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY'].map(key => [key, process.env[key]]));
  const oldFetch = global.fetch;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENAI_API_KEY;
  global.fetch = async () => { throw new Error('Appointment routing must be deterministic.'); };
  try {
    const fields = extractAppointmentDetails([user(appointmentRequest)]);
    assert.deepEqual(fields, { doctorName: 'Dr. Aditya Virna', date: '2026-10-24', time: '10:00', location: 'Pune, Maharashtra' });
    assert.deepEqual(getMissingAppointmentFields(fields), []);
    const result = await chatTurn(appointmentRequest, { userId: 'profile-1', medicineMessages: [user(appointmentRequest)] }, 'appointment-routes-before-medicine');
    assert.equal(result.action.type, 'add_appointment');
    assert.equal(result.medicineWorkflow, undefined);
    assert.equal(result.appointmentWorkflow.state, 'awaiting_confirmation');
    assert.equal(result.action.fields.doctorName, 'Dr. Aditya Virna');
    assert.equal(result.action.fields.date, '2026-10-24');
    assert.equal(result.action.fields.time, '10:00');
    assert.equal(result.action.fields.location, 'Pune, Maharashtra');
    assert.match(result.reply, /Please confirm/i);
  } finally {
    global.fetch = oldFetch;
    for (const [key, value] of Object.entries(old)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test('location follow-up completes the same appointment draft and returns its stable confirmation key', async () => {
  const firstMessage = 'Add Dr. Birla visit at 24 October 2026 at 10 AM Pune, Maharashtra.';
  const first = await chatTurn(firstMessage, { userId: 'profile-1', appointmentMessages: [user(firstMessage)] }, 'birla-appointment-location-first');
  assert.equal(first.appointmentWorkflow.state, 'collecting_details');
  assert.deepEqual(first.appointmentWorkflow.missingFields, ['address or location']);
  const draftId = first.appointmentWorkflow.draftId;

  const location = 'Pune, Maharashtra';
  const completed = await chatTurn(location, {
    userId: 'profile-1', appointmentDraftId: draftId,
    appointmentMessages: [user(firstMessage), user(location)],
    medicineDraftId: 'medicine-draft-00000001', medicineMessages: [user('some unrelated medicine request')],
  }, 'birla-appointment-location-complete');
  assert.equal(completed.appointmentWorkflow.state, 'awaiting_confirmation');
  assert.equal(completed.appointmentWorkflow.draftId, draftId);
  assert.equal(completed.action.type, 'add_appointment');
  assert.equal(completed.action.fields.idempotencyKey, draftId);
  assert.deepEqual(completed.action.fields, {
    doctorName: 'Dr. Birla', date: '2026-10-24', time: '10:00', location, idempotencyKey: draftId,
  });
  assert.equal(completed.medicineWorkflow, undefined);
});

test('preserves meftal spelling and asks a specific question for a product-number/strength conflict', async () => {
  const fields = extractMedicineDetails([user('Add meftal 500, 650 mg, 1 tablet with water every morning before breakfast')]);
  assert.equal(fields.medicineName, 'meftal 500');
  assert.equal(fields.strength, '650 mg');
  assert.equal(fields.nameStrengthConflict, true);
  assert.equal(fields.ambiguousProduct, true);
  const old = process.env.ASSISTANT_ACTION_SECRET;
  process.env.ASSISTANT_ACTION_SECRET = 'assistant-routing-test-secret';
  try {
    const result = await chatTurn('Add meftal 500, 650 mg, 1 tablet with water every morning before breakfast', {
      userId: 'profile-1', medicineMessages: [user('Add meftal 500, 650 mg, 1 tablet with water every morning before breakfast')],
    }, 'medicine-name-strength-clarification');
    assert.match(result.reply, /product name and strength.*package label/i);
    assert.doesNotMatch(result.reply, /metal/i);
    assert.equal(result.action, null);
  } finally {
    if (old === undefined) delete process.env.ASSISTANT_ACTION_SECRET;
    else process.env.ASSISTANT_ACTION_SECRET = old;
  }
});

test('uses the explicit package label to resolve the product name and strength conflict', () => {
  const fields = extractMedicineDetails([
    user('Add meftal 500, 650 mg, 1 tablet with water every morning before breakfast at 8 am'),
    user('The package label says Meftal 650 mg; one tablet with water every morning before breakfast at 8 am.'),
  ]);
  assert.equal(fields.medicineName, 'Meftal');
  assert.equal(fields.strength, '650 mg');
  assert.equal(fields.nameStrengthConflict, false);
  assert.equal(fields.ambiguousProduct, false);
});

test('extracts 8 AM as 08:00 and asks only for a clock time when a morning routine has no exact time', async () => {
  const explicit = extractMedicineDetails([user(medicineRequest)]);
  assert.deepEqual(explicit.times, ['08:00']);
  const old = process.env.ASSISTANT_ACTION_SECRET;
  process.env.ASSISTANT_ACTION_SECRET = 'assistant-routing-test-secret';
  try {
    const withoutTime = 'Add meftal 650 mg, 1 tablet with water every morning before breakfast';
    const result = await chatTurn(withoutTime, { userId: 'profile-1', medicineMessages: [user(withoutTime)] }, 'medicine-asks-time-only');
    assert.deepEqual(result.medicineWorkflow.missingFields, ['time']);
    assert.match(result.reply, /What exact clock time/i);
    assert.doesNotMatch(result.reply, /medicine name|dosage|frequency|quantity/i);
  } finally {
    if (old === undefined) delete process.env.ASSISTANT_ACTION_SECRET;
    else process.env.ASSISTANT_ACTION_SECRET = old;
  }
});

test('a repeated explicit medicine request replaces stale extracted fields but keeps the same draft ID', async () => {
  const old = process.env.ASSISTANT_ACTION_SECRET;
  process.env.ASSISTANT_ACTION_SECRET = 'assistant-routing-test-secret';
  try {
    const first = await chatTurn(medicineRequest, { userId: 'profile-1', medicineMessages: [user(medicineRequest)] }, 'medicine-repeat-first');
    const draftId = first.medicineWorkflow.draftId;
    const revised = 'Add meftal 650 mg, 2 tablets with water every morning before breakfast at 9 am';
    const updated = await chatTurn(revised, { userId: 'profile-1', medicineDraftId: draftId, medicineMessages: [user(revised)] }, 'medicine-repeat-updated');
    assert.equal(updated.medicineWorkflow.draftId, draftId);
    assert.equal(updated.action.fields.quantity, '2 tablets');
    assert.deepEqual(updated.action.fields.times, ['09:00']);
    assert.match(updated.action.fields.dosage, /2 tablets/);
  } finally {
    if (old === undefined) delete process.env.ASSISTANT_ACTION_SECRET;
    else process.env.ASSISTANT_ACTION_SECRET = old;
  }
});

test('Add that medicine resolves the active complete draft and keeps medicine and appointment draft identities separate', async () => {
  const old = process.env.ASSISTANT_ACTION_SECRET;
  process.env.ASSISTANT_ACTION_SECRET = 'assistant-routing-test-secret';
  try {
    const scheduled = await chatTurn(medicineRequest, { userId: 'profile-1', medicineMessages: [user(medicineRequest)] }, 'medicine-reference-start');
    const medicineDraftId = scheduled.medicineWorkflow.draftId;
    const referenced = await chatTurn('Add that medicine', {
      userId: 'profile-1', medicineDraftId, medicineMessages: [user(medicineRequest)],
      appointmentDraftId: 'appointment-draft-00000001', appointmentMessages: [user(appointmentRequest)],
    }, 'medicine-reference');
    assert.equal(referenced.action.type, 'add_medicine');
    assert.equal(referenced.medicineWorkflow.draftId, medicineDraftId);
    assert.equal(referenced.appointmentWorkflow, undefined);
    assert.match(referenced.reply, /Please confirm this exact schedule/i);

    const appointment = await chatTurn(appointmentRequest, {
      userId: 'profile-1', medicineDraftId, medicineMessages: [user(medicineRequest)],
    }, 'appointment-independent-draft');
    assert.equal(appointment.action.type, 'add_appointment');
    assert.notEqual(appointment.appointmentWorkflow.draftId, medicineDraftId);
    assert.equal(appointment.medicineWorkflow, undefined);
  } finally {
    if (old === undefined) delete process.env.ASSISTANT_ACTION_SECRET;
    else process.env.ASSISTANT_ACTION_SECRET = old;
  }
});

function appointmentDb() {
  const records = new Map();
  let transactions = 0;
  return {
    records,
    get transactions() { return transactions; },
    collection(name) {
      return { doc: id => ({ kind: name === 'users' ? 'user' : 'appointment', id }) };
    },
    async runTransaction(callback) {
      transactions += 1;
      const staged = [];
      const result = await callback({
        async get(ref) {
          if (ref.kind === 'user') return { exists: true };
          const data = records.get(ref.id);
          return { exists: Boolean(data), data: () => data };
        },
        create(ref, data) { staged.push([ref.id, data]); },
      });
      for (const [id, data] of staged) records.set(id, data);
      return result;
    },
  };
}

test('assistant appointment writes require confirmation and retries do not duplicate records', async () => {
  const db = appointmentDb();
  const base = { userId: 'profile-1', doctorName: 'Dr. Aditya Virna', date: '2026-10-24', time: '10:00', location: 'Pune, Maharashtra', idempotencyKey: 'appointment-draft-00000001' };
  const unconfirmed = response();
  await addAppointment({ body: { ...base, confirmed: false }, app: { locals: { db } } }, unconfirmed);
  assert.equal(unconfirmed.statusCode, 400);
  assert.equal(db.transactions, 0);
  assert.equal(db.records.size, 0);

  const confirmed = response();
  await addAppointment({ body: { ...base, confirmed: true }, app: { locals: { db } } }, confirmed);
  assert.equal(confirmed.statusCode, 201);
  assert.equal(confirmed.body.success, true);
  assert.equal(db.records.size, 1);

  const retried = response();
  await addAppointment({ body: { ...base, confirmed: true }, app: { locals: { db } } }, retried);
  assert.equal(retried.statusCode, 200);
  assert.equal(retried.body.duplicate, true);
  assert.equal(db.records.size, 1);
});
