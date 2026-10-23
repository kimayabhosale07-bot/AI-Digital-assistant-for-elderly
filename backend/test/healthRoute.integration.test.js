const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const router = require('../src/routes/api');

const profiles = new Set(['profile-empty', 'profile-with-readings', 'profile-steps', 'wAQAJKL8IXx5z8lY524k']);
const healthRecords = [
  { id: 'reading-1', data: { userId: 'profile-with-readings', type: 'heart_rate', value: 72, unit: 'bpm', timestamp: '2026-10-22T08:00:00.000Z' } },
  { id: 'other-reading', data: { userId: 'another-profile', type: 'heart_rate', value: 90, unit: 'bpm', timestamp: '2026-10-22T09:00:00.000Z' } },
];
let readFailure = false;

const memoryDb = {
  collection(name) {
    if (name === 'users') return { doc: id => ({ get: async () => ({ exists: profiles.has(id) }) }) };
    if (name === 'healthLogs') return {
      doc: () => {
        const id = `steps-${healthRecords.length + 1}`;
        return { id, set: async data => { healthRecords.push({ id, data }); } };
      },
      where: (field, operation, profileId) => ({ get: async () => {
        assert.equal(field, 'userId');
        assert.equal(operation, '==');
        if (readFailure) throw new Error('mock Firestore read failure');
        return { docs: healthRecords.filter(record => record.data.userId === profileId).map(record => ({ id: record.id, data: () => record.data })) };
      } }),
    };
    throw new Error(`Unexpected collection: ${name}`);
  },
};

const app = express();
app.locals.db = memoryDb;
app.use(express.json());
app.use('/api', router);
let server;
let baseUrl;

test('starts an isolated Express app with the actual API router mounted at /api', async () => {
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test('registered GET /api/health-log/:userId returns an empty JSON array for an existing empty profile', async () => {
  const response = await fetch(`${baseUrl}/api/health-log/profile-empty`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), []);
});

test('registered route returns only matching profile records as JSON', async () => {
  const response = await fetch(`${baseUrl}/api/health-log/profile-with-readings`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].logId, 'reading-1');
  assert.equal(body[0].userId, 'profile-with-readings');
  assert.equal(body[0].type, 'heart_rate');
});

test('registered POST saves a typed Steps record and GET returns it for the same profile', async () => {
  const timestamp = new Date().toISOString();
  const response = await fetch(`${baseUrl}/api/health-log`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'profile-steps', type: 'steps', value: 4280, unit: 'steps', timestamp }),
  });
  assert.equal(response.status, 201);
  const saved = await response.json();
  assert.equal(saved.data.userId, 'profile-steps');
  assert.equal(saved.data.type, 'steps');
  assert.equal(saved.data.value, 4280);
  assert.equal(saved.data.unit, 'steps');
  assert.equal(saved.data.timestamp, timestamp);

  const historyResponse = await fetch(`${baseUrl}/api/health-log/profile-steps`);
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.equal(history.length, 1);
  assert.equal(history[0].type, 'steps');
  assert.equal(history[0].value, 4280);
  assert.equal(history[0].userId, 'profile-steps');
});

test('registered POST accepts the exact reported Steps request and rejects invalid types or counts', async () => {
  const exactPayload = {
    userId: 'wAQAJKL8IXx5z8lY524k',
    type: 'steps',
    value: 4515,
    unit: 'steps',
    timestamp: '2026-10-23T18:53:39.101Z',
  };
  const accepted = await fetch(`${baseUrl}/api/health-log`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(exactPayload),
  });
  assert.equal(accepted.status, 201);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.data.userId, exactPayload.userId);
  assert.equal(acceptedBody.data.type, exactPayload.type);
  assert.equal(acceptedBody.data.value, exactPayload.value);
  assert.equal(acceptedBody.data.unit, exactPayload.unit);
  assert.equal(acceptedBody.data.timestamp, exactPayload.timestamp);
  assert.ok(acceptedBody.data.createdAt);

  for (const { payload, expectedError } of [
    { payload: { ...exactPayload, type: 'unsupported_measurement' }, expectedError: /Choose a supported measurement type/ },
    { payload: { ...exactPayload, value: 4515.5 }, expectedError: /whole number/ },
    { payload: { ...exactPayload, value: -1 }, expectedError: /supported entry range/ },
    { payload: { ...exactPayload, value: 100001 }, expectedError: /supported entry range/ },
  ]) {
    const rejected = await fetch(`${baseUrl}/api/health-log`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    assert.equal(rejected.status, 400);
    const error = await rejected.json();
    assert.match(error.error, expectedError);
  }

  const historyResponse = await fetch(`${baseUrl}/api/health-log/${encodeURIComponent(exactPayload.userId)}`);
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.ok(history.some(record => record.type === 'steps' && record.value === 4515 && record.userId === exactPayload.userId));
});

test('unknown profiles return 404 and Firestore errors return a bounded JSON 500', async () => {
  const unknown = await fetch(`${baseUrl}/api/health-log/unknown-profile`);
  assert.equal(unknown.status, 404);
  assert.match((await unknown.json()).error, /profile was not found/);

  readFailure = true;
  const failed = await fetch(`${baseUrl}/api/health-log/profile-empty`);
  readFailure = false;
  assert.equal(failed.status, 500);
  assert.match((await failed.json()).error, /temporarily unavailable/);
});

test.after(() => new Promise(resolve => {
  if (!server) return resolve();
  server.close(resolve);
}));
