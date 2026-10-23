const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const profiles = new Set(['patient-1', 'patient-2']);
const records = new Map();
let nextId = 0;
let failWrite = false;
let failRead = false;
const fakeDb = {
  collection(name) {
    if (name === 'users') return { doc: id => ({ get: async () => ({ exists: profiles.has(id) }) }) };
    if (name === 'healthLogs') return {
      doc: () => {
        const id = `log-${++nextId}`;
        return { id, set: async data => { if (failWrite) throw new Error('mock write failure'); records.set(id, data); } };
      },
      where: (field, operator, value) => ({ get: async () => {
        if (failRead) throw new Error('mock read failure');
        assert.equal(field, 'userId');
        assert.equal(operator, '==');
        return { docs: [...records].filter(([, record]) => record.userId === value).map(([id, data]) => ({ id, data: () => data })) };
      } }),
    };
    throw new Error(`Unexpected collection: ${name}`);
  },
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '../config/firebase' && parent?.filename.endsWith('healthController.js')) return { getDb: () => fakeDb };
  return originalLoad.call(this, request, parent, isMain);
};
const { logHealthReading, getHealthLogs, validateHealthReading, validateLegacySteps } = require('../src/controllers/healthController');
Module._load = originalLoad;

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function bp(userId, timestamp = '2026-10-22T08:00:00+05:30') {
  return { userId, type: 'blood_pressure', systolic: 121, diastolic: 79, unit: 'mmHg', timestamp, notes: 'after rest' };
}

test('create stores a validated reading and preserves the entered values', async () => {
  records.clear(); nextId = 0; failWrite = false;
  const res = response();
  await logHealthReading({ body: bp('patient-1'), app: { locals: { db: fakeDb } } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.userId, 'patient-1');
  assert.equal(res.body.data.systolic, 121);
  assert.equal(res.body.data.diastolic, 79);
  assert.equal(res.body.data.unit, 'mmHg');
  assert.equal(records.size, 1);
});

test('reads are sorted newest-first and isolated to the requested profile', async () => {
  records.clear();
  records.set('old', { userId: 'patient-1', type: 'heart_rate', value: 70, unit: 'bpm', timestamp: '2026-10-20T08:00:00Z' });
  records.set('new', { userId: 'patient-1', type: 'heart_rate', value: 75, unit: 'bpm', timestamp: '2026-10-21T08:00:00Z' });
  records.set('other', { userId: 'patient-2', type: 'heart_rate', value: 90, unit: 'bpm', timestamp: '2026-10-22T08:00:00Z' });
  const res = response();
  await getHealthLogs({ params: { userId: 'patient-1' }, app: { locals: { db: fakeDb } } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.map(record => record.logId), ['new', 'old']);
  assert.ok(res.body.every(record => record.userId === 'patient-1'));
});

test('empty history returns an empty array', async () => {
  records.clear();
  const res = response();
  await getHealthLogs({ params: { userId: 'patient-1' }, app: { locals: { db: fakeDb } } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, []);
});

test('validates type, unit, timestamp, values, pair ordering, and sugar context', () => {
  const valid = bp('patient-1');
  assert.equal(validateHealthReading({ ...valid, type: 'unknown' }), 'Choose a supported measurement type.');
  assert.equal(validateHealthReading({ ...valid, unit: 'kPa' }), 'Choose the correct unit for this measurement.');
  assert.match(validateHealthReading({ ...valid, timestamp: 'not-a-date' }), /valid date and time/);
  assert.match(validateHealthReading({ ...valid, systolic: 60, diastolic: 70 }), /valid systolic/);
  assert.match(validateHealthReading({ type: 'blood_sugar', value: 120, unit: 'mg/dL', timestamp: valid.timestamp }), /Choose whether/);
  assert.equal(validateHealthReading({ type: 'oxygen_saturation', value: 101, unit: '%', timestamp: valid.timestamp }), 'The measurement is outside the supported entry range for %.');
});

test('invalid or nonexistent profiles do not create records', async () => {
  records.clear();
  const invalid = response();
  await logHealthReading({ body: { ...bp('patient-1'), userId: '' }, app: { locals: { db: fakeDb } } }, invalid);
  assert.equal(invalid.statusCode, 400);
  const missing = response();
  await logHealthReading({ body: bp('missing-profile'), app: { locals: { db: fakeDb } } }, missing);
  assert.equal(missing.statusCode, 404);
  assert.equal(records.size, 0);
});

test('database write and read errors return clear service errors, not success', async () => {
  failWrite = true;
  const writeRes = response();
  await logHealthReading({ body: bp('patient-1'), app: { locals: { db: fakeDb } } }, writeRes);
  assert.equal(writeRes.statusCode, 500);
  assert.match(writeRes.body.error, /temporarily unavailable/);
  failWrite = false;
  failRead = true;
  const readRes = response();
  await getHealthLogs({ params: { userId: 'patient-1' }, app: { locals: { db: fakeDb } } }, readRes);
  assert.equal(readRes.statusCode, 500);
  assert.match(readRes.body.error, /temporarily unavailable/);
  failRead = false;
});

test('legacy dashboard vitals remain supported without fabricating a save', async () => {
  const res = response();
  await logHealthReading({ body: { userId: 'patient-1', heartRate: 110, steps: 1200 }, app: { locals: { db: fakeDb } } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.flagged, true);
  assert.equal(res.body.data.heartRate, 110);
  assert.equal(res.body.data.steps, 1200);
});

test('steps-only quick log validates and stores no fabricated heart-rate value', async () => {
  records.clear(); nextId = 0; failWrite = false;
  assert.equal(validateLegacySteps({ steps: 2400 }).error, undefined);
  assert.match(validateLegacySteps({ steps: 100000.5 }).error, /whole number/);
  const res = response();
  await logHealthReading({ body: { userId: 'patient-1', steps: 2400 }, app: { locals: { db: fakeDb } } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.type, 'steps');
  assert.equal(res.body.data.value, 2400);
  assert.equal(res.body.data.unit, 'steps');
  assert.equal(Object.hasOwn(res.body.data, 'heartRate'), false);
});

test('explicit steps measurement type is accepted and stored through the health-log endpoint', async () => {
  records.clear(); nextId = 0; failWrite = false;
  const reading = { userId: 'patient-1', type: 'steps', value: 2400, unit: 'steps', timestamp: '2026-10-23T08:00:00Z' };
  assert.equal(validateHealthReading(reading), null);
  assert.match(validateHealthReading({ ...reading, value: 2400.5 }), /whole number/);
  const res = response();
  await logHealthReading({ body: reading, app: { locals: { db: fakeDb } } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.type, 'steps');
  assert.equal(res.body.data.value, 2400);
});
