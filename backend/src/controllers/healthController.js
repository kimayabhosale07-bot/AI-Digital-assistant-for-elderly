const { getDb } = require('../config/firebase');

/**
 * POST /health-log
 * Logs heart rate and steps for a user and flags readings outside the expected range.
 */
const logHealthReading = async (req, res) => {
  try {
    const db = getDb();
    const { userId, heartRate, steps } = req.body;

    if (!userId || heartRate === undefined || steps === undefined) {
      return res.status(400).json({
        error: 'Missing required fields. userId, heartRate, and steps are all required.',
      });
    }

    const hrNumber = Number(heartRate);
    const stepsNumber = Number(steps);
    if (Number.isNaN(hrNumber) || Number.isNaN(stepsNumber)) {
      return res.status(400).json({ error: 'heartRate and steps must be valid numbers.' });
    }

    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: `User with ID ${userId} does not exist.` });
    }

    const healthLogData = {
      userId,
      heartRate: hrNumber,
      steps: stepsNumber,
      timestamp: new Date().toISOString(),
      flagged: hrNumber < 60 || hrNumber > 100,
    };
    const logDocRef = await db.collection('healthLogs').add(healthLogData);
    await logDocRef.update({ logId: logDocRef.id });

    return res.status(201).json({
      message: healthLogData.flagged
        ? 'Health reading logged and flagged for review.'
        : 'Health reading logged successfully.',
      logId: logDocRef.id,
      data: { logId: logDocRef.id, ...healthLogData },
      flagged: healthLogData.flagged,
    });
  } catch (error) {
    console.error('Error in logHealthReading:', error);
    return res.status(500).json({ error: error.message });
  }
};

module.exports = { logHealthReading };
