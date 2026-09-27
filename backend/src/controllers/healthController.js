const { getDb } = require('../config/firebase');
const { sendSMS } = require('../config/twilio');

/**
 * POST /health-log
 * Logs heart rate and steps for a user. Auto-flags if heart rate is abnormal (outside 60-100 bpm).
 * If flagged, sends Twilio SMS notifications to emergency contacts and logs an alert.
 */
const logHealthReading = async (req, res) => {
  try {
    const db = getDb();
    const { userId, heartRate, steps } = req.body;

    if (!userId || heartRate === undefined || steps === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields. userId, heartRate, and steps are all required.' 
      });
    }

    const hrNumber = Number(heartRate);
    const stepsNumber = Number(steps);

    if (isNaN(hrNumber) || isNaN(stepsNumber)) {
      return res.status(400).json({ error: 'heartRate and steps must be valid numbers.' });
    }

    // Retrieve user details for potential alert messaging
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: `User with ID ${userId} does not exist.` });
    }
    const userData = userDoc.data();

    // Determine if heart rate is outside the healthy range of 60-100 bpm
    const isFlagged = hrNumber < 60 || hrNumber > 100;

    const healthLogData = {
      userId,
      heartRate: hrNumber,
      steps: stepsNumber,
      timestamp: new Date().toISOString(),
      flagged: isFlagged
    };

    // Save to healthLogs collection
    const logDocRef = await db.collection('healthLogs').add(healthLogData);
    await logDocRef.update({ logId: logDocRef.id });

    let notificationSummary = [];

    // Send emergency alert SMS if reading is flagged
    if (isFlagged) {
      const contacts = userData.emergencyContacts || [];
      const smsBody = `⚠️ HEALTH ALERT: Abnormal heart rate detected for ${userData.name}. Heart Rate: ${hrNumber} bpm (Normal: 60-100 bpm). Please check on them!`;

      if (contacts.length === 0) {
        console.warn(`[Health Alert] User ${userData.name} (${userId}) has no emergency contacts configured.`);
      }

      for (const contact of contacts) {
        try {
          const smsResult = await sendSMS(contact.phone, smsBody);
          notificationSummary.push({
            name: contact.name,
            phone: contact.phone,
            success: smsResult.success,
            simulated: smsResult.simulated || false,
            error: smsResult.error || null
          });
        } catch (smsErr) {
          console.error(`Failed to send SMS to ${contact.name} (${contact.phone}):`, smsErr.message);
          notificationSummary.push({
            name: contact.name,
            phone: contact.phone,
            success: false,
            error: smsErr.message
          });
        }
      }

      // Log alert details in database
      const alertData = {
        userId,
        type: 'HEART_RATE_ANOMALY',
        timestamp: new Date().toISOString(),
        notifiedContacts: notificationSummary
      };
      const alertDocRef = await db.collection('alerts').add(alertData);
      await alertDocRef.update({ alertId: alertDocRef.id });
    }

    return res.status(201).json({
      message: isFlagged 
        ? 'Health reading logged and flagged! Emergency contacts notified.' 
        : 'Health reading logged successfully.',
      logId: logDocRef.id,
      data: { logId: logDocRef.id, ...healthLogData },
      flagged: isFlagged,
      notificationsSent: notificationSummary
    });
  } catch (error) {
    console.error('Error in logHealthReading:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * POST /emergency/:userId
 * Triggers SOS alerts for a user, instantly sending SMS via Twilio to all emergency contacts.
 * Also records the SOS alert event.
 */
const triggerSOS = async (req, res) => {
  try {
    const db = getDb();
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'User ID parameter is required.' });
    }

    // Retrieve user details
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: `User with ID ${userId} does not exist.` });
    }
    const userData = userDoc.data();
    const contacts = userData.emergencyContacts || [];

    if (contacts.length === 0) {
      return res.status(400).json({ 
        error: `User has no emergency contacts configured. Cannot broadcast SOS SMS alerts.` 
      });
    }

    const smsBody = `🚨 EMERGENCY SOS: ${userData.name} (Phone: ${userData.phone}) has triggered an emergency SOS panic button. Please contact or assist them immediately!`;
    const notificationSummary = [];

    // Send SMS to all registered emergency contacts
    for (const contact of contacts) {
      try {
        const smsResult = await sendSMS(contact.phone, smsBody);
        notificationSummary.push({
          name: contact.name,
          phone: contact.phone,
          success: smsResult.success,
          simulated: smsResult.simulated || false,
          error: smsResult.error || null
        });
      } catch (smsErr) {
        console.error(`SOS: Failed to send SMS to ${contact.name} (${contact.phone}):`, smsErr.message);
        notificationSummary.push({
          name: contact.name,
          phone: contact.phone,
          success: false,
          error: smsErr.message
        });
      }
    }

    // Log the SOS emergency alert in the database
    const alertData = {
      userId,
      type: 'SOS',
      timestamp: new Date().toISOString(),
      notifiedContacts: notificationSummary
    };
    const alertDocRef = await db.collection('alerts').add(alertData);
    await alertDocRef.update({ alertId: alertDocRef.id });

    return res.status(200).json({
      message: 'Emergency SOS triggered successfully! Alerts sent to emergency contacts.',
      alertId: alertDocRef.id,
      userId,
      notificationsSent: notificationSummary
    });
  } catch (error) {
    console.error('Error in triggerSOS:', error);
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  logHealthReading,
  triggerSOS,
};
