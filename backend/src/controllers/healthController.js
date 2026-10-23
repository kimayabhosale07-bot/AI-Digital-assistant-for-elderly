const { getDb } = require('../config/firebase');

const HEALTH_TYPES = new Set(['blood_pressure', 'heart_rate', 'blood_sugar', 'body_temperature', 'oxygen_saturation', 'steps']);
const UNIT_BY_TYPE = {
  blood_pressure: new Set(['mmHg']),
  heart_rate: new Set(['bpm']),
  blood_sugar: new Set(['mg/dL', 'mmol/L']),
  body_temperature: new Set(['°C', '°F']),
  oxygen_saturation: new Set(['%']),
  steps: new Set(['steps']),
};
const VALUE_LIMITS = {
  heart_rate: [20, 300],
  blood_sugar: { 'mg/dL': [1, 2000], 'mmol/L': [0.1, 100] },
  body_temperature: { '°C': [25, 45], '°F': [77, 113] },
  oxygen_saturation: [0, 100],
  steps: [0, 100000],
};
const SUGAR_CONTEXTS = new Set(['fasting', 'before_meal', 'after_meal', 'random']);

function validateHealthReading(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || !HEALTH_TYPES.has(body.type)) return 'Choose a supported measurement type.';
  if (typeof body.unit !== 'string' || !UNIT_BY_TYPE[body.type].has(body.unit)) return 'Choose the correct unit for this measurement.';
  if (typeof body.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/.test(body.timestamp)) {
    return 'Enter a valid date and time with a timezone.';
  }
  const timestamp = Date.parse(body.timestamp);
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * 60 * 1000) return 'The measurement date and time cannot be in the future.';
  if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 1000)) return 'Notes must be 1,000 characters or fewer.';

  if (body.type === 'blood_pressure') {
    if (typeof body.systolic !== 'number' || !Number.isFinite(body.systolic) || body.systolic < 30 || body.systolic > 300
      || typeof body.diastolic !== 'number' || !Number.isFinite(body.diastolic) || body.diastolic < 20 || body.diastolic > 200
      || body.systolic <= body.diastolic) return 'Enter valid systolic and diastolic values in mmHg.';
    return null;
  }

  if (typeof body.value !== 'number' || !Number.isFinite(body.value)) return 'Enter a numeric measurement.';
  if (body.type === 'steps' && !Number.isInteger(body.value)) return 'Steps must be a whole number from 0–100,000.';
  const limits = Array.isArray(VALUE_LIMITS[body.type]) ? VALUE_LIMITS[body.type] : VALUE_LIMITS[body.type][body.unit];
  if (body.value < limits[0] || body.value > limits[1]) return `The measurement is outside the supported entry range for ${body.unit}.`;
  if (body.type === 'blood_sugar' && !SUGAR_CONTEXTS.has(body.context)) return 'Choose whether the blood sugar reading was fasting, before/after a meal, or random.';
  return null;
}

function validateLegacyVitals(body) {
  const heartRate = body.heartRate;
  const steps = body.steps;
  if (typeof heartRate !== 'number' || !Number.isFinite(heartRate) || heartRate < 20 || heartRate > 300
    || typeof steps !== 'number' || !Number.isInteger(steps) || steps < 0 || steps > 100000) {
    return { error: 'Heart rate must be 20–300 bpm and steps must be a whole number from 0–100,000.' };
  }
  return {
    data: {
      type: 'heart_rate', value: heartRate, unit: 'bpm', heartRate, steps,
      timestamp: new Date().toISOString(),
      flagged: heartRate < 60 || heartRate > 100,
    },
  };
}

function validateLegacySteps(body) {
  const steps = body.steps;
  if (typeof steps !== 'number' || !Number.isInteger(steps) || steps < 0 || steps > 100000) {
    return { error: 'Steps must be a whole number from 0–100,000.' };
  }
  return { data: { type: 'steps', value: steps, unit: 'steps', steps, timestamp: new Date().toISOString() } };
}

function healthError(res, error) {
  console.error('[Health Logs] Request failed:', { errorName: error?.name || 'Error', code: error?.code || 'unknown' });
  return res.status(500).json({ error: 'Health records are temporarily unavailable. Please try again.' });
}

async function requireProfile(db, userId) {
  if (typeof userId !== 'string' || !userId.trim() || userId.length > 200) return { error: { status: 400, message: 'A valid Carewise profile ID is required.' } };
  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) return { error: { status: 404, message: 'The Carewise profile was not found.' } };
  return { userId };
}

function hasValidProfileId(userId) {
  return typeof userId === 'string' && Boolean(userId.trim()) && userId.length <= 200;
}

/** POST /health-log — create a measurement in healthLogs. */
const logHealthReading = async (req, res) => {
  try {
    const body = req.body || {};
    if (!hasValidProfileId(body.userId)) return res.status(400).json({ error: 'A valid Carewise profile ID is required.' });
    let measurement;
    if (body.type === undefined && body.heartRate !== undefined && body.steps !== undefined) {
      const legacy = validateLegacyVitals(body);
      if (legacy.error) return res.status(400).json({ error: legacy.error });
      measurement = legacy.data;
    } else if (body.type === undefined && body.heartRate === undefined && body.steps !== undefined) {
      const legacy = validateLegacySteps(body);
      if (legacy.error) return res.status(400).json({ error: legacy.error });
      measurement = legacy.data;
    } else {
      const validationError = validateHealthReading(body);
      if (validationError) return res.status(400).json({ error: validationError });
      measurement = {
        type: body.type,
        unit: body.unit,
        timestamp: body.timestamp,
        ...(body.type === 'blood_pressure'
          ? { systolic: body.systolic, diastolic: body.diastolic }
          : { value: body.value }),
        ...(body.type === 'blood_sugar' ? { context: body.context } : {}),
        notes: body.notes?.trim() || '',
      };
    }
    const db = req.app?.locals?.db || getDb();
    const profile = await requireProfile(db, body.userId);
    if (profile.error) return res.status(profile.error.status).json({ error: profile.error.message });

    const logRef = db.collection('healthLogs').doc();
    const record = { logId: logRef.id, userId: body.userId, ...measurement, createdAt: new Date().toISOString() };
    await logRef.set(record);
    return res.status(201).json({ success: true, message: 'Health measurement saved.', data: record });
  } catch (error) {
    return healthError(res, error);
  }
};

/** GET /health-log/:userId — return only records belonging to this profile. */
const getHealthLogs = async (req, res) => {
  try {
    const db = req.app?.locals?.db || getDb();
    const profile = await requireProfile(db, req.params?.userId);
    if (profile.error) return res.status(profile.error.status).json({ error: profile.error.message });

    const snapshot = await db.collection('healthLogs').where('userId', '==', profile.userId).get();
    const records = snapshot.docs.map(doc => ({ logId: doc.id, ...doc.data() }));
    records.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    return res.status(200).json(records);
  } catch (error) {
    return healthError(res, error);
  }
};

module.exports = { logHealthReading, getHealthLogs, validateHealthReading, validateLegacyVitals, validateLegacySteps, HEALTH_TYPES, UNIT_BY_TYPE };
