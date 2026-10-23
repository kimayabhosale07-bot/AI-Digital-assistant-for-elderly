import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiSource = fs.readFileSync(path.join(root, 'js/api.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'pages/dashboard.html'), 'utf8');
const appointmentPage = fs.readFileSync(path.join(root, 'pages/appointments.html'), 'utf8');
const reminders = fs.readFileSync(path.join(root, 'js/reminders.js'), 'utf8');

function helperContext() {
  const context = { window: {}, localStorage: { getItem() { return null; } }, fetch: async () => { throw new Error('unexpected fetch'); } };
  vm.runInNewContext(`${apiSource}\nglobalThis.filter = filterUpcomingAppointments;`, context);
  return context;
}

function dashboardFunction(startMarker, endMarker, context) {
  const start = dashboard.indexOf(startMarker);
  const end = dashboard.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `found ${startMarker}`);
  vm.runInNewContext(`${dashboard.slice(start, end)}\nglobalThis.run = ${startMarker.match(/function (\w+)/)[1]};`, context);
}

const profile = 'profile-current';
const now = new Date('2026-10-23T12:00:00');
const fixtures = [
  { userId: profile, apptId: 'later', doctorName: 'Dr. Later', date: '2026-11-02', time: '09:00', location: 'North Clinic' },
  { userId: profile, apptId: 'soon', doctorName: 'Dr. Soon', date: '2026-10-24', time: '08:30', location: 'Pune' },
  { userId: profile, apptId: 'past', doctorName: 'Dr. Past', date: '2026-10-22', time: '10:00', location: 'Old Clinic' },
  { userId: profile, apptId: 'canceled', doctorName: 'Dr. Cancelled', date: '2026-10-25', time: '10:00', location: 'Clinic', status: 'cancelled' },
  { userId: 'another-profile', apptId: 'private', doctorName: 'Other Patient', date: '2026-10-24', time: '08:00', location: 'Private Clinic' },
];

test('upcoming appointments are profile-scoped, future-only, uncancelled, complete, and chronological', () => {
  const list = helperContext().filter(fixtures, profile, now);
  assert.deepEqual(list.map(item => item.apptId), ['soon', 'later']);
  assert.equal(list[0].doctorName, fixtures[1].doctorName);
  assert.equal(list[0].date, fixtures[1].date);
  assert.equal(list[0].time, fixtures[1].time);
  assert.equal(list[0].location, fixtures[1].location);
});

test('an empty API list renders the no-upcoming state without sample records', () => {
  const box = { innerHTML: '' };
  const context = { document: { getElementById: () => box }, escapeHtml: value => String(value) };
  dashboardFunction('function renderUpcomingAppointments', 'function renderAppointmentsUnavailable', context);
  context.run([]);
  assert.match(box.innerHTML, /No upcoming doctor visits\./);
  assert.doesNotMatch(box.innerHTML, /Dr\.|medicinal herbs|City Care Hospital/i);
});

test('appointment cards display the API doctor, date, time, location, and supported status', () => {
  const box = { innerHTML: '' };
  const context = { document: { getElementById: () => box }, escapeHtml: value => String(value) };
  dashboardFunction('function renderUpcomingAppointments', 'function renderAppointmentsUnavailable', context);
  context.run([{ ...fixtures[1], status: 'scheduled' }]);
  assert.match(box.innerHTML, /Dr\. Soon/);
  assert.match(box.innerHTML, /(?:October 24, 2026|24 October 2026)/);
  assert.match(box.innerHTML, /08:30/);
  assert.match(box.innerHTML, /Pune/);
  assert.match(box.innerHTML, /scheduled/);
});

test('an appointment API failure shows an error and does not render sample data', async () => {
  const errorCalls = [];
  const context = {
    userId: profile, userProfile: null, userMedicines: [], userAppointments: [],
    window: { CareMateAPI: {
      getUserProfile: async () => ({ success: false }),
      getMedicines: async () => ({ success: false }),
      getAppointments: async () => ({ success: false, error: 'offline' }),
      filterUpcomingAppointments: helperContext().filter,
    } },
    renderMedicinesUnavailable() {}, renderAppointmentsUnavailable() { errorCalls.push('error'); },
  };
  dashboardFunction('async function loadDashboard', 'function renderMedicines', context);
  await context.run();
  assert.deepEqual(errorCalls, ['error']);
  assert.deepEqual(context.userAppointments, []);
  assert.match(dashboard, /Upcoming appointments could not be loaded/);
  assert.match(appointmentPage, /Appointments could not be loaded/);
});

test('reloading appointment data replaces the list so new saves appear without duplicate merging', async () => {
  const states = [fixtures.slice(0, 2), [...fixtures.slice(0, 2), { userId: profile, apptId: 'new', doctorName: 'New Visit', date: '2026-12-01', time: '14:00', location: 'Clinic' }]];
  let index = 0;
  const rendered = [];
  const context = {
    userId: profile, userProfile: null, userMedicines: [], userAppointments: [],
    window: { CareMateAPI: {
      getUserProfile: async () => ({ success: false }),
      getMedicines: async () => ({ success: false }),
      getAppointments: async () => ({ success: true, data: states[Math.min(index++, states.length - 1)] }),
      filterUpcomingAppointments: helperContext().filter,
    } },
    renderMedicinesUnavailable() {}, renderAppointmentsUnavailable() {},
    renderUpcomingAppointments(items) { rendered.push(items.map(item => item.apptId)); },
  };
  dashboardFunction('async function loadDashboard', 'function renderMedicines', context);
  await context.run();
  await context.run();
  assert.deepEqual(rendered, [['soon', 'later'], ['soon', 'later', 'new']]);
  assert.equal(context.userAppointments.filter(item => item.apptId === 'soon').length, 1);
});

test('dashboard and appointment log use the same profile-scoped appointment API', () => {
  assert.match(dashboard, /CareMateAPI\.getAppointments\(userId\)/);
  assert.match(appointmentPage, /CareMateAPI\.getAppointments\(userId\)/);
  assert.match(dashboard, /filterUpcomingAppointments\(apptRes\.data, userId\)/);
  assert.match(appointmentPage, /filterProfileAppointments\(res\.data, userId\)/);
  assert.match(apiSource, /apiFetch\(`\/appointment\/\$\{encodeURIComponent\(uid\)\}`\)/);
});

test('legacy appointment renderer has no sample fixture or fabricated local save', () => {
  assert.doesNotMatch(reminders, /mockAppointments|Dr\. Priya Sharma|City Care Hospital|mock dates for the list/);
  assert.match(reminders, /CareMateAPI\.addAppointment\(/);
  assert.match(reminders, /if \(!result\.success\)/);
});

test('the dashboard still confirms real appointment and medicine actions through the existing API wrappers', async () => {
  const start = dashboard.indexOf('async function confirmAssistantAction(');
  const end = dashboard.indexOf('document.getElementById(\'assistant-action-confirm\').addEventListener', start);
  const confirmSource = dashboard.slice(start, end);
  for (const kind of ['add_appointment', 'add_medicine']) {
    const action = kind === 'add_appointment'
      ? { type: kind, fields: { doctorName: 'Dr. Test', date: '2099-06-01', time: '10:00', location: 'Clinic', idempotencyKey: 'test-appointment-draft-1' } }
      : { type: kind, fields: { confirmationToken: 'test-token' } };
    const calls = [];
    const button = { disabled: false };
    const confirmation = { hidden: false };
    const context = {
      assistantPendingAction: action, assistantConfirmationInFlight: false, assistantAppointmentWorkflow: { state: 'awaiting_confirmation' },
      assistantMedicineWorkflow: { state: 'awaiting_confirmation' }, userId: profile, todayKey: 'today',
      window: { CareMateAPI: {
        addAppointment: async payload => { calls.push(['appointment', payload]); return { success: true, data: { success: true } }; },
        confirmAssistantMedicine: async (...payload) => { calls.push(['medicine', ...payload]); return { success: true, data: { success: true, message: 'saved' } }; },
      } },
      document: { getElementById(id) { return id === 'assistant-action-confirmation' ? confirmation : button; } },
      clearAssistantPendingAction() {}, loadDashboard: async () => {}, renderModalMedicines() {}, renderModalAppointments() {},
      addConversationMessage() {}, setVoiceState() {}, console: { warn() {} },
    };
    vm.runInNewContext(`${confirmSource}\nglobalThis.confirm = confirmAssistantAction;`, context);
    await context.confirm();
    assert.equal(calls.length, 1);
    if (kind === 'add_appointment') {
      assert.equal(calls[0][0], 'appointment');
      assert.equal(calls[0][1].confirmed, true);
      assert.equal(calls[0][1].idempotencyKey, action.fields.idempotencyKey);
      assert.equal(context.assistantAppointmentWorkflow.state, 'saved');
    } else {
      assert.deepEqual(calls[0], ['medicine', 'test-token', profile]);
      assert.equal(context.assistantMedicineWorkflow.state, 'saved');
    }
  }
});

test('voice transcript failures keep a type/retry path and display recognition errors', () => {
  const dictation = fs.readFileSync(path.join(root, 'js/dictation.js'), 'utf8');
  assert.match(dictation, /recognition\.onerror/);
  assert.match(dictation, /Voice input failed|speech recognition/i);
  assert.match(dictation, /type instead|Try again/i);
  assert.match(dashboard, /Type a message or use the microphone/);
});

