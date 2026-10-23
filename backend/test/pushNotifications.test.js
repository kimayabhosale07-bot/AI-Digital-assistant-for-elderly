const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let documents;
let sent;
let messagingError;
const originalLoad = Module._load;

class Snapshot {
  constructor(id, data) {
    this.id = id;
    this._data = data;
    this.ref = { delete: async () => documents.delete(id) };
  }
  data() { return this._data; }
  get(field) { return field.split('.').reduce((value, key) => value?.[key], this._data); }
}

const fakeDb = {
  collection(name) {
    const query = filters => ({
      where(field, operator, value) { return query([...filters, [field, operator, value]]); },
      get: async () => {
        const docs = [...documents.entries()]
          .filter(([, data]) => data.collection === name)
          .filter(([, data]) => filters.every(([field, operator, expected]) => {
            const actual = field.split('.').reduce((value, key) => value?.[key], data);
            return operator === '==' ? actual === expected
              : operator === 'array-contains' ? Array.isArray(actual) && actual.includes(expected)
                : false;
          }))
          .map(([id, data]) => new Snapshot(id, data));
        return { docs, empty: !docs.length };
      },
    });
    return { where: (field, operator, value) => query([[field, operator, value]]) };
  },
};

Module._load = function(request, parent, isMain) {
  if (request === '../config/firebase' && parent?.filename.endsWith('pushNotifications.js')) {
    return {
      getDb: () => fakeDb,
      getMessaging: () => ({ send: async message => {
        if (messagingError) throw messagingError;
        sent.push(message);
        return 'message-id';
      } }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const service = require('../src/services/pushNotifications');
Module._load = originalLoad;

function reset() {
  documents = new Map();
  sent = [];
  messagingError = null;
  delete process.env.FCM_AUTOMATED_NOTIFICATIONS_ENABLED;
}

function doc(id, collection, values) { documents.set(id, { collection, ...values }); }

test('automated pushes remain disabled by default', async () => {
  reset();
  const result = await service.sendToPatient('patient-1', { type: 'medicine-reminder' });
  assert.equal(result.skipped, true);
  assert.equal(sent.length, 0);
});

test('patient and family delivery respects active grants, profile scope, roles, and preferences', async () => {
  reset();
  process.env.FCM_AUTOMATED_NOTIFICATIONS_ENABLED = 'true';
  doc('patient-access', 'notificationAccess', { patientId: 'patient-1', status: 'active', role: 'patient', authUid: 'patient-uid' });
  doc('family-access', 'notificationAccess', { patientId: 'patient-1', status: 'active', role: 'family', authUid: 'family-uid' });
  doc('revoked-access', 'notificationAccess', { patientId: 'patient-1', status: 'revoked', role: 'family', authUid: 'revoked-uid' });
  doc('patient-device', 'notificationTokens', { patientIds: ['patient-1'], principalUid: 'patient-uid', token: 'patient-token' });
  doc('family-device', 'notificationTokens', { patientIds: ['patient-1'], principalUid: 'family-uid', token: 'family-token', preferences: { medicine: true, health: false, emergency: true } });
  doc('revoked-device', 'notificationTokens', { patientIds: ['patient-1'], principalUid: 'revoked-uid', token: 'revoked-token' });
  doc('other-patient-device', 'notificationTokens', { patientIds: ['patient-2'], principalUid: 'family-uid', token: 'other-patient-token' });

  await service.sendToPatient('patient-1', { type: 'medicine-reminder' }, ['patient']);
  assert.deepEqual(sent.map(item => item.token).sort(), ['patient-token']);

  sent = [];
  await service.sendToPatient('patient-1', { type: 'health-alert' });
  assert.deepEqual(sent.map(item => item.token), ['patient-token']);
  assert.equal(sent.some(item => item.token === 'other-patient-token' || item.token === 'revoked-token'), false);
});

test('invalid push tokens are removed without exposing token values in logs', async () => {
  reset();
  process.env.FCM_AUTOMATED_NOTIFICATIONS_ENABLED = 'true';
  doc('patient-access', 'notificationAccess', { patientId: 'patient-1', status: 'active', role: 'patient', authUid: 'patient-uid' });
  doc('dead-device', 'notificationTokens', { patientIds: ['patient-1'], principalUid: 'patient-uid', token: 'secret-test-token' });
  messagingError = Object.assign(new Error('invalid token'), { code: 'messaging/registration-token-not-registered' });
  const result = await service.sendToPatient('patient-1', { type: 'medicine-reminder' }, ['patient']);
  assert.equal(result.removed, 1);
  assert.equal(documents.has('dead-device'), false);
});
