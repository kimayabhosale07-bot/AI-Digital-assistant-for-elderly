const { getDb } = require('../config/firebase');
const crypto = require('crypto');

/**
 * POST /appointment
 * Schedules a new doctor appointment for a user.
 */
const addAppointment = async (req, res) => {
  try {
    const db = req.app?.locals?.db || getDb();
    const { userId, doctorName, date, time, location, idempotencyKey, confirmed } = req.body;

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

    if (idempotencyKey !== undefined) {
      if (confirmed !== true) return res.status(400).json({ error: 'Explicit confirmation is required before saving this appointment.' });
      if (typeof idempotencyKey !== 'string' || !/^[a-z0-9-]{16,64}$/i.test(idempotencyKey)) {
        return res.status(400).json({ error: 'This appointment draft is invalid. Review it and try again.' });
      }
      const apptId = `assistant_${crypto.createHash('sha256').update(`${userId}:${idempotencyKey}`).digest('hex').slice(0, 40)}`;
      const appointmentRef = db.collection('appointments').doc(apptId);
      const userRef = db.collection('users').doc(userId);
      const appointmentData = { userId, doctorName, date, time, location, reminderSent: false, createdAt: new Date().toISOString() };
      const outcome = await db.runTransaction(async transaction => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists) return { error: { status: 404, message: 'The Carewise profile does not exist. No appointment was saved.' } };
        const existing = await transaction.get(appointmentRef);
        if (existing.exists) {
          const data = existing.data();
          const matches = data.userId === userId && data.doctorName === doctorName && data.date === date && data.time === time && data.location === location;
          return matches ? { duplicate: true, appointment: { apptId, ...data } } : { error: { status: 409, message: 'This appointment draft ID is already used for different details. Review the draft before saving.' } };
        }
        transaction.create(appointmentRef, { apptId, ...appointmentData });
        return { duplicate: false, appointment: { apptId, ...appointmentData } };
      });
      if (outcome.error) return res.status(outcome.error.status).json({ error: outcome.error.message });
      return res.status(outcome.duplicate ? 200 : 201).json({
        success: true,
        duplicate: outcome.duplicate,
        message: outcome.duplicate ? 'This appointment was already saved. No duplicate was created.' : 'Appointment scheduled successfully',
        apptId,
        appointment: outcome.appointment,
      });
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
    const db = req.app?.locals?.db || getDb();
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

/** PUT /appointment/:apptId/completion — completion is independent of booking/cancellation. */
const updateAppointmentCompletion = async (req, res) => {
  try {
    const db = req.app?.locals?.db || getDb();
    const { apptId } = req.params;
    const { userId, completed } = req.body;
    if (!userId || typeof completed !== 'boolean') {
      return res.status(400).json({ error: 'userId and a completed boolean are required.' });
    }
    const ref = db.collection('appointments').doc(apptId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return res.status(404).json({ error: 'Appointment not found.' });
    const appointment = snapshot.data();
    if (appointment.userId !== userId) return res.status(403).json({ error: 'Appointment does not belong to this user.' });
    if (completed) {
      const visitAt = new Date(`${appointment.date}T${appointment.time || '00:00'}:00`);
      if (!Number.isNaN(visitAt.getTime()) && visitAt.getTime() > Date.now()) {
        return res.status(400).json({ error: 'An appointment can be marked complete after its scheduled time.' });
      }
    }
    const completedAt = completed ? new Date().toISOString() : null;
    await ref.update({ completed, completedAt });
    return res.status(200).json({ success: true, apptId, userId, completed, completedAt });
  } catch (error) {
    console.error('Error in updateAppointmentCompletion:', error.message);
    return res.status(500).json({ error: 'Could not update appointment completion. Please retry.' });
  }
};

module.exports = {
  addAppointment,
  getAppointments,
  updateAppointmentCompletion,
};
