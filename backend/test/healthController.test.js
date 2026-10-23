const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let savedHealthLog;
const collectionCalls = [];
const fakeDb = {
  collection(name) {
    collectionCalls.push(name);
    if (name === 'users') {
      return { doc: () => ({ get: async () => ({ exists: true }) }) };
    }
    if (name === 'healthLogs') {
      return {
        add: async data => {
          savedHealthLog = data;
          return { id: 'health-log-1', update: async fields => Object.assign(savedHealthLog, fields) };
        },
      };
    }
    throw new Error(`Unexpected collection access: ${name}`);
  },
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '../config/firebase' && parent?.filename.endsWith('healthController.js')) {
    return { getDb: () => fakeDb };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { logHealthReading } = require('../src/controllers/healthController');
Module._load = originalLoad;

test('health readings remain logged and flagged without delivery side effects', async () => {
  collectionCalls.length = 0;
  savedHealthLog = undefined;
  let responseStatus;
  let responseBody;
  const response = {
    status(status) { responseStatus = status; return this; },
    json(body) { responseBody = body; return this; },
  };

  await logHealthReading({
    body: { userId: 'patient-1', heartRate: 110, steps: 1200 },
  }, response);

  assert.equal(responseStatus, 201);
  assert.equal(responseBody.flagged, true);
  assert.equal(savedHealthLog.heartRate, 110);
  assert.equal(savedHealthLog.logId, 'health-log-1');
  assert.deepEqual(collectionCalls, ['users', 'healthLogs']);
  assert.equal('notificationsSent' in responseBody, false);
  assert.equal('pushNotifications' in responseBody, false);
});
