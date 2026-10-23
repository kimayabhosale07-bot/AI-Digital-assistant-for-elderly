import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dashboard = fs.readFileSync(path.join(root, 'pages/dashboard.html'), 'utf8');
const appointments = fs.readFileSync(path.join(root, 'pages/appointments.html'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'js/api.js'), 'utf8');

function runFunction(source, startMarker, endMarker, globals = {}) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `located ${startMarker}`);
  const functionName = startMarker.match(/function\s+(\w+)/)[1];
  const context = { ...globals };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.run = ${functionName};`, context);
  return { context, run: context.run };
}

test('both dashboard medicine renderers use one accessible checkbox per dose and no Mark as Taken button', () => {
  for (const [source, marker, end] of [
    [dashboard, 'function renderMedicines(list)', 'function renderEmptyMedicines'],
    [dashboard, 'function renderModalMedicines()', 'async function handleModalAddMedicine'],
  ]) {
    const box = { innerHTML: '' };
    const { run } = runFunction(source, marker, end, {
      userMedicines: [{ medId: 'med-a', medicineName: 'Medicine A', dosage: '1 tablet', frequency: 'twice daily', todayDoses: [
        { scheduledTime: '08:00', status: 'taken' }, { scheduledTime: '20:00', status: 'pending' },
      ] }],
      medicineDataState: 'loaded', todayKey: '2026-10-24', escapeHtml: String,
      document: { getElementById: () => box },
    });
    run(marker.includes('renderModalMedicines') ? undefined : [{ medId: 'med-a', medicineName: 'Medicine A', dosage: '1 tablet', frequency: 'twice daily', todayDoses: [
      { scheduledTime: '08:00', status: 'taken' }, { scheduledTime: '20:00', status: 'pending' },
    ] }]);
    assert.equal((box.innerHTML.match(/type="checkbox"/g) || []).length, 2);
    assert.match(box.innerHTML, /data-dose-time="08:00"[^>]*checked/);
    assert.match(box.innerHTML, /data-dose-time="20:00"/);
    assert.doesNotMatch(box.innerHTML, /Mark as taken|Taken \/ Undo/);
  }
});

test('medicine checkbox sends the specific dose and restores its prior state after an API failure', async () => {
  const calls = [];
  const checkbox = { checked: true, disabled: false, dataset: { medId: 'med-a', doseTime: '20:00', doseDate: '2026-10-24' } };
  const { run } = runFunction(dashboard, 'async function setMedicineDoseTaken', 'async function setAppointmentCompleted', {
    pendingDoseUpdates: new Set(), window: { CareMateAPI: { updateMedicineDose: async (...args) => { calls.push(args); return { success: false, error: 'offline' }; } } },
    loadDashboard: async () => {}, renderModalMedicines() {}, speak() {}, alert() {},
  });
  await run(checkbox);
  assert.deepEqual(calls[0], ['med-a', 'taken', '2026-10-24', '20:00']);
  assert.equal(checkbox.checked, false);
  assert.equal(checkbox.disabled, false);
});

test('upcoming dashboard appointment checkbox never defaults a future visit to complete', () => {
  const box = { innerHTML: '' };
  const { run } = runFunction(dashboard, 'function renderUpcomingAppointments(appointments)', 'function renderAppointmentsUnavailable', {
    document: { getElementById: () => box }, escapeHtml: String,
  });
  run([{ apptId: 'future', doctorName: 'Dr. Future', date: '2099-01-01', time: '10:00', location: 'Clinic' }]);
  assert.match(box.innerHTML, /type="checkbox"[^>]*disabled/);
  assert.doesNotMatch(box.innerHTML, /type="checkbox"[^>]*checked/);
});

test('appointment log includes per-visit checkbox, calls completion API, and rolls back failures', async () => {
  assert.match(appointments, /filterProfileAppointments\(res\.data, userId\)/);
  const calls = [];
  const box = { innerHTML: '' };
  const render = runFunction(appointments, 'function renderAppointments()', 'function speakAppt', {
    appointments: [{ apptId: 'past-a', doctorName: 'Dr. Past', date: '2020-01-01', time: '10:00', location: 'Clinic', completed: false }],
    escapeHtml: String, document: { getElementById: () => box },
  });
  render.run();
  assert.match(box.innerHTML, /type="checkbox"[^>]*data-appt-id="past-a"/);
  const checkbox = { checked: true, disabled: false, dataset: { apptId: 'past-a' } };
  const handler = runFunction(appointments, 'async function setAppointmentCompleted', 'function speakAppt', {
    userId: 'profile-a', window: { CareMateAPI: { updateAppointmentCompletion: async (...args) => { calls.push(args); return { success: false, error: 'offline' }; } } },
    loadAppointments: async () => {}, alert() {},
  });
  await handler.run(checkbox);
  assert.deepEqual(calls[0], ['past-a', true, 'profile-a']);
  assert.equal(checkbox.checked, false);
  assert.equal(checkbox.disabled, false);
});

test('appointment completion API sends profile identity and a boolean without changing appointment status', async () => {
  let request;
  const context = { window: {}, AbortController, localStorage: { getItem(key) { return key === 'caremate_user_id' ? 'profile-a' : null; } }, setTimeout, clearTimeout, fetch: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ success: true }) }; } };
  vm.runInNewContext(`${apiSource}\nglobalThis.update = updateAppointmentCompletion;`, context);
  await context.update('visit-a', true);
  assert.match(request.url, /\/appointment\/visit-a\/completion$/);
  assert.equal(request.options.method, 'PUT');
  assert.deepEqual(JSON.parse(request.options.body), { userId: 'profile-a', completed: true });
});
