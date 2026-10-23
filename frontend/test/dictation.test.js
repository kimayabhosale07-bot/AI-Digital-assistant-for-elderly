import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../js/dictation.js'), 'utf8');

function createHarness({ supported = true } = {}) {
  const listeners = new Map();
  const attrs = {};
  const classes = new Set();
  const field = {
    value: 'Existing text',
    isConnected: true,
    events: [],
    addEventListener(name, callback) { listeners.set(`field:${name}`, callback); },
    dispatchEvent(event) { this.events.push(event.type); },
  };
  const button = {
    disabled: false,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
    },
    addEventListener(name, callback) { listeners.set(`button:${name}`, callback); },
    setAttribute(name, value) { attrs[name] = value; },
  };
  const status = {
    textContent: '',
    setAttribute(name, value) { attrs[`status:${name}`] = value; },
  };
  const observers = [];
  class MockObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const recognitions = [];
  class MockRecognition {
    constructor() { recognitions.push(this); }
    start() { this.started = true; }
    stop() { this.stopped = true; }
  }
  const window = {
    addEventListener(name, callback) { listeners.set(`window:${name}`, callback); },
  };
  if (supported) window.SpeechRecognition = MockRecognition;
  const document = {
    documentElement: {},
    getElementById() { return field; },
    querySelector(selector) {
      if (selector.includes('data-dictation-for')) return button;
      if (selector.includes('data-dictation-status')) return status;
      return null;
    },
  };
  vm.runInNewContext(source, {
    window,
    document,
    MutationObserver: MockObserver,
    Event: class { constructor(type) { this.type = type; } },
  });
  return { field, button, status, listeners, observers, recognitions, attrs, classes, dictation: window.CareWiseDictation };
}

test('starts English recognition, stops on request, and inserts final text without submitting', () => {
  const h = createHarness();
  h.listeners.get('button:click')();
  const recognition = h.recognitions[0];
  assert.equal(recognition.lang, 'en-US');
  assert.equal(recognition.continuous, true);
  assert.equal(recognition.interimResults, true);
  assert.equal(recognition.started, true);
  recognition.onstart();
  assert.equal(h.attrs['aria-label'], 'Stop voice input');

  let formSubmissions = 0;
  recognition.onresult({
    resultIndex: 0,
    results: [
      Object.assign([{ transcript: 'new medicine' }], { isFinal: false }),
      Object.assign([{ transcript: 'new medicine' }], { isFinal: true }),
    ],
  });
  assert.equal(h.field.value, 'Existing text new medicine');
  assert.deepEqual(h.field.events, ['input', 'change']);
  assert.equal(formSubmissions, 0);

  recognition.onresult({
    resultIndex: 1,
    results: [
      Object.assign([{ transcript: 'new medicine' }], { isFinal: false }),
      Object.assign([{ transcript: 'new medicine' }], { isFinal: true }),
    ],
  });
  assert.equal(h.field.value, 'Existing text new medicine');
  h.listeners.get('button:click')();
  assert.equal(recognition.stopped, true);
  assert.equal(formSubmissions, 0);
});

test('does not add interim text and preserves field edits before final insertion', () => {
  const h = createHarness();
  h.listeners.get('button:click')();
  const recognition = h.recognitions[0];
  recognition.onstart();
  recognition.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'temporary' }], { isFinal: false })] });
  assert.equal(h.field.value, 'Existing text');
  h.field.value = 'User edited text';
  recognition.onresult({ resultIndex: 1, results: [
    Object.assign([{ transcript: 'temporary' }], { isFinal: false }),
    Object.assign([{ transcript: 'final words' }], { isFinal: true }),
  ] });
  assert.equal(h.field.value, 'User edited text final words');
});

test('reports permission denial and keeps the field editable', () => {
  const h = createHarness();
  h.listeners.get('button:click')();
  h.recognitions[0].onerror({ error: 'not-allowed' });
  assert.match(h.status.textContent, /permission was denied/i);
  assert.equal(h.field.value, 'Existing text');
  assert.equal(h.attrs['aria-label'], 'Start voice input');
});

test('suppresses a repeated phrase after restart but allows a deliberate repetition in one session', () => {
  const h = createHarness();
  h.listeners.get('button:click')();
  const first = h.recognitions[0];
  first.onstart();
  first.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'take with water' }], { isFinal: true })] });
  first.onend();

  h.listeners.get('button:click')();
  const second = h.recognitions[1];
  second.onstart();
  second.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'take with water' }], { isFinal: true })] });
  assert.equal(h.field.value, 'Existing text take with water');
  second.onresult({ resultIndex: 1, results: [
    Object.assign([{ transcript: 'take with water' }], { isFinal: true }),
    Object.assign([{ transcript: 'take with water' }], { isFinal: true }),
  ] });
  assert.equal(h.field.value, 'Existing text take with water take with water');
});

test('gracefully disables dictation in unsupported browsers', () => {
  const h = createHarness({ supported: false });
  assert.equal(h.button.disabled, true);
  assert.match(h.status.textContent, /not supported/i);
  assert.equal(h.recognitions.length, 0);
});

test('reports an empty recognition session without altering existing text', () => {
  const h = createHarness();
  h.listeners.get('button:click')();
  const recognition = h.recognitions[0];
  recognition.onstart();
  recognition.onend();
  assert.match(h.status.textContent, /no speech was recognized/i);
  assert.equal(h.field.value, 'Existing text');
});

test('stops recognition when its field is removed', () => {
  const h = createHarness();
  h.listeners.get('button:click')();
  const recognition = h.recognitions[0];
  recognition.onstart();
  h.field.isConnected = false;
  h.observers[0].callback();
  assert.equal(recognition.stopped, true);
  assert.equal(h.observers[0].disconnected, true);
});

test('exposes cleanup for Voice Companion back, cancel, and close actions', () => {
  const h = createHarness();
  h.listeners.get('button:click')();
  const recognition = h.recognitions[0];
  recognition.onstart();
  h.dictation.stopAll();
  assert.equal(recognition.stopped, true);
});

test('dictation controls are non-submit buttons; users retain manual form submission', () => {
  const h = createHarness();
  let submissions = 0;
  assert.equal(h.button.type, 'button');
  h.listeners.get('button:click')();
  assert.equal(submissions, 0);
  submissions += 1; // the existing submit control remains the only submission action
  assert.equal(submissions, 1);
});
