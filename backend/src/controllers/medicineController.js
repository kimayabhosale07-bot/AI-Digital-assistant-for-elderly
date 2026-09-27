const { getDb } = require('../config/firebase');

/**
 * POST /medicine
 * Adds a new medicine schedule for a user.
 */
const addMedicine = async (req, res) => {
  try {
    const db = getDb();
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
    console.error('Error in addMedicine:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /medicine/:userId
 * Retrieves all medicine schedules for a specific user.
 */
const getMedicines = async (req, res) => {
  try {
    const db = getDb();
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'User ID parameter is required.' });
    }

    const snapshot = await db.collection('medicines')
      .where('userId', '==', userId)
      .get();

    const medicines = [];
    snapshot.forEach(doc => {
      medicines.push({ medId: doc.id, ...doc.data() });
    });

    return res.status(200).json(medicines);
  } catch (error) {
    console.error('Error in getMedicines:', error);
    return res.status(500).json({ error: error.message });
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
    console.error('Error in updateMedicineStatus:', error);
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  addMedicine,
  getMedicines,
  updateMedicineStatus,
};
