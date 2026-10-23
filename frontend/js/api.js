/**
 * ============================================================
 * Carewise API Client — Frontend Backend Integration Layer
 * ============================================================
 * Connects directly to Node.js + Express backend (Port 5000)
 * ============================================================
 */

const API_BASE_URL = 'http://127.0.0.1:5000/api';
const API_BASE_FALLBACK = 'http://localhost:5000/api';

/**
 * Storage Keys
 */
const STORAGE_KEYS = {
  USER_ID: 'caremate_user_id',
  USER_NAME: 'caremate_user_name',
  USER_PHONE: 'caremate_user_phone',
  USER_AGE: 'caremate_user_age',
  VOICE_TONE: 'caremate_voice_tone',
};

/**
 * Get the current active user ID
 */
function getCurrentUserId() {
  try {
    return localStorage.getItem(STORAGE_KEYS.USER_ID) || null;
  } catch (e) {
    return null;
  }
}

/**
 * Set the current active user details
 */
function setCurrentUser(user) {
  try {
    if (user && user.userId) {
      localStorage.setItem(STORAGE_KEYS.USER_ID, user.userId);
    }
    if (user && user.name) {
      localStorage.setItem(STORAGE_KEYS.USER_NAME, user.name);
    }
    if (user && user.phone) {
      localStorage.setItem(STORAGE_KEYS.USER_PHONE, user.phone);
    }
    if (user && user.age) {
      localStorage.setItem(STORAGE_KEYS.USER_AGE, user.age);
    }
  } catch (e) {
    console.warn('[API] Could not persist to localStorage:', e);
  }
}

/**
 * Clear user session (Logout)
 */
function logoutUser() {
  try {
    localStorage.removeItem(STORAGE_KEYS.USER_ID);
    localStorage.removeItem(STORAGE_KEYS.USER_NAME);
    localStorage.removeItem(STORAGE_KEYS.USER_PHONE);
    localStorage.removeItem(STORAGE_KEYS.USER_AGE);
  } catch (e) {
    console.warn('[API] Could not clear localStorage:', e);
  }
  window.location.href = 'login.html';
}

/**
 * Fetch wrapper with fallback and clean error handling
 */
async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 8000);
  const config = {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: controller.signal,
  };

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, config);
  } catch (primaryErr) {
    if (primaryErr.name === 'AbortError') {
      clearTimeout(timeoutId);
      return { success: false, error: 'The server took too long to respond. Check your connection and try again.', timeout: true };
    }
    // Attempt fallback to localhost:5000
    try {
      response = await fetch(`${API_BASE_FALLBACK}${endpoint}`, config);
    } catch (fallbackErr) {
      clearTimeout(timeoutId);
      console.error('[API] Network connection failed on both 127.0.0.1 and localhost:', fallbackErr);
      return {
        success: false,
        error: 'Cannot connect to backend server. Please verify backend is running on port 5000.',
      };
    }
  }
  let data = null;
  try {
    data = await response.json();
  } catch (jsonErr) {
    data = null;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorMsg = (data && (data.error || data.message)) || `Server returned error (${response.status})`;
    return { success: false, error: errorMsg, status: response.status, data };
  }

  return { success: true, data, status: response.status };
}

// ────────────────────────────────────────────────────────────
// User APIs (matches backend /controllers/userController.js)
// ────────────────────────────────────────────────────────────

/**
 * Register a new user profile
 * Backend expects: { name, phone, age?, emergencyContacts? }
 */
async function registerUser(userData) {
  if (!userData.name || !userData.phone) {
    return { success: false, error: 'Name and Phone number are required.' };
  }

  const result = await apiFetch('/register', {
    method: 'POST',
    body: {
      userId: userData.userId || undefined,
      name: userData.name.trim(),
      phone: userData.phone.trim(),
      age: userData.age ? Number(userData.age) : null,
      emergencyContacts: Array.isArray(userData.emergencyContacts) ? userData.emergencyContacts : [],
    },
  });

  if (result.success && result.data && result.data.userId) {
    setCurrentUser({
      userId: result.data.userId,
      name: userData.name,
      phone: userData.phone,
      age: userData.age,
    });
  }

  return result;
}

/**
 * Get User Profile by ID
 * Backend: GET /api/user/:userId
 */
async function getUserProfile(userId) {
  const uid = userId || getCurrentUserId();
  if (!uid) {
    return { success: false, error: 'No user ID provided or logged in.' };
  }
  return apiFetch(`/user/${encodeURIComponent(uid)}`);
}

/** Resolve a registered phone number to its existing Firestore profile ID. */
async function getUserProfileByPhone(phone) {
  const value = String(phone || '').trim();
  if (!value) return { success: false, error: 'Phone number is required.' };
  return apiFetch(`/user/by-phone/${encodeURIComponent(value)}`);
}

// ────────────────────────────────────────────────────────────
// Medicine APIs (matches backend /controllers/medicineController.js)
// ────────────────────────────────────────────────────────────

/**
 * Add a medicine schedule
 * Backend expects: { userId, medicineName, dosage, time, frequency }
 * time must be in HH:MM (24-hour format)
 */
async function addMedicine(medData) {
  const uid = getCurrentUserId();
  if (!uid) {
    return { success: false, error: 'User is not logged in.' };
  }
  if (medData.userId && medData.userId !== uid) {
    return { success: false, error: 'The selected profile changed. Refresh the page and try again.' };
  }

  return apiFetch('/medicine', {
    method: 'POST',
    body: {
      userId: uid,
      medicineName: medData.medicineName,
      dosage: medData.dosage,
      time: medData.time, // HH:MM
      frequency: medData.frequency || 'Daily',
    },
  });
}

/**
 * Get all medicines for a user
 * Backend: GET /api/medicine/:userId
 */
async function getMedicines(userId) {
  const uid = userId || getCurrentUserId();
  if (!uid) {
    return { success: false, error: 'User is not logged in.' };
  }
  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return apiFetch(`/medicine/${encodeURIComponent(uid)}?date=${localDate}`);
}

async function updateMedicineDose(medId, status, scheduledDate, scheduledTime) {
  const uid = getCurrentUserId();
  if (!uid || !medId || !scheduledTime) return { success: false, error: 'Medicine, user, and scheduled dose time are required.' };
  return apiFetch(`/medicine/${encodeURIComponent(medId)}/dose`, { method: 'POST', body: { userId: uid, scheduledDate, scheduledTime, status } });
}

/**
 * Update medicine status
 * Backend: PUT /api/medicine/:medId/status
 * status must be: 'pending' | 'taken' | 'missed'
 */
async function updateMedicineStatus(medId, status) {
  if (!medId || !status) {
    return { success: false, error: 'medId and status are required.' };
  }

  return apiFetch(`/medicine/${encodeURIComponent(medId)}/status`, {
    method: 'PUT',
    body: { status },
  });
}

// ────────────────────────────────────────────────────────────
// Appointment APIs (matches backend /controllers/appointmentController.js)
// ────────────────────────────────────────────────────────────

/**
 * Schedule a new appointment
 * Backend expects: { userId, doctorName, date, time, location }
 * date: YYYY-MM-DD, time: HH:MM
 */
async function addAppointment(apptData) {
  const uid = apptData.userId || getCurrentUserId();
  if (!uid) {
    return { success: false, error: 'User is not logged in.' };
  }

  return apiFetch('/appointment', {
    method: 'POST',
    body: {
      userId: uid,
      doctorName: apptData.doctorName,
      date: apptData.date, // YYYY-MM-DD
      time: apptData.time, // HH:MM
      location: apptData.location,
      ...(apptData.idempotencyKey ? { idempotencyKey: apptData.idempotencyKey, confirmed: apptData.confirmed === true } : {}),
    },
  });
}

/**
 * Get all scheduled appointments for a user
 * Backend: GET /api/appointment/:userId
 */
async function getAppointments(userId) {
  const uid = userId || getCurrentUserId();
  if (!uid) {
    return { success: false, error: 'User is not logged in.' };
  }
  return apiFetch(`/appointment/${encodeURIComponent(uid)}`);
}

async function updateAppointmentCompletion(apptId, completed, userId) {
  const uid = getCurrentUserId();
  if (userId && userId !== uid) return { success: false, error: 'The selected profile changed. Refresh the page and try again.' };
  if (!uid || !apptId || typeof completed !== 'boolean') return { success: false, error: 'Appointment, user, and completion status are required.' };
  return apiFetch(`/appointment/${encodeURIComponent(apptId)}/completion`, { method: 'PUT', body: { userId: uid, completed } });
}

function filterUpcomingAppointments(appointments, profileId, now = new Date()) {
  if (!Array.isArray(appointments) || !profileId) return [];
  const nowTime = now.getTime();
  return appointments
    .filter(appointment => {
      if (!appointment || appointment.userId !== profileId) return false;
      const status = String(appointment.status || appointment.appointmentStatus || '').trim().toLowerCase();
      if (appointment.cancelled === true || appointment.isCancelled === true || status === 'cancelled' || status === 'canceled') return false;
      const timestamp = new Date(`${appointment.date}T${appointment.time || '00:00'}:00`).getTime();
      return Number.isFinite(timestamp) && timestamp >= nowTime;
    })
    .sort((a, b) => new Date(`${a.date}T${a.time || '00:00'}:00`) - new Date(`${b.date}T${b.time || '00:00'}:00`));
}

function filterProfileAppointments(appointments, profileId) {
  if (!Array.isArray(appointments) || !profileId) return [];
  return appointments.filter(appointment => {
    if (!appointment || appointment.userId !== profileId) return false;
    const status = String(appointment.status || appointment.appointmentStatus || '').trim().toLowerCase();
    return appointment.cancelled !== true && appointment.isCancelled !== true && status !== 'cancelled' && status !== 'canceled';
  }).sort((a, b) => new Date(`${a.date}T${a.time || '00:00'}:00`) - new Date(`${b.date}T${b.time || '00:00'}:00`));
}

async function chatWithAssistant(payload) {
  return apiFetch('/assistant/chat', {
    method: 'POST',
    body: payload,
    // The backend provider deadline is 30s; leave a small buffer so the
    // backend can return its friendly unavailable response after that bound.
    timeout: 32000,
  });
}

async function confirmAssistantMedicine(confirmationToken, userId) {
  if (!confirmationToken || !userId) {
    return { success: false, error: 'The medicine confirmation is missing. Review the schedule and try again.' };
  }
  return apiFetch('/assistant/medicine/confirm', {
    method: 'POST',
    timeout: 12_000,
    body: { confirmationToken, userId, confirmed: true },
  });
}

async function transcribeAssistantAudio(audioBlob) {
  if (!(audioBlob instanceof Blob) || audioBlob.size === 0) {
    return { success: false, error: 'The recording was empty. Please try again or type your message.' };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  let response;
  let networkError;
  for (const baseUrl of [API_BASE_URL, API_BASE_FALLBACK]) {
    try {
      response = await fetch(`${baseUrl}/assistant/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': audioBlob.type || 'audio/webm' },
        body: audioBlob,
        signal: controller.signal,
      });
      break;
    } catch (error) {
      networkError = error;
      if (error.name === 'AbortError') break;
    }
  }
  clearTimeout(timeoutId);
  if (!response) {
    return { success: false, error: networkError?.name === 'AbortError'
      ? 'Speech recognition took too long. Please try a shorter recording or type your message.'
      : 'Cannot connect to speech recognition. Check that the backend is running on port 5000.' };
  }
  let data = null;
  try { data = await response.json(); } catch (_) { /* handled as a service error below */ }
  if (!response.ok) return { success: false, error: data?.error || `Speech recognition failed (${response.status}).`, status: response.status };
  if (typeof data?.text !== 'string' || !data.text.trim()) return { success: false, error: 'No speech was recognized. Try again or type your message.' };
  return { success: true, data, status: response.status };
}

// ────────────────────────────────────────────────────────────
// Health log API
// ────────────────────────────────────────────────────────────

const HEALTH_LOG_UNITS = {
  blood_pressure: ['mmHg'], heart_rate: ['bpm'], blood_sugar: ['mg/dL', 'mmol/L'],
  body_temperature: ['°C', '°F'], oxygen_saturation: ['%'], steps: ['steps'],
};

function validateHealthLogPayload(data) {
  if (!data || typeof data !== 'object') return 'Enter a health measurement.';
  if (data.type === undefined) {
    if (data.heartRate === undefined && data.steps !== undefined) {
      return typeof data.steps === 'number' && Number.isInteger(data.steps) && data.steps >= 0 && data.steps <= 100000
        ? null
        : 'Steps must be a whole number from 0–100,000.';
    }
    if (typeof data.heartRate !== 'number' || !Number.isFinite(data.heartRate) || data.heartRate < 20 || data.heartRate > 300
      || typeof data.steps !== 'number' || !Number.isInteger(data.steps) || data.steps < 0 || data.steps > 100000) {
      return 'Heart rate must be 20–300 bpm and steps must be a whole number from 0–100,000.';
    }
    return null;
  }
  if (!HEALTH_LOG_UNITS[data.type] || !HEALTH_LOG_UNITS[data.type].includes(data.unit)) return 'Choose a supported measurement and unit.';
  if (typeof data.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/.test(data.timestamp)
    || !Number.isFinite(Date.parse(data.timestamp)) || Date.parse(data.timestamp) > Date.now() + 5 * 60 * 1000) return 'Enter a valid measurement date and time.';
  if (data.notes !== undefined && (typeof data.notes !== 'string' || data.notes.length > 1000)) return 'Notes must be 1,000 characters or fewer.';
  if (data.type === 'blood_pressure') {
    if (!Number.isFinite(data.systolic) || data.systolic < 30 || data.systolic > 300 || !Number.isFinite(data.diastolic) || data.diastolic < 20 || data.diastolic > 200 || data.systolic <= data.diastolic) return 'Enter valid systolic and diastolic values.';
    return null;
  }
  if (typeof data.value !== 'number' || !Number.isFinite(data.value)) return 'Enter a numeric measurement.';
  if (data.type === 'steps' && (!Number.isInteger(data.value) || data.value < 0 || data.value > 100000)) return 'Steps must be a whole number from 0–100,000.';
  const limits = data.type === 'steps' ? [0, 100000]
    : data.type === 'heart_rate' ? [20, 300]
    : data.type === 'blood_sugar' ? (data.unit === 'mg/dL' ? [1, 2000] : [0.1, 100])
      : data.type === 'body_temperature' ? (data.unit === '°C' ? [25, 45] : [77, 113])
        : [0, 100];
  if (data.value < limits[0] || data.value > limits[1]) return `The measurement is outside the supported entry range for ${data.unit}.`;
  if (data.type === 'blood_sugar' && !['fasting', 'before_meal', 'after_meal', 'random'].includes(data.context)) return 'Choose the blood sugar measurement context.';
  return null;
}

async function logHealthReading(healthData) {
  const uid = getCurrentUserId();
  if (!uid) {
    return { success: false, error: 'User is not logged in.' };
  }
  if (healthData.userId && healthData.userId !== uid) return { success: false, error: 'The selected profile changed. Refresh the page and try again.' };
  const validationError = validateHealthLogPayload(healthData);
  if (validationError) return { success: false, error: validationError };

  return apiFetch('/health-log', {
    method: 'POST',
    body: { ...healthData, userId: uid },
  });
}

async function getHealthLogs(userId) {
  const uid = getCurrentUserId();
  if (!uid) return { success: false, error: 'User is not logged in.' };
  if (userId && userId !== uid) return { success: false, error: 'The selected profile changed. Refresh the page and try again.' };
  return apiFetch(`/health-log/${encodeURIComponent(uid)}`);
}

// Export for browser global
window.CareMateAPI = {
  API_BASE_URL,
  STORAGE_KEYS,
  getCurrentUserId,
  setCurrentUser,
  logoutUser,
  // User
  registerUser,
  getUserProfile,
  getUserProfileByPhone,
  // Medicine
  addMedicine,
  getMedicines,
  updateMedicineStatus,
  updateMedicineDose,
  // Appointment
  addAppointment,
  getAppointments,
  updateAppointmentCompletion,
  filterUpcomingAppointments,
  filterProfileAppointments,
  chatWithAssistant,
  confirmAssistantMedicine,
  transcribeAssistantAudio,
  // Health
  logHealthReading,
  getHealthLogs,
  validateHealthLogPayload,
};
