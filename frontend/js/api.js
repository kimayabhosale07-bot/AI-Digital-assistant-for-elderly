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

async function updateMedicineDose(medId, status, scheduledDate) {
  const uid = getCurrentUserId();
  if (!uid || !medId) return { success: false, error: 'Medicine and user are required.' };
  return apiFetch(`/medicine/${encodeURIComponent(medId)}/dose`, { method: 'POST', body: { userId: uid, scheduledDate, status } });
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

// ────────────────────────────────────────────────────────────
// Health log API
// ────────────────────────────────────────────────────────────

/**
 * Log a health reading (heart rate & steps)
 * Backend expects: { userId, heartRate, steps }
 * If heartRate < 60 or > 100, the backend flags the reading for review.
 */
async function logHealthReading(healthData) {
  const uid = healthData.userId || getCurrentUserId();
  if (!uid) {
    return { success: false, error: 'User is not logged in.' };
  }

  return apiFetch('/health-log', {
    method: 'POST',
    body: {
      userId: uid,
      heartRate: Number(healthData.heartRate),
      steps: Number(healthData.steps),
    },
  });
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
  // Health
  logHealthReading,
};
