/* CareWise form dictation using the browser-provided Web Speech API. */
(function () {
  'use strict';

  const FIELD_IDS = [
    'med-name', 'med-dosage', 'm-med-name', 'm-med-dosage',
    'doc-name', 'doc-location', 'm-doc-name', 'm-doc-loc',
  ];
  const attached = new WeakSet();
  const active = new Set();
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  function appendTranscript(field, transcript) {
    const clean = String(transcript || '').trim();
    if (!clean) return { inserted: false, value: field.value };
    const current = field.value || '';
    const separator = current && !/\s$/.test(current) ? ' ' : '';
    const value = current + separator + clean;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return { inserted: true, value };
  }

  function attach(field, button, status) {
    if (attached.has(button)) return;
    attached.add(button);
    button.type = 'button';
    button.setAttribute('aria-label', 'Start voice input');
    button.setAttribute('aria-pressed', 'false');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    if (!SpeechRecognition) {
      button.disabled = true;
      status.textContent = 'Voice input is not supported in this browser. You can type instead.';
      return;
    }

    let recognition = null;
    let listening = false;
    let sessionHadFinal = false;
    let lastTranscript = '';
    let seenFinalIndices = new Set();
    let checkRestartDuplicate = false;

    function clearRecognition() {
      active.delete(recognition);
      recognition = null;
      listening = false;
      button.classList.remove('is-listening');
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', 'Start voice input');
    }

    button.addEventListener('click', function () {
      if (recognition) {
        if (listening) {
          status.textContent = 'Stopping voice input…';
          recognition.stop();
        }
        return;
      }

      if (!field.isConnected) return;
      recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.continuous = true;
      recognition.interimResults = true;
      seenFinalIndices = new Set();
      sessionHadFinal = false;
      checkRestartDuplicate = Boolean(lastTranscript);

      recognition.onstart = function () {
        listening = true;
        button.classList.add('is-listening');
        button.setAttribute('aria-pressed', 'true');
        button.setAttribute('aria-label', 'Stop voice input');
        status.textContent = 'Listening in English. Select the microphone again to stop.';
      };

      recognition.onresult = function (event) {
        let hasInterim = false;
        for (let i = event.resultIndex || 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (!result.isFinal) {
            hasInterim = true;
            continue;
          }
          if (seenFinalIndices.has(i)) continue;
          seenFinalIndices.add(i);
          const transcript = result[0] && result[0].transcript;
          if (String(transcript || '').trim()) sessionHadFinal = true;
          const cleanTranscript = String(transcript || '').trim();
          const normalizedField = (field.value || '').trim().toLocaleLowerCase();
          const normalizedPrevious = lastTranscript.toLocaleLowerCase();
          const isRestartDuplicate = checkRestartDuplicate && normalizedPrevious === cleanTranscript.toLocaleLowerCase()
            && normalizedField.endsWith(normalizedPrevious);
          checkRestartDuplicate = false;
          const insertion = isRestartDuplicate
            ? { inserted: false, value: field.value }
            : appendTranscript(field, cleanTranscript);
          if (insertion.inserted) lastTranscript = String(transcript).trim();
          if (insertion.inserted) status.textContent = 'Speech added. Review and edit the field, then use the form save button.';
        }
        if (hasInterim) status.textContent = 'Recognizing speech…';
      };

      recognition.onerror = function (event) {
        const errors = {
          'not-allowed': 'Microphone permission was denied. Allow microphone access in your browser settings, or type instead.',
          'service-not-allowed': 'The browser speech service is unavailable or blocked. You can type instead.',
          'audio-capture': 'No microphone is available. Connect a microphone, or type instead.',
          network: 'Speech recognition could not reach the browser service. Check your connection, or type instead.',
          'no-speech': 'No speech was detected. Try again, or type instead.',
          aborted: 'Voice input stopped. You can continue typing or try again.',
          'language-not-supported': 'English recognition is unavailable in this browser. You can type instead.',
        };
        status.textContent = errors[event.error] || 'Voice input failed. You can type instead.';
        clearRecognition();
      };

      recognition.onend = function () {
        if (listening) {
          status.textContent = sessionHadFinal
            ? 'Voice input stopped. Review the text, edit it if needed, then save the form.'
            : 'No speech was recognized. Try again, or type in the field.';
        }
        clearRecognition();
      };

      try {
        recognition.start();
        active.add(recognition);
        status.textContent = 'Starting voice input…';
      } catch (error) {
        const message = error && error.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow microphone access in your browser settings, or type instead.'
          : error && error.name === 'NotFoundError'
            ? 'No microphone is available. Connect a microphone, or type instead.'
            : 'Voice input could not start. Check microphone access, or type instead.';
        status.textContent = message;
        clearRecognition();
      }
    });

    field.addEventListener('input', function () {
      if (lastTranscript && !(field.value || '').toLocaleLowerCase().includes(lastTranscript.toLocaleLowerCase())) {
        lastTranscript = '';
      }
    });

    const observer = new MutationObserver(function () {
      if (field.isConnected) return;
      if (recognition && listening) recognition.stop();
      clearRecognition();
      observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function init() {
    FIELD_IDS.forEach(function (id) {
      const field = document.getElementById(id);
      const button = document.querySelector('[data-dictation-for="' + id + '"]');
      const status = document.querySelector('[data-dictation-status="' + id + '"]');
      if (field && button && status) attach(field, button, status);
    });
  }

  function stopAll() {
    active.forEach(function (recognition) {
      try { recognition.stop(); } catch (_) { active.delete(recognition); }
    });
  }

  window.addEventListener('pagehide', function () {
    stopAll();
    active.clear();
  });

  window.CareWiseDictation = { init: init, appendTranscript: appendTranscript, stopAll: stopAll };
  init();
})();
