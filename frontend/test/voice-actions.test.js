import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const dashboard = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../pages/dashboard.html'), 'utf8');

function extractHandler(name, nextSection) {
  const start = dashboard.indexOf(`async function ${name}(e) {`);
  const end = dashboard.indexOf(nextSection, start);
  assert.notEqual(start, -1, `${name} exists`);
  assert.notEqual(end, -1, `section after ${name} exists`);
  return dashboard.slice(start, end);
}

function extractFlowFunction(name, nextFunction) {
  const start = dashboard.indexOf(`function ${name}(`);
  const end = dashboard.indexOf(`function ${nextFunction}(`, start);
  assert.notEqual(start, -1, `${name} exists`);
  assert.notEqual(end, -1, `${nextFunction} follows ${name}`);
  return dashboard.slice(start, end);
}

function createSaveHarness({ kind, voiceFlow = true, values, apiResult, apiPromise } = {}) {
  const isMedicine = kind === 'medicine';
  const fields = new Map(Object.entries(values));
  const alertBox = { style: {}, textContent: '' };
  const button = { textContent: '', disabled: false };
  const form = {
    dataset: {},
    closest(selector) { return selector === '#voice-action-form-slot' && voiceFlow ? {} : null; },
  };
  const calls = [];
  let refreshes = 0;
  let selectedTab = null;
  const messages = [];
  const api = isMedicine
    ? { addMedicine(payload) { calls.push(payload); return apiPromise ? apiPromise.promise : Promise.resolve(apiResult); } }
    : { addAppointment(payload) { calls.push(payload); return apiPromise ? apiPromise.promise : Promise.resolve(apiResult); } };

  const document = {
    getElementById(id) {
      if (id === (isMedicine ? 'modal-med-alert' : 'modal-appt-alert')) return alertBox;
      if (id === (isMedicine ? 'btn-modal-save-med' : 'btn-modal-save-appt')) return button;
      return { value: fields.get(id) || '' };
    },
  };
  const source = isMedicine
    ? extractHandler('handleModalAddMedicine', '// 2. Appointments Modal Triggers')
    : extractHandler('handleModalAddAppointment', '// 3. Health Vitals Modal Triggers');
  const context = {
    window: { CareMateAPI: api },
    document,
    userId: 'test-user',
    loadDashboard: async () => { refreshes += 1; },
    finishVoiceAction: message => messages.push(message),
    switchMedTab: tab => { selectedTab = tab; },
    switchApptTab: tab => { selectedTab = tab; },
  };
  vm.runInNewContext(`${source}\nglobalThis.saveHandler = ${isMedicine ? 'handleModalAddMedicine' : 'handleModalAddAppointment'};`, context);

  return {
    run() { return context.saveHandler({ currentTarget: form, preventDefault() {} }); },
    fields, form, alertBox, button, calls, messages,
    get refreshes() { return refreshes; },
    get selectedTab() { return selectedTab; },
  };
}

test('Voice Companion uses chat and retains separate existing record forms', () => {
  assert.match(dashboard, /id="voice-chat-messages"/);
  assert.match(dashboard, /id="drawer-voice-transcript"/);
  assert.match(dashboard, /id="btn-submit-voice"/);
  assert.match(dashboard, /id="assistant-action-confirm"/);
  assert.doesNotMatch(dashboard, /voice-action-add-medicine|voice-action-add-visit/);
  assert.match(dashboard, /onsubmit="handleModalAddMedicine\(event\)"/);
  assert.match(dashboard, /onsubmit="handleModalAddAppointment\(event\)"/);
});

test('medicine chat confirmation calls the signed backend action and retains its draft when saving fails', () => {
  const sendFlow = extractFlowFunction('sendAssistantPrompt', 'confirmAssistantAction');
  const confirmFlow = extractFlowFunction('confirmAssistantAction', 'resetMic');
  assert.match(sendFlow, /assistantMedicinePendingAction && medicineConfirmation[\s\S]*await confirmAssistantAction\(\)[\s\S]*return/);
  assert.match(confirmFlow, /CareMateAPI\.confirmAssistantMedicine\(fields\.confirmationToken, userId\)/);
  assert.doesNotMatch(confirmFlow, /CareMateAPI\.addMedicine/);
  assert.match(confirmFlow, /if \(medicineSaved[\s\S]*clearAssistantPendingAction\(action\.type\)/);
  assert.match(confirmFlow, /confirmed draft is still available to retry/);
  assert.match(sendFlow, /messages: assistantConversation\.slice\(-30\)/);
  assert.match(sendFlow, /medicineDraftId: assistantMedicineWorkflow\?\.draftId/);
  assert.match(sendFlow, /appointmentDraftId: assistantAppointmentWorkflow\?\.draftId/);
  assert.match(confirmFlow, /addAppointment\(\{ userId, \.\.\.fields, confirmed: true \}\)/);
  assert.doesNotMatch(sendFlow, /assistantPendingAction = null;\s*document\.getElementById\('assistant-action-confirmation'\)\.hidden = true;\s*if \(assistantDemoMode\)/);
});

test('appointment confirmation phrase dispatches the pending appointment before incomplete medicine state', async () => {
  const start = dashboard.indexOf('async function sendAssistantPrompt(');
  const end = dashboard.indexOf('async function confirmAssistantAction(', start);
  const sendFlow = dashboard.slice(start, end);
  const appointmentAction = { type: 'add_appointment', fields: { doctorName: 'Dr. Birla', date: '2026-10-24', time: '10:00', location: 'Pune, Maharashtra', idempotencyKey: 'appointment-draft-00000001' } };
  const calls = [];
  const context = {
    assistantRequestInFlight: false,
    assistantPendingAction: appointmentAction,
    assistantAppointmentPendingAction: appointmentAction,
    assistantAppointmentWorkflow: { state: 'awaiting_confirmation', draftId: 'appointment-draft-00000001' },
    assistantMedicinePendingAction: null,
    assistantMedicineWorkflow: { state: 'collecting_details', missingFields: ['medicine name', 'strength'] },
    assistantPendingActionType: 'add_appointment',
    addConversationMessage: (...args) => calls.push(['message', ...args]),
    setVoiceState: (...args) => calls.push(['state', ...args]),
    confirmAssistantAction: async () => calls.push(['confirm', context.assistantPendingAction]),
  };
  vm.runInNewContext(`${sendFlow}\nglobalThis.send = sendAssistantPrompt;`, context);
  await context.send('Yes, save it in appointment log.');
  assert.equal(calls.filter(([kind]) => kind === 'confirm').length, 1);
  assert.equal(calls.find(([kind]) => kind === 'confirm')[1].type, 'add_appointment');
  assert.equal(calls.some(([kind, , text]) => kind === 'message' && /medicine name|strength/.test(String(text))), false);
  context.assistantAppointmentWorkflow.state = 'save_failed';
  await context.send('Yes, save it in appointment log.');
  assert.equal(calls.filter(([kind]) => kind === 'confirm').length, 2, 'the same appointment draft can be retried after a save failure');
  const confirmFlow = extractFlowFunction('confirmAssistantAction', 'resetMic');
  assert.match(confirmFlow, /addAppointment\(\{ userId, \.\.\.fields, confirmed: true \}\)/);
  assert.match(confirmFlow, /state: 'save_failed'/);
  assert.match(confirmFlow, /confirmed draft is still available to retry/);
  assert.ok(sendFlow.indexOf('assistantAppointmentPendingAction &&') < sendFlow.indexOf("assistantMedicineWorkflow?.state === 'collecting_details'"));
});

test('natural-language appointment date and AM time produce a confirmation summary', () => {
  const summaryFlow = extractFlowFunction('actionDraftSummary', 'appointmentFieldReply');
  const context = {
    assistantConversation: [{ role: 'user', content: 'Add Dr. Visit Dr. Aditya Virna on 24 October 2026, 10am address Pune, Maharashtra' }],
    userMedicines: [],
    medicineDataState: 'loaded',
  };
  vm.runInNewContext(`${summaryFlow}\nglobalThis.summarize = actionDraftSummary;`, context);
  const draft = context.summarize({ type: 'add_appointment', fields: {
    doctorName: 'Dr. Aditya Virna', date: '2026-10-24', time: '10:00', location: 'Pune, Maharashtra', idempotencyKey: 'appointment-draft-00000001',
  } });
  assert.match(draft.summary, /Dr\. Aditya Virna/);
  assert.match(draft.summary, /2026-10-24/);
  assert.match(draft.summary, /10:00/);
});

test('dashboard inline JavaScript parses after the Voice Companion integration', () => {
  const inlineScripts = [...dashboard.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim())
    .filter(Boolean);
  assert.ok(inlineScripts.length > 0);
  inlineScripts.forEach((script, index) => {
    assert.doesNotThrow(() => new vm.Script(script, { filename: `dashboard-inline-${index}.js` }));
  });
});

test('Add Medicine uses the existing save API, refreshes the list, and reports success', async () => {
  const h = createSaveHarness({
    kind: 'medicine',
    values: {
      'm-med-name': 'Lisinopril',
      'm-med-dosage': '10 mg each morning',
      'm-med-time': '08:30',
      'm-med-freq': 'Daily',
    },
    apiResult: { success: true },
  });
  await h.run();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].userId, 'test-user');
  assert.equal(h.calls[0].medicineName, 'Lisinopril');
  assert.equal(h.calls[0].dosage, '10 mg each morning');
  assert.equal(h.refreshes, 1);
  assert.equal(h.selectedTab, 'list');
});

test('Add Visit uses the existing save API and rejects invalid date/time before saving', async () => {
  const valid = createSaveHarness({
    kind: 'visit',
    values: {
      'm-doc-name': 'Dr. Rao',
      'm-doc-date': '2027-01-15',
      'm-doc-time': '11:30',
      'm-doc-loc': 'Care Clinic',
    },
    apiResult: { success: true },
  });
  await valid.run();
  assert.equal(valid.calls.length, 1);
  assert.equal(valid.calls[0].doctorName, 'Dr. Rao');
  assert.equal(valid.calls[0].location, 'Care Clinic');
  assert.equal(valid.refreshes, 1);
  assert.equal(valid.selectedTab, 'list');

  const invalid = createSaveHarness({
    kind: 'visit',
    values: { 'm-doc-name': 'Dr. Rao', 'm-doc-date': 'tomorrow', 'm-doc-time': '25:61', 'm-doc-loc': 'Care Clinic' },
    apiResult: { success: true },
  });
  await invalid.run();
  assert.equal(invalid.calls.length, 0);
  assert.match(invalid.alertBox.textContent, /Invalid date/);
  assert.equal(invalid.form.dataset.saving, 'false');
});

test('duplicate medicine submissions are ignored while the existing save is pending', async () => {
  let resolveSave;
  const apiPromise = { resolve: null };
  apiPromise.promise = new Promise(resolve => { resolveSave = resolve; });
  const h = createSaveHarness({
    kind: 'medicine',
    values: { 'm-med-name': 'Metformin', 'm-med-dosage': '500 mg', 'm-med-time': '08:00', 'm-med-freq': 'Daily' },
    apiPromise: { promise: apiPromise.promise, resolve: resolveSave },
  });
  const first = h.run();
  await h.run();
  assert.equal(h.calls.length, 1);
  resolveSave({ success: true });
  await first;
  assert.equal(h.refreshes, 1);
});

test('duplicate visit submissions are ignored while the existing save is pending', async () => {
  let resolveSave;
  const h = createSaveHarness({
    kind: 'visit',
    values: { 'm-doc-name': 'Dr. Rao', 'm-doc-date': '2027-01-15', 'm-doc-time': '11:30', 'm-doc-loc': 'Care Clinic' },
    apiPromise: { promise: new Promise(resolve => { resolveSave = resolve; }) },
  });
  const first = h.run();
  await h.run();
  assert.equal(h.calls.length, 1);
  resolveSave({ success: true });
  await first;
  assert.equal(h.refreshes, 1);
});

test('a rejected API save keeps dictated form values available for correction and retry', async () => {
  const h = createSaveHarness({
    kind: 'medicine',
    values: { 'm-med-name': 'A medicine', 'm-med-dosage': 'One tablet', 'm-med-time': '08:30', 'm-med-freq': 'Daily' },
    apiResult: { success: false, error: 'Could not save medicine.' },
  });
  await h.run();
  assert.equal(h.fields.get('m-med-name'), 'A medicine');
  assert.equal(h.alertBox.textContent, 'Could not save medicine.');
  assert.equal(h.refreshes, 0);
});
