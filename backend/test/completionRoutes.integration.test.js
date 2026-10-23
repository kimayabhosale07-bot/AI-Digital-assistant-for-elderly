const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const crypto = require('node:crypto');
const router = require('../src/routes/api');

const medicines = new Map([['med-a', { medId: 'med-a', userId: 'profile-a', medicineName: 'Medicine A', dosage: '1 tablet', time: '08:00', times: ['08:00', '20:00'], frequency: 'twice daily' }]]);
const appointments = new Map([
  ['visit-past', { apptId: 'visit-past', userId: 'profile-a', doctorName: 'Dr. Past', date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), time: '10:00', location: 'Clinic', status: 'scheduled' }],
  ['visit-future', { apptId: 'visit-future', userId: 'profile-a', doctorName: 'Dr. Future', date: '2099-01-01', time: '10:00', location: 'Clinic', status: 'scheduled' }],
]);
const doses = new Map();

function collection(name) {
  const records = name === 'medicines' ? medicines : name === 'appointments' ? appointments : doses;
  return {
    doc(id) {
      return {
        id,
        get: async () => ({ exists: records.has(id), data: () => records.get(id) }),
        set: async data => records.set(id, { ...data }),
        update: async patch => {
          if (!records.has(id)) throw new Error('missing record');
          records.set(id, { ...records.get(id), ...patch });
        },
        delete: async () => records.delete(id),
      };
    },
    where(field, operator, value) {
      return { get: async () => ({ forEach(callback) {
        for (const [id, item] of records) if (item[field] === value) callback({ id, data: () => item });
      } }) };
    },
  };
}

const app = express();
app.locals.db = { collection };
app.use(express.json());
app.use('/api', router);
let server;
let baseUrl;
test.before(async () => {
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test('medicine dose completion is independent per schedule time and reversible', async () => {
  const update = (time, status, userId = 'profile-a') => fetch(`${baseUrl}/api/medicine/med-a/dose`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, scheduledDate: '2026-10-24', scheduledTime: time, status }),
  });
  const morning = await update('08:00', 'taken');
  assert.equal(morning.status, 200);
  const first = await morning.json();
  const evening = await update('20:00', 'taken');
  assert.equal(evening.status, 200);
  const second = await evening.json();
  assert.notEqual(first.doseId, second.doseId);
  assert.equal(doses.size, 2);
  const savedHistory = await fetch(`${baseUrl}/api/medicine/profile-a?date=2026-10-24`);
  const savedDoses = (await savedHistory.json())[0].todayDoses;
  assert.deepEqual(savedDoses.map(dose => dose.status), ['taken', 'taken']);
  assert.equal((await update('08:00', 'taken')).status, 200);
  assert.equal(doses.size, 2, 'repeating the update is idempotent');
  assert.equal((await update('08:00', 'pending')).status, 200);
  assert.equal(doses.size, 1);
  assert.equal([...doses.values()][0].scheduledTime, '20:00');
  const afterUndo = await fetch(`${baseUrl}/api/medicine/profile-a?date=2026-10-24`);
  assert.deepEqual((await afterUndo.json())[0].todayDoses.map(dose => dose.status), ['pending', 'taken']);
});

test('medicine dose route rejects another profile and unscheduled times', async () => {
  const foreign = await fetch(`${baseUrl}/api/medicine/med-a/dose`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'profile-b', scheduledDate: '2026-10-24', scheduledTime: '08:00', status: 'taken' }),
  });
  assert.equal(foreign.status, 403);
  const invalidTime = await fetch(`${baseUrl}/api/medicine/med-a/dose`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'profile-a', scheduledDate: '2026-10-24', scheduledTime: '12:00', status: 'taken' }),
  });
  assert.equal(invalidTime.status, 400);
});

test('GET medicine route exposes independent daily status for each scheduled time', async () => {
  const response = await fetch(`${baseUrl}/api/medicine/profile-a?date=2026-10-24`);
  assert.equal(response.status, 200);
  const list = await response.json();
  assert.deepEqual(list[0].todayDoses.map(dose => [dose.scheduledTime, dose.status]), [['08:00', 'pending'], ['20:00', 'taken']]);
});

test('legacy daily dose record remains visible and can be unchecked after time-specific IDs are introduced', async () => {
  const legacyId = crypto.createHash('sha256').update('profile-a:med-a:2026-10-25').digest('hex');
  doses.set(legacyId, { doseId: legacyId, userId: 'profile-a', medId: 'med-a', scheduledDate: '2026-10-25', scheduledTime: '08:00', status: 'taken' });
  const before = await fetch(`${baseUrl}/api/medicine/profile-a?date=2026-10-25`);
  assert.equal((await before.json())[0].todayDoses[0].status, 'taken');
  const response = await fetch(`${baseUrl}/api/medicine/med-a/dose`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'profile-a', scheduledDate: '2026-10-25', scheduledTime: '08:00', status: 'pending' }),
  });
  assert.equal(response.status, 200);
  assert.equal(doses.has(legacyId), false);
});

test('appointment completion can be set and reversed without changing booking status; future visits are rejected', async () => {
  const update = (apptId, completed, userId = 'profile-a') => fetch(`${baseUrl}/api/appointment/${apptId}/completion`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId, completed }),
  });
  assert.equal((await update('visit-past', true)).status, 200);
  assert.equal(appointments.get('visit-past').completed, true);
  assert.equal(appointments.get('visit-past').status, 'scheduled');
  const afterRefresh = await fetch(`${baseUrl}/api/appointment/profile-a`);
  const persisted = (await afterRefresh.json()).find(visit => visit.apptId === 'visit-past');
  assert.equal(persisted.completed, true);
  assert.ok(persisted.completedAt);
  assert.equal((await update('visit-past', false)).status, 200);
  assert.equal(appointments.get('visit-past').completed, false);
  assert.equal(appointments.get('visit-past').completedAt, null);
  assert.equal((await update('visit-future', true)).status, 400);
  assert.equal(appointments.get('visit-future').completed, undefined);
  assert.equal((await update('visit-past', true, 'profile-b')).status, 403);
});

test.after(() => new Promise(resolve => server ? server.close(resolve) : resolve()));
