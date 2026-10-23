/**
 * ============================================================
 * VOICE.JS — Web Speech API Wrapper & Voice UI States
 * ============================================================
 * Handles SpeechRecognition & SpeechSynthesis with 5 visual states:
 *   - 'idle'       : 🎙️ TAP TO TALK "How can I help you today?"
 *   - 'listening'  : 🔵 🎙️ 🔵 Listening... "Tell me what you need"
 *   - 'processing' : ◌ ◌ ◌ Understanding...
 *   - 'speaking'   : 🔊 Assistant speaking... [ Stop Speaking ]
 *   - 'error'      : ⚠️ I couldn't hear you. [ Try Again ]
 * ============================================================
 */

const VOICE_STATES = {
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
  ERROR: 'error',
};

const STATE_CONFIG = {
  [VOICE_STATES.IDLE]: {
    icon: '🎙️',
    title: 'TAP TO TALK',
    subtext: '"How can I help you today?"',
    btnClass: 'mic-target--idle',
  },
  [VOICE_STATES.LISTENING]: {
    icon: '🎙️',
    title: 'Listening...',
    subtext: '"Tell me what you need"',
    btnClass: 'mic-target--listening',
  },
  [VOICE_STATES.PROCESSING]: {
    icon: '◌ ◌ ◌',
    title: 'Understanding...',
    subtext: 'Processing your request',
    btnClass: 'mic-target--processing',
  },
  [VOICE_STATES.SPEAKING]: {
    icon: '🔊',
    title: 'Assistant speaking...',
    subtext: '[ Tap to stop speaking ]',
    btnClass: 'mic-target--speaking',
  },
  [VOICE_STATES.ERROR]: {
    icon: '⚠️',
    title: "I couldn't hear you",
    subtext: '[ Tap to try again ]',
    btnClass: 'mic-target--error',
  },
};

let currentVoiceState = VOICE_STATES.IDLE;
let recognition = null;
let synthesis = window.speechSynthesis || null;

let micBtnElement = null;
let titleElement = null;
let subtextElement = null;

/**
 * Check if Web Speech API is supported in browser.
 */
function isSpeechSupported() {
  const hasRec = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const hasSynth = !!window.speechSynthesis;
  return { hasRec, hasSynth };
}

/**
 * Initialize Voice Assistant
 */
function initVoiceAssistant(config = {}) {
  micBtnElement = config.micBtn || document.getElementById('mic-button');
  titleElement = config.titleEl || document.getElementById('voice-title');
  subtextElement = config.subtextEl || document.getElementById('voice-subtext');

  const { hasRec } = isSpeechSupported();

  if (!hasRec) {
    if (subtextElement) {
      subtextElement.textContent = "Voice input isn't supported in this browser. You can still use the buttons and forms.";
    }
    console.warn('[Voice.js] SpeechRecognition unavailable in this browser.');
    return;
  }

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRec();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    setVoiceState(VOICE_STATES.LISTENING);
  };

  recognition.onresult = (event) => {
    setVoiceState(VOICE_STATES.PROCESSING);
    const transcript = event.results[0][0].transcript;
    
    if (subtextElement) {
      subtextElement.textContent = `"${transcript}"`;
    }

    // Process command placeholder
    setTimeout(() => {
      handleVoiceCommand(transcript);
    }, 500);
  };

  recognition.onerror = (event) => {
    console.warn('[Voice.js] Speech error:', event.error);
    setVoiceState(VOICE_STATES.ERROR);
  };

  recognition.onend = () => {
    if (currentVoiceState === VOICE_STATES.LISTENING) {
      setVoiceState(VOICE_STATES.IDLE);
    }
  };

  if (micBtnElement) {
    micBtnElement.addEventListener('click', toggleListening);
  }

  setVoiceState(VOICE_STATES.IDLE);
}

/**
 * Toggle voice listening / speaking on user click
 */
function toggleListening() {
  if (currentVoiceState === VOICE_STATES.SPEAKING) {
    stopSpeaking();
    return;
  }

  if (currentVoiceState === VOICE_STATES.LISTENING) {
    stopListening();
    return;
  }

  startListening();
}

/**
 * Start listening
 */
function startListening() {
  if (!recognition) {
    setVoiceState(VOICE_STATES.ERROR);
    return;
  }

  try {
    recognition.start();
  } catch (e) {
    console.warn('[Voice.js] Start error:', e);
    setVoiceState(VOICE_STATES.IDLE);
  }
}

/**
 * Stop listening
 */
function stopListening() {
  if (recognition) {
    try {
      recognition.stop();
    } catch (e) {
      console.warn('[Voice.js] Stop error:', e);
    }
  }
  setVoiceState(VOICE_STATES.IDLE);
}

/**
 * Speak text aloud using SpeechSynthesis
 */
function speak(text) {
  return new Promise((resolve) => {
    if (!synthesis || !text) {
      resolve();
      return;
    }

    synthesis.cancel(); // Stop any active speech

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.88; // Slower, clearer speech rate for elderly comprehension
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onstart = () => {
      setVoiceState(VOICE_STATES.SPEAKING);
    };

    utterance.onend = () => {
      setVoiceState(VOICE_STATES.IDLE);
      resolve();
    };

    utterance.onerror = () => {
      setVoiceState(VOICE_STATES.IDLE);
      resolve();
    };

    synthesis.speak(utterance);
  });
}

/**
 * Stop speech synthesis
 */
function stopSpeaking() {
  if (synthesis) {
    synthesis.cancel();
  }
  setVoiceState(VOICE_STATES.IDLE);
}

/**
 * Update Voice UI State and visuals
 */
function setVoiceState(state) {
  currentVoiceState = state;
  const cfg = STATE_CONFIG[state] || STATE_CONFIG[VOICE_STATES.IDLE];

  if (micBtnElement) {
    micBtnElement.className = 'mic-target ' + cfg.btnClass;
    micBtnElement.innerHTML = `<span>${cfg.icon}</span>`;
    micBtnElement.setAttribute('aria-label', `Voice Assistant: ${cfg.title}`);
  }

  if (titleElement) {
    titleElement.textContent = cfg.title;
  }

  if (subtextElement && state !== VOICE_STATES.PROCESSING) {
    subtextElement.textContent = cfg.subtext;
  }

  console.log(`[Voice State] → ${state}`);
}

/**
 * Get current state
 */
function getVoiceState() {
  return currentVoiceState;
}

/**
 * Placeholder for future natural language command processing
 */
function handleVoiceCommand(transcript) {
  console.log('[Voice Command Received]:', transcript);

  // Future command parser logic will live here:
  // - "Remind me to take my medicine..." -> addMedicine()
  // - "What medicines do I have today?" -> readSchedule()
  // - "Emergency" -> triggerSOS()

  if (typeof CareMateApp !== 'undefined') {
    CareMateApp.showFeedback({
      type: 'voice',
      title: 'Voice Command Heard',
      message: `You said: "${transcript}"`,
      speakText: `I heard: ${transcript}.`
    });
  }
}

// Export for non-module usage
window.CareMateVoice = {
  VOICE_STATES,
  initVoiceAssistant,
  startListening,
  stopListening,
  speak,
  stopSpeaking,
  setVoiceState,
  getVoiceState,
  isSpeechSupported,
};
