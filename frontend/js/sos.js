/**
 * ============================================================
 * SOS.JS — Emergency SOS Press-and-Hold Logic (Section 9, 18, 31)
 * ============================================================
 * Handles press-and-hold interaction (2 seconds), confirmation modal,
 * success state, error state, and backend API alert triggers.
 * ============================================================
 */

let holdTimer = null;
let holdStartTime = 0;
const REQUIRED_HOLD_MS = 2000; // 2 seconds press-and-hold

let sosTargetBtn = null;
let progressRingEl = null;

/**
 * Initialize SOS Page & Press-and-Hold Events
 */
function initSOS(config = {}) {
  sosTargetBtn = config.btn || document.getElementById('sos-hold-button');
  progressRingEl = config.progress || document.getElementById('sos-progress-ring');

  if (!sosTargetBtn) return;

  // Mouse / Touch events for press-and-hold
  sosTargetBtn.addEventListener('mousedown', startSOSHold);
  sosTargetBtn.addEventListener('mouseup', cancelSOSHold);
  sosTargetBtn.addEventListener('mouseleave', cancelSOSHold);

  sosTargetBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startSOSHold();
  });
  sosTargetBtn.addEventListener('touchend', cancelSOSHold);
  sosTargetBtn.addEventListener('touchcancel', cancelSOSHold);

  // Keyboard accessibility (Hold Space or Enter)
  sosTargetBtn.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      if (!holdTimer) startSOSHold();
    }
  });
  sosTargetBtn.addEventListener('keyup', cancelSOSHold);

  console.log('[SOS.js] Initialized with 2-second press-and-hold');
}

/**
 * User starts pressing SOS button
 */
function startSOSHold() {
  holdStartTime = Date.now();
  if (sosTargetBtn) {
    sosTargetBtn.classList.add('sos-hold-btn--holding');
  }

  if (progressRingEl) {
    progressRingEl.textContent = 'Hold for 2 seconds...';
  }

  clearInterval(holdTimer);
  holdTimer = setInterval(() => {
    const elapsed = Date.now() - holdStartTime;
    const remainingSeconds = Math.ceil((REQUIRED_HOLD_MS - elapsed) / 1000);

    if (elapsed >= REQUIRED_HOLD_MS) {
      clearInterval(holdTimer);
      holdTimer = null;
      if (sosTargetBtn) sosTargetBtn.classList.remove('sos-hold-btn--holding');
      showSOSConfirmation();
    } else {
      if (progressRingEl) {
        progressRingEl.textContent = `Hold for ${remainingSeconds} second${remainingSeconds > 1 ? 's' : ''}...`;
      }
    }
  }, 100);
}

/**
 * User releases button before 2 seconds
 */
function cancelSOSHold() {
  if (holdTimer) {
    clearInterval(holdTimer);
    holdTimer = null;
    if (progressRingEl) {
      progressRingEl.textContent = 'Press and hold for 2 seconds';
    }
    if (sosTargetBtn) {
      sosTargetBtn.classList.remove('sos-hold-btn--holding');
    }
  }
}

/**
 * Display confirmation step before sending emergency alert (Step 2)
 */
function showSOSConfirmation() {
  const step1 = document.getElementById('sos-step-1');
  const step2 = document.getElementById('sos-step-2');
  
  if (step1 && step2) {
    step1.style.display = 'none';
    step2.style.display = 'flex';
  } else {
    // Fallback if steps aren't defined
    if (confirm('Are you sure you want to send an emergency alert?')) {
      sendEmergencyAlert();
    }
  }
}

/**
 * Cancel SOS and return to Step 1
 */
function cancelSOSConfirmation() {
  const step1 = document.getElementById('sos-step-1');
  const step2 = document.getElementById('sos-step-2');
  
  if (step1 && step2) {
    step2.style.display = 'none';
    step1.style.display = 'flex';
  }
  
  if (progressRingEl) progressRingEl.textContent = 'Press and hold for 2 seconds';
}

/**
 * Send emergency alert (triggers API backend)
 */
async function sendEmergencyAlert() {
  console.log('[SOS.js] Triggering emergency alert dispatch...');

  try {
    if (window.CareMateAPI) {
      await window.CareMateAPI.sendEmergencyAlert({ timestamp: new Date().toISOString() });
    }
    showSOSSuccess();
  } catch (err) {
    showSOSError();
  }
}

/**
 * Display success alert sent confirmation (Step 3)
 */
function showSOSSuccess() {
  const step2 = document.getElementById('sos-step-2');
  const step3 = document.getElementById('sos-step-3');
  
  if (step2 && step3) {
    step2.style.display = 'none';
    step3.style.display = 'flex';
  }

  if (typeof CareMateApp !== 'undefined') {
    if (window.CareMateVoice) {
      window.CareMateVoice.speak('Emergency alert sent. Help is on the way.');
    }
  }
}

/**
 * Display error state if alert failed
 */
function showSOSError() {
  if (progressRingEl) {
    progressRingEl.textContent = '⚠️ ALERT NOT SENT';
  }

  if (typeof CareMateApp !== 'undefined') {
    CareMateApp.showFeedback({
      type: 'error',
      title: '⚠️ ALERT NOT SENT',
      message: "We couldn't send the emergency message. Please check your connection and try calling directly.",
      speakText: "Alert could not be sent. Please call your contact directly.",
    });
  }
}

// Export for non-module usage
window.CareMateSOS = {
  initSOS,
  startSOSHold,
  cancelSOSHold,
  showSOSConfirmation,
  cancelSOSConfirmation,
  sendEmergencyAlert,
  showSOSSuccess,
  showSOSError,
};
