const { getDb } = require('../config/firebase');
const crypto = require('crypto');

function sendFirestoreError(res, operation, error) {
  const code = Number.isInteger(error.code) ? error.code : null;
  let message = String(error.message || 'Unknown Firestore error');
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  for (const secret of [privateKey, clientEmail]) {
    if (secret) message = message.split(secret).join('[redacted]');
  }
  message = message
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[redacted credential]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted email]')
    .replace(/projects\/[^/\s]+/g, 'projects/[redacted]')
    .slice(0, 600);
  console.error(`[Firestore] ${operation} failed (${code ?? error.code ?? 'unknown'}): ${message}`);

  const responses = {
    4: [504, 'Firestore request timed out. Please retry shortly.', 'FIRESTORE_DEADLINE_EXCEEDED'],
    7: [503, 'Firestore denied the request. Check backend service-account permissions.', 'FIRESTORE_PERMISSION_DENIED'],
    14: [503, 'Firestore is temporarily unavailable. Please retry shortly.', 'FIRESTORE_UNAVAILABLE'],
    16: [503, 'Firestore rejected backend credentials. Check the configured service account.', 'FIRESTORE_UNAUTHENTICATED'],
  };
  const [status, errorMessage, errorCode] = responses[code] || [500, 'Firestore operation failed. Check backend configuration and logs.', 'FIRESTORE_ERROR'];
  return res.status(status).json({ error: errorMessage, code: errorCode });
}

/**
 * POST /medicine
 * Adds a new medicine schedule for a user.
 */
const addMedicine = async (req, res) => {
  try {
    const db = req.app?.locals?.db || getDb();
    const { userId, medicineName, dosage, time, frequency } = req.body;

    if (!userId || !medicineName || !dosage || !time || !frequency) {
      return res.status(400).json({ 
        error: 'Missing required fields. userId, medicineName, dosage, time, and frequency are all required.' 
      });
    }

    // Verify if time is in HH:MM format
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(time)) {
      return res.status(400).json({ error: 'Invalid time format. Use HH:MM (24-hour format, e.g., 08:30 or 14:00).' });
    }

    // Optional: Check if user exists
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: `User with ID ${userId} does not exist.` });
    }

    const medicineData = {
      userId,
      medicineName,
      dosage,
      time, // e.g. "08:30"
      frequency, // e.g. "daily", "twice a day"
      status: 'pending', // initialized as pending
      createdAt: new Date().toISOString()
    };

    const docRef = await db.collection('medicines').add(medicineData);

    // Save medId inside the document for consistency
    await docRef.update({ medId: docRef.id });

    return res.status(201).json({
      message: 'Medicine schedule added successfully',
      medId: docRef.id,
      medicine: { medId: docRef.id, ...medicineData }
    });
  } catch (error) {
    return sendFirestoreError(res, 'add medicine', error);
  }
};

/**
 * GET /medicine/:userId
 * Retrieves all medicine schedules for a specific user.
 */
const getMedicines = async (req, res) => {
  try {
    const db = req.app?.locals?.db || getDb();
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'User ID parameter is required.' });
    }

    const snapshot = await db.collection('medicines')
      .where('userId', '==', userId)
      .get();

    const date = req.query.date;
    const medicines = [];
    snapshot.forEach(doc => {
      medicines.push({ medId: doc.id, ...doc.data() });
    });

    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const doseSnapshot = await db.collection('medicine_doses')
        .where('userId', '==', userId).get();
      const doses = new Map();
      doseSnapshot.forEach(doc => {
        const dose = doc.data();
        if (dose.scheduledDate === date) doses.set(`${dose.medId}:${dose.scheduledTime || ''}`, dose);
      });
      medicines.forEach(medicine => {
        const times = Array.isArray(medicine.times) && medicine.times.length ? medicine.times : [medicine.time];
        medicine.todayDoses = times.filter(time => typeof time === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(time)).map(time => {
          const dose = doses.get(`${medicine.medId}:${time}`);
          return { scheduledTime: time, status: dose ? dose.status : 'pending', doseId: dose ? dose.doseId : null };
        });
        const firstDose = medicine.todayDoses[0];
        medicine.todayStatus = firstDose ? firstDose.status : 'pending';
        medicine.doseId = firstDose ? firstDose.doseId : null;
      });
    }

    return res.status(200).json(medicines);
  } catch (error) {
    return sendFirestoreError(res, 'get medicines', error);
  }
};

/** POST /medicine/:medId/dose — daily dose status, separate from the recurring schedule. */
const updateDoseStatus = async (req, res) => {
  try {
    const { medId } = req.params;
    const { userId, scheduledDate, scheduledTime, status } = req.body;
    if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate || '') || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(scheduledTime || '') || !['pending', 'taken'].includes(status)) {
      return res.status(400).json({ error: 'userId, scheduledDate, scheduledTime (HH:MM), and status (pending or taken) are required.' });
    }
    const db = req.app?.locals?.db || getDb();
    const medicineRef = db.collection('medicines').doc(medId);
    const medicine = await medicineRef.get();
    if (!medicine.exists) return res.status(404).json({ error: 'Medicine schedule not found.' });
    if (medicine.data().userId !== userId) return res.status(403).json({ error: 'Medicine does not belong to this user.' });
    const medicineData = medicine.data();
    const scheduledTimes = Array.isArray(medicineData.times) && medicineData.times.length ? medicineData.times : [medicineData.time];
    if (!scheduledTimes.includes(scheduledTime)) return res.status(400).json({ error: 'That time is not part of this medicine schedule.' });
    const doseId = crypto.createHash('sha256').update(`${userId}:${medId}:${scheduledDate}:${scheduledTime}`).digest('hex');
    const doseRef = db.collection('medicine_doses').doc(doseId);
    // Remove/migrate the legacy once-per-day key so older checked doses remain reversible.
    const legacyDoseId = crypto.createHash('sha256').update(`${userId}:${medId}:${scheduledDate}`).digest('hex');
    const legacyDoseRef = db.collection('medicine_doses').doc(legacyDoseId);
    if (status === 'pending') {
      await doseRef.delete();
      if (legacyDoseId !== doseId) await legacyDoseRef.delete();
    } else {
      await doseRef.set({ doseId, userId, medId, medicineName: medicineData.medicineName, dosage: medicineData.dosage, scheduledTime, scheduledDate, status: 'taken', updatedAt: new Date().toISOString() });
      if (legacyDoseId !== doseId) await legacyDoseRef.delete();
    }
    return res.status(200).json({ doseId, medId, scheduledDate, scheduledTime, status });
  } catch (error) {
    return sendFirestoreError(res, 'update medicine dose', error);
  }
};

/**
 * PUT /medicine/:medId/status
 * Updates the status of a specific medicine schedule.
 */
const updateMedicineStatus = async (req, res) => {
  try {
    const db = getDb();
    const { medId } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Missing status in request body.' });
    }

    const validStatuses = ['pending', 'taken', 'missed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      });
    }

    const medDocRef = db.collection('medicines').doc(medId);
    const doc = await medDocRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: `Medicine schedule with ID ${medId} not found.` });
    }

    await medDocRef.update({ status });

    return res.status(200).json({
      message: 'Medicine status updated successfully',
      medId,
      status
    });
  } catch (error) {
    return sendFirestoreError(res, 'update medicine status', error);
  }
};

module.exports = {
  addMedicine,
  getMedicines,
  updateMedicineStatus,
  updateDoseStatus,
  sendFirestoreError,
};
