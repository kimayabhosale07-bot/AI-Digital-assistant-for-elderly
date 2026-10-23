import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'js/health.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'pages/dashboard.html'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'js/api.js'), 'utf8');
const legacyNavSources = ['appointments.html', 'reminders.html', 'contacts.html'].map(file => fs.readFileSync(path.join(root, 'pages', file), 'utf8'));
const sharedAppSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

function loadHealthHelpers() {
  const context = {
    window: { CareMateAPI: { validateHealthLogPayload: () => null } },
    document: { addEventListener() {} },
  };
  vm.runInNewContext(source, context);
  return context.window.CarewiseHealthLogs;
}

test('7, 30, and 90 day filtering retains multiple readings and excludes other profiles', () => {
  const helpers = loadHealthHelpers();
  const now = Date.parse('2026-10-23T12:00:00Z');
  const history = [
    { userId: 'patient-a', type: 'heart_rate', value: 70, unit: 'bpm', timestamp: '2026-10-23T08:00:00Z' },
    { userId: 'patient-a', type: 'heart_rate', value: 72, unit: 'bpm', timestamp: '2026-10-23T09:00:00Z' },
    { userId: 'patient-a', type: 'heart_rate', value: 74, unit: 'bpm', timestamp: '2026-09-29T09:00:00Z' },
    { userId: 'patient-a', type: 'heart_rate', value: 80, unit: 'bpm', timestamp: '2026-07-30T09:00:00Z' },
    { userId: 'patient-b', type: 'heart_rate', value: 99, unit: 'bpm', timestamp: '2026-10-23T10:00:00Z' },
  ];
  assert.equal(helpers.filterHealthHistory(history, 'heart_rate', 7, now, 'patient-a').length, 2);
  assert.equal(helpers.filterHealthHistory(history, 'heart_rate', 30, now, 'patient-a').length, 3);
  assert.equal(helpers.filterHealthHistory(history, 'heart_rate', 90, now, 'patient-a').length, 4);
  assert.deepEqual(helpers.filterHealthHistory([], 'heart_rate', 7, now, 'patient-a'), []);
});

test('legacy heart-rate records normalize while nonmatching or ownerless records are excluded', () => {
  const helpers = loadHealthHelpers();
  const history = [
    { userId: 'patient-a', heartRate: 76, timestamp: '2026-10-23T09:00:00Z' },
    { userId: 'patient-a', type: 'blood_sugar', value: 110, unit: 'mg/dL', timestamp: '2026-10-23T09:00:00Z' },
    { userId: 'patient-b', type: 'heart_rate', value: 99, unit: 'bpm', timestamp: '2026-10-23T09:00:00Z' },
  ];
  const result = helpers.filterHealthHistory(history, 'heart_rate', 7, Date.parse('2026-10-23T12:00:00Z'), 'patient-a');
  assert.equal(result.length, 1);
  assert.equal(result[0].value, 76);
  assert.equal(helpers.filterHealthHistory(history, 'heart_rate', 7, Date.now(), null).length, 0);
});

test('steps history filters to the current profile and displays typed and legacy step records', () => {
  const helpers = loadHealthHelpers();
  const now = Date.parse('2026-10-23T12:00:00Z');
  const history = [
    { userId: 'patient-a', type: 'steps', value: 4200, unit: 'steps', timestamp: '2026-10-23T09:00:00Z' },
    { userId: 'patient-a', type: 'heart_rate', heartRate: 74, steps: 3000, timestamp: '2026-10-22T09:00:00Z' },
    { userId: 'patient-a', type: 'steps', value: 1800, unit: 'steps', timestamp: '2026-09-01T09:00:00Z' },
    { userId: 'patient-b', type: 'steps', value: 9000, unit: 'steps', timestamp: '2026-10-23T10:00:00Z' },
  ];
  const filtered = helpers.filterStepsHistory(history, 7, now, 'patient-a');
  assert.deepEqual(filtered.map(record => record.value), [4200, 3000]);
  const markup = helpers.buildStepsHistoryHtml(filtered);
  assert.match(markup, /4,200 steps/);
  assert.match(markup, /3,000 steps/);
  assert.doesNotMatch(markup, /9,000/);
});

test('dashboard has one Health Logs modal control, a five-metric summary, and no duplicate trigger', () => {
  assert.doesNotMatch(dashboard, /id="nav-health"/);
  assert.equal((dashboard.match(/onclick="openVitalsModal\(\)"/g) || []).length, 1);
  assert.match(dashboard, /onclick="openVitalsModal\(\)"[^>]*>View Health Logs/);
  assert.doesNotMatch(dashboard, />Quick Log<\/button>/);
  for (const type of ['blood-pressure', 'heart-rate', 'blood-sugar', 'body-temperature', 'oxygen-saturation', 'steps']) {
    assert.match(dashboard, new RegExp(`id="health-summary-${type}"[^>]*>No reading yet`));
  }
  assert.ok(dashboard.indexOf('health-summary-steps') > dashboard.indexOf('health-summary-oxygen-saturation'));
  assert.match(dashboard, /id="dashboard-health-status"/);
  assert.doesNotMatch(dashboard, /href=["'](?:\.\/)?health\.html/);
  assert.match(dashboard, /id="modal-vitals" role="dialog"/);
  assert.match(dashboard, /<script src="\.\.\/js\/health\.js"><\/script>/);
  assert.match(dashboard, /id="btn-modal-save-vitals"/);
  assert.equal(fs.existsSync(path.join(root, 'pages/health.html')), false);
  for (const sourceText of [...legacyNavSources, sharedAppSource]) assert.doesNotMatch(sourceText, /(?:href=|href:\s*)['"]health\.html['"]/);
  const modalStart = dashboard.indexOf('id="modal-vitals"');
  const modalEnd = dashboard.indexOf('4. RIGHT-SIDE DRAWER:', modalStart);
  const modal = dashboard.slice(modalStart, modalEnd);
  for (const type of ['blood_pressure', 'heart_rate', 'blood_sugar', 'body_temperature', 'oxygen_saturation']) assert.match(modal, new RegExp(type));
  assert.match(modal, /health-history-status/);
  assert.match(modal, /health-history-retry/);
  assert.match(source, /data-days="7"/);
  assert.match(source, /data-days="30"/);
  assert.match(source, /data-days="90"/);
  assert.match(source, /No readings recorded in this period/);
  assert.match(source, /health-status--error/);
  assert.match(source, /getHealthLogs\(profileId\)/);
  assert.match(source, /refreshDashboardHealthSummary\(\)/);
});

test('quick-log form keeps steps only and submits no heart-rate value', () => {
  assert.match(dashboard, /Quick log: steps/);
  assert.match(dashboard, /id="m-input-steps"/);
  assert.doesNotMatch(dashboard, /id="m-input-hr"/);
  assert.match(dashboard, /id="steps-history-list"/);
  assert.match(dashboard, /data-steps-days="7"[\s\S]*data-steps-days="30"[\s\S]*data-steps-days="90"/);
  const handler = dashboard.match(/async function handleModalLogHealth\(e\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(handler);
  assert.match(handler, /type:\s*'steps'/);
  assert.match(handler, /value:\s*steps/);
  assert.match(handler, /unit:\s*'steps'/);
  assert.match(handler, /timestamp/);
  assert.doesNotMatch(handler, /heartRate|\bhr\b/);
});

test('quick-log submission sends a validated typed Steps payload and confirms only API success', async () => {
  const handler = dashboard.match(/async function handleModalLogHealth\(e\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(handler);
  const controls = new Map([
    ['m-input-steps', { value: '4321' }],
    ['steps-quick-log-status', { textContent: '', className: '' }],
    ['btn-modal-save-vitals', { textContent: '', disabled: false }],
  ]);
  let request;
  let historyReloads = 0;
  const validationPayloads = [];
  const context = {
    window: {
      CareMateAPI: {
        validateHealthLogPayload: payload => { validationPayloads.push(payload); return null; },
        logHealthReading: async payload => { request = payload; return { success: true, data: { logId: 'mock-step-id' } }; },
      },
      CarewiseHealthLogs: { loadHealthHistory: async () => { historyReloads++; return true; } },
    },
    document: { getElementById: id => controls.get(id) },
    userId: 'patient-a',
  };
  const result = vm.runInNewContext(`${handler}\nhandleModalLogHealth({ preventDefault() {} });`, context);
  await result;
  assert.deepEqual(JSON.parse(JSON.stringify(validationPayloads[0])), {
    type: 'steps', value: 4321, unit: 'steps', timestamp: validationPayloads[0].timestamp,
  });
  assert.equal(Number.isFinite(Date.parse(request.timestamp)), true);
  assert.equal(request.userId, 'patient-a');
  assert.equal(request.type, 'steps');
  assert.equal(request.value, 4321);
  assert.equal(request.unit, 'steps');
  assert.equal(historyReloads, 1);
  assert.match(controls.get('steps-quick-log-status').textContent, /Steps saved/);
});

function loadDashboardSummary(apiResponses) {
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { textContent: '' });
    return elements.get(id);
  } };
  const context = {
    window: { CareMateAPI: { getHealthLogs: async () => apiResponses.shift() } },
    document,
    userId: 'patient-a',
  };
  const match = dashboard.match(/async function refreshDashboardHealthSummary\(\) \{[\s\S]*?\n    window\.refreshDashboardHealthSummary = refreshDashboardHealthSummary;/);
  assert.ok(match, 'dashboard summary loader should be present and exposed for save refreshes');
  vm.runInNewContext(match[0], context);
  return { elements, context };
}

test('dashboard summary renders actual latest readings for the current profile and explicit empty states', async () => {
  const rows = [
    { userId: 'patient-a', type: 'heart_rate', value: 68, unit: 'bpm', timestamp: '2026-10-22T11:00:00Z' },
    { userId: 'patient-a', type: 'blood_pressure', systolic: 126, diastolic: 82, unit: 'mmHg', timestamp: '2026-10-23T10:00:00Z' },
    { userId: 'patient-a', type: 'heart_rate', value: 72, unit: 'bpm', timestamp: '2026-10-23T11:00:00Z' },
    { userId: 'patient-a', type: 'blood_sugar', value: 105, unit: 'mg/dL', context: 'fasting', timestamp: '2026-10-23T09:00:00Z' },
    { userId: 'patient-a', type: 'body_temperature', value: 36.8, unit: '°C', timestamp: '2026-10-23T08:00:00Z' },
    { userId: 'patient-a', type: 'oxygen_saturation', value: 97, unit: '%', timestamp: '2026-10-23T07:00:00Z' },
    { userId: 'patient-a', type: 'steps', value: 2400, unit: 'steps', steps: 2400, timestamp: '2026-10-23T06:00:00Z' },
    { userId: 'patient-b', type: 'heart_rate', value: 99, unit: 'bpm', timestamp: '2026-10-23T12:00:00Z' },
  ];
  const { elements, context } = loadDashboardSummary([{ success: true, data: rows }]);
  assert.equal(await context.window.refreshDashboardHealthSummary(), true);
  assert.equal(elements.get('health-summary-blood-pressure').textContent, '126/82 mmHg');
  assert.equal(elements.get('health-summary-heart-rate').textContent, '72 bpm');
  assert.equal(elements.get('health-summary-blood-sugar').textContent, '105 mg/dL · fasting');
  assert.equal(elements.get('health-summary-body-temperature').textContent, '36.8 °C');
  assert.equal(elements.get('health-summary-oxygen-saturation').textContent, '97 %');
  assert.equal(elements.get('health-summary-steps').textContent, '2,400 steps');
  assert.equal(elements.get('dashboard-health-status').textContent, 'Latest saved readings');

  context.window.CareMateAPI.getHealthLogs = async () => ({ success: true, data: [...rows, { userId: 'patient-a', type: 'heart_rate', value: 74, unit: 'bpm', timestamp: '2026-10-23T12:00:00Z' }] });
  assert.equal(await context.window.refreshDashboardHealthSummary(), true);
  assert.equal(elements.get('health-summary-heart-rate').textContent, '74 bpm', 'a successful save followed by refresh shows the new saved value');

  const empty = loadDashboardSummary([{ success: true, data: [] }]);
  assert.equal(await empty.context.window.refreshDashboardHealthSummary(), true);
  for (const type of ['blood-pressure', 'heart-rate', 'blood-sugar', 'body-temperature', 'oxygen-saturation', 'steps']) {
    assert.equal(empty.elements.get(`health-summary-${type}`).textContent, 'No reading yet');
  }

  const failed = loadDashboardSummary([{ success: false, error: 'offline' }]);
  assert.equal(await failed.context.window.refreshDashboardHealthSummary(), false);
  assert.equal(failed.elements.get('health-summary-heart-rate').textContent, 'Health readings unavailable');
  assert.match(failed.elements.get('dashboard-health-status').textContent, /could not be loaded/);
});

test('successful steps quick-log save refreshes Health Logs history', () => {
  const handler = dashboard.match(/async function handleModalLogHealth\(e\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(handler);
  assert.match(handler, /logHealthReading\(\{[\s\S]*?type:\s*'steps',[\s\S]*?value:\s*steps,[\s\S]*?unit:\s*'steps',[\s\S]*?timestamp/);
  assert.match(handler, /if \(window\.CarewiseHealthLogs\) await window\.CarewiseHealthLogs\.loadHealthHistory\(\)/);
  assert.doesNotMatch(handler, /refreshDashboardHealthSummary/);
});

test('opening the Health Logs control initializes once and reloads history on later opens', () => {
  const functionSource = dashboard.match(/function openVitalsModal\(\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(functionSource);
  const calls = [];
  const context = {
    window: { CarewiseHealthLogs: { init: () => { calls.push('init'); return false; }, loadHealthHistory: () => calls.push('load') } },
    document: { getElementById: () => ({ style: {}, focus() {} }) },
    openModalOverlay: id => calls.push(id),
    setTimeout: callback => callback(),
  };
  vm.runInNewContext(`${functionSource}\nopenVitalsModal();`, context);
  assert.deepEqual(calls, ['modal-vitals', 'init', 'load']);
  assert.doesNotMatch(functionSource, /location\.(?:href|assign)/);
});

test('all five measurement types accept valid values and reject invalid inputs in the client validator', () => {
  const context = { window: {}, localStorage: { getItem: () => null }, AbortController, setTimeout, clearTimeout, fetch: async () => {} };
  vm.runInNewContext(apiSource, context);
  const validate = context.window.CareMateAPI.validateHealthLogPayload;
  const timestamp = new Date().toISOString();
  const valid = [
    { type: 'blood_pressure', systolic: 120, diastolic: 80, unit: 'mmHg', timestamp },
    { type: 'heart_rate', value: 72, unit: 'bpm', timestamp },
    { type: 'blood_sugar', value: 110, unit: 'mg/dL', context: 'after_meal', timestamp },
    { type: 'body_temperature', value: 37, unit: '°C', timestamp },
    { type: 'oxygen_saturation', value: 98, unit: '%', timestamp },
  ];
  valid.forEach(payload => assert.equal(validate(payload), null));
  assert.equal(validate({ steps: 2400 }), null);
  assert.match(validate({ steps: 100000.5 }), /whole number/);
  assert.equal(validate({ type: 'steps', value: 2400, unit: 'steps', timestamp }), null);
  assert.match(validate({ type: 'steps', value: 2400.5, unit: 'steps', timestamp }), /whole number/);
  assert.match(validate({ ...valid[2], context: undefined }), /blood sugar measurement context/);
  assert.match(validate({ ...valid[4], value: 101 }), /supported entry range/);
});

test('failed save and history requests have error messages and cannot report a save success', () => {
  assert.match(source, /The measurement could not be saved/);
  assert.match(source, /Your measurement was not reported as saved/);
  assert.match(source, /Health history could not be loaded/);
  assert.match(source, /Measurement saved to your health log/);
});

test('health API wrappers use only the current local profile and reject a different requested profile', async () => {
  const requests = [];
  const context = {
    window: {},
    localStorage: { getItem: key => key === 'caremate_user_id' ? 'patient-a' : null, setItem() {}, removeItem() {} },
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async url => {
      requests.push(url);
      return { ok: true, status: 200, json: async () => [] };
    },
  };
  vm.runInNewContext(apiSource, context);
  const denied = await context.window.CareMateAPI.getHealthLogs('patient-b');
  assert.equal(denied.success, false);
  assert.equal(requests.length, 0);
  const allowed = await context.window.CareMateAPI.getHealthLogs('patient-a');
  assert.equal(allowed.success, true);
  assert.match(requests[0], /health-log\/patient-a$/);
});

test('health API client posts explicit Steps type, numeric count, unit, and timestamp', async () => {
  const requests = [];
  const context = {
    window: {},
    localStorage: { getItem: key => key === 'caremate_user_id' ? 'patient-a' : null, setItem() {}, removeItem() {} },
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ success: true, data: { logId: 'test-only' } }) };
    },
  };
  vm.runInNewContext(apiSource, context);
  const timestamp = new Date().toISOString();
  const result = await context.window.CareMateAPI.logHealthReading({ userId: 'patient-a', type: 'steps', value: 3210, unit: 'steps', timestamp });
  assert.equal(result.success, true);
  assert.match(requests[0].url, /\/api\/health-log$/);
  const body = JSON.parse(requests[0].init.body);
  assert.deepEqual(body, { userId: 'patient-a', type: 'steps', value: 3210, unit: 'steps', timestamp });
});
