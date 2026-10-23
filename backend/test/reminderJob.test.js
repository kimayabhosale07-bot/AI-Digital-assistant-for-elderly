const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.MEDICINE_GRACE_PERIOD_MIN = '0';

const schedules = [];
const updates = [];
const medicineDoc = {
  data: () => ({ medicineName: 'Daily medicine', time: '00:00' }),
  ref: {
    update: async values => updates.push(values),
  },
};

const fakeDb = {
  collection(name) {
    if (name !== 'medicines') throw new Error(`Unexpected collection access: ${name}`);
    return {
      where: () => ({ get: async () => ({ docs: [medicineDoc] }) }),
      get: async () => ({ docs: [medicineDoc], empty: false, size: 1, forEach: callback => callback(medicineDoc) }),
    };
  },
  batch() {
    const batchUpdates = [];
    return {
      update: (ref, values) => batchUpdates.push(values),
      commit: async () => updates.push(...batchUpdates),
    };
  },
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'node-cron' && parent?.filename.endsWith('reminderJob.js')) {
    return { schedule: (expression, callback) => schedules.push({ expression, callback }) };
  }
  if (request === '../config/firebase' && parent?.filename.endsWith('reminderJob.js')) {
    return { getDb: () => fakeDb };
  }
  if (request === 'dotenv' && parent?.filename.endsWith('reminderJob.js')) {
    return { config: () => ({}) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { startReminderJob } = require('../src/jobs/reminderJob');
Module._load = originalLoad;

test('medicine overdue and daily reset jobs remain active without alert dispatch', async () => {
  schedules.length = 0;
  updates.length = 0;

  startReminderJob();
  assert.deepEqual(schedules.map(job => job.expression), ['* * * * *', '0 0 * * *']);

  await schedules[0].callback();
  assert.deepEqual(updates, [{ status: 'missed' }]);

  await schedules[1].callback();
  assert.deepEqual(updates, [{ status: 'missed' }, { status: 'pending' }]);
});
