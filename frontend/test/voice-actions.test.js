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
    switchMedTab: () => assert.fail('Voice medicine save should stay in the Voice Companion'),
    switchApptTab: () => assert.fail('Voice visit save should stay in the Voice Companion'),
  };
  vm.runInNewContext(`${source}\nglobalThis.saveHandler = ${isMedicine ? 'handleModalAddMedicine' : 'handleModalAddAppointment'};`, context);

  return {
    run() { return context.saveHandler({ currentTarget: form, preventDefault() {} }); },
    fields, form, alertBox, button, calls, messages,
    get refreshes() { return refreshes; },
  };
}

test('Voice Companion actions mount the existing medicine and appointment forms', () => {
  assert.match(dashboard, /id="voice-action-add-medicine"[^>]*beginVoiceAction\('medicine'\)/);
  assert.match(dashboard, /id="voice-action-add-visit"[^>]*beginVoiceAction\('visit'\)/);
  assert.match(dashboard, /paneId: 'pane-med-add'/);
  assert.match(dashboard, /paneId: 'pane-appt-add'/);
  assert.match(dashboard, /slot\.appendChild\(pane\)/);
  assert.match(dashboard, /onsubmit="handleModalAddMedicine\(event\)"/);
  assert.match(dashboard, /onsubmit="handleModalAddAppointment\(event\)"/);
  assert.match(dashboard, /function returnToVoiceActions\(\)/);
  assert.match(dashboard, /function cancelVoiceAction\(\)/);
});

test('Back preserves the draft and Cancel resets it before returning to the action menu', () => {
  const form = { dataset: { saving: 'false' }, resetCount: 0, reset() { this.resetCount += 1; } };
  const alertBox = { style: { display: 'block' } };
  const dictationStatus = { textContent: 'Listening status' };
  const trigger = { focusCount: 0, focus() { this.focusCount += 1; } };
  const stateMessages = [];
  let restored = 0;
  let stoppedRecognition = 0;
  const node = {
    querySelector(selector) { return selector === 'form' ? form : null; },
    querySelectorAll(selector) { return selector === '.alert' ? [alertBox] : [dictationStatus]; },
  };

  const backContext = {
    voiceActionFormNode: node,
    voiceActionKind: 'medicine',
    restoreVoiceActionForm() { restored += 1; },
    document: { getElementById() { return trigger; } },
    setVoiceState: (...args) => stateMessages.push(args),
  };
  vm.runInNewContext(`${extractFlowFunction('returnToVoiceActions', 'cancelVoiceAction')}\nglobalThis.run = returnToVoiceActions;`, backContext);
  backContext.run();
  assert.equal(restored, 1);
  assert.equal(form.resetCount, 0);
  assert.equal(trigger.focusCount, 1);
  assert.match(stateMessages[0][1], /draft is kept/i);

  restored = 0;
  const cancelContext = {
    voiceActionFormNode: node,
    voiceActionKind: 'visit',
    restoreVoiceActionForm(stopRecognition) { restored += 1; assert.equal(stopRecognition, false); },
    window: { CareWiseDictation: { stopAll() { stoppedRecognition += 1; } } },
    document: { getElementById() { return trigger; } },
    setVoiceState: (...args) => stateMessages.push(args),
  };
  vm.runInNewContext(`${extractFlowFunction('cancelVoiceAction', 'finishVoiceAction')}\nglobalThis.run = cancelVoiceAction;`, cancelContext);
  cancelContext.run();
  assert.equal(form.resetCount, 1);
  assert.equal(alertBox.style.display, 'none');
  assert.equal(dictationStatus.textContent, '');
  assert.equal(stoppedRecognition, 1);
  assert.equal(restored, 1);
  assert.match(stateMessages.at(-1)[1], /cancelled/i);
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
  assert.match(h.messages[0], /Medicine saved/);
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
  assert.match(valid.messages[0], /Visit saved/);

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
