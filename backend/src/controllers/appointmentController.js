const { getDb } = require('../config/firebase');

/**
 * POST /appointment
 * Schedules a new doctor appointment for a user.
 */
const addAppointment = async (req, res) => {
  try {
    const db = getDb();
    const { userId, doctorName, date, time, location } = req.body;

    if (!userId || !doctorName || !date || !time || !location) {
      return res.status(400).json({
        error: 'Missing required fields. userId, doctorName, date, time, and location are all required.'
      });
    }

    // Verify date format YYYY-MM-DD
    const dateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD (e.g., 2026-07-25).' });
    }

    // Verify time format HH:MM
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(time)) {
      return res.status(400).json({ error: 'Invalid time format. Use HH:MM (24-hour format, e.g., 10:30 or 15:45).' });
    }

    // Optional: Check if user exists
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: `User with ID ${userId} does not exist.` });
    }

    const appointmentData = {
      userId,
      doctorName,
      date,
      time,
      location,
      reminderSent: false, // Default is false, will be processed later
      createdAt: new Date().toISOString()
    };

    const docRef = await db.collection('appointments').add(appointmentData);

    // Save apptId inside the document for consistency
    await docRef.update({ apptId: docRef.id });

    return res.status(201).json({
      message: 'Appointment scheduled successfully',
      apptId: docRef.id,
      appointment: { apptId: docRef.id, ...appointmentData }
    });
  } catch (error) {
    console.error('Error in addAppointment:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /appointment/:userId
 * Retrieves all scheduled appointments for a user.
 */
const getAppointments = async (req, res) => {
  try {
    const db = getDb();
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'User ID parameter is required.' });
    }

    const snapshot = await db.collection('appointments')
      .where('userId', '==', userId)
      .get();

    const appointments = [];
    snapshot.forEach(doc => {
      appointments.push({ apptId: doc.id, ...doc.data() });
    });

    // Sort by date and time ascending
    appointments.sort((a, b) => {
      const dateTimeA = new Date(`${a.date}T${a.time}`);
      const dateTimeB = new Date(`${b.date}T${b.time}`);
      return dateTimeA - dateTimeB;
    });

    return res.status(200).json(appointments);
  } catch (error) {
    console.error('Error in getAppointments:', error);
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  addAppointment,
  getAppointments,
};
