const cron = require('node-cron');
const { getDb } = require('../config/firebase');
const { sendSMS } = require('../config/twilio');
const { sendToPatient } = require('../services/pushNotifications');
require('dotenv').config();

const MEDICINE_GRACE_PERIOD_MIN = parseInt(process.env.MEDICINE_GRACE_PERIOD_MIN || '30', 10);

/**
 * Initializes and starts background cron jobs.
 * 1. Every minute check: Logs due medicines, alerts contacts and updates status for overdue medicines.
 * 2. Midnight check: Resets medicine schedules status back to "pending" for the new day.
 */
const startReminderJob = () => {
  console.log('⏰ Background Cron jobs initialized.');

  // Job 1: Medicine reminder and overdue check (runs every minute)
  cron.schedule('* * * * *', async () => {
    try {
      const db = getDb();
      const now = new Date();

      // Current time in HH:MM format (24-hour)
      const currentHours = now.getHours().toString().padStart(2, '0');
      const currentMinutes = now.getMinutes().toString().padStart(2, '0');
      const currentTimeStr = `${currentHours}:${currentMinutes}`;

      // Query medicines that are still pending
      const snapshot = await db.collection('medicines')
        .where('status', '==', 'pending')
        .get();

      if (snapshot.empty) {
        return;
      }

      for (const doc of snapshot.docs) {
        const medicine = doc.data();
        const medId = doc.id;
        const { userId, medicineName, dosage, time } = medicine;

        if (!time) continue;

        // A. Log if the current time matches the scheduled time
        if (time === currentTimeStr) {
          console.log(`⏰ [Reminder Due] Medicine: "${medicineName}" (${dosage}) is scheduled now at ${time} for User ID: ${userId}.`);
          const scheduledDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          const dueAlertId = `${medId}_${scheduledDate}_MEDICINE_DUE`;
          try {
            await db.collection('alerts').doc(dueAlertId).create({
              alertId: dueAlertId,
              userId,
              type: 'MEDICINE_DUE',
              timestamp: now.toISOString(),
            });
          } catch (alertError) {
            if (![6, '6', 'already-exists'].includes(alertError.code)) throw alertError;
          }
          try {
            await sendToPatient(userId, {
              type: 'medicine-reminder',
              title: 'Medicine reminder',
              body: 'A scheduled medicine is due. Open Carewise to review it.',
            }, ['patient']);
          } catch (pushError) {
            console.error('[Medicine Reminder] Web push failed:', pushError.code || 'unknown');
          }
        }

        // B. Check if medicine is overdue by more than grace period
        const [schedHours, schedMinutes] = time.split(':').map(Number);
        
        // Construct the scheduled time date object for TODAY
        const scheduledDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          schedHours,
          schedMinutes,
          0
        );

        // Difference in minutes (elapsed time)
        const diffMs = now.getTime() - scheduledDate.getTime();
        const diffMins = Math.floor(diffMs / (1000 * 60));

        // If elapsed time is greater than or equal to the grace period, it is overdue
        if (diffMins >= MEDICINE_GRACE_PERIOD_MIN) {
          console.log(`⚠️ [Medicine Overdue] "${medicineName}" is ${diffMins} mins overdue (grace: ${MEDICINE_GRACE_PERIOD_MIN} mins) for user ${userId}. Marking as "missed".`);

          // 1. Immediately update status in database to 'missed' to prevent double alerts
          await db.collection('medicines').doc(medId).update({ status: 'missed' });

          // 2. Fetch user's profile and emergency contacts
          try {
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) {
              const userData = userDoc.data();
              const contacts = userData.emergencyContacts || [];
              const smsBody = `⚠️ MEDICINE ALERT: ${userData.name} missed their scheduled medicine "${medicineName}" (Dosage: ${dosage}) scheduled for ${time}. It is now more than ${MEDICINE_GRACE_PERIOD_MIN} minutes overdue.`;

              const notificationSummary = [];

              // Send SMS to all emergency contacts
              for (const contact of contacts) {
                const smsResult = await sendSMS(contact.phone, smsBody);
                notificationSummary.push({
                  name: contact.name,
                  phone: contact.phone,
                  success: smsResult.success,
                  simulated: smsResult.simulated || false,
                  error: smsResult.error || null
                });
              }

              let pushSummary = { sent: 0, failed: 0, removed: 0 };
              try {
                pushSummary = await sendToPatient(userId, {
                  type: 'medicine-missed',
                  title: 'Missed medicine alert',
                  body: 'A scheduled medicine is overdue. Open Carewise to review the alert.',
                  urgency: 'high',
                });
              } catch (pushError) {
                console.error('[Medicine Overdue] Web push failed:', pushError.code || 'unknown');
              }

              // 3. Log the alert event
              const alertData = {
                userId,
                type: 'MEDICINE_MISSED',
                timestamp: new Date().toISOString(),
                notifiedContacts: notificationSummary,
                pushNotifications: pushSummary,
                details: {
                  medicineName,
                  dosage,
                  scheduledTime: time,
                  delayMinutes: diffMins
                }
              };
              const alertRef = await db.collection('alerts').add(alertData);
              await alertRef.update({ alertId: alertRef.id });
            } else {
              console.error(`[Medicine Overdue] User ID ${userId} not found. Cannot alert emergency contacts.`);
            }
          } catch (userErr) {
            console.error(`[Medicine Overdue] Error checking user/alert for ${userId}:`, userErr.message);
          }
        }
      }
    } catch (error) {
      // Gracefully catch database connection errors if Firebase is unconfigured
      if (error.message && error.message.includes('not initialized')) {
        return;
      }
      console.error('Error in medicine reminder job execution:', error);
    }
  });

  // Job 2: Reset medicine schedules status to 'pending' (runs daily at midnight)
  cron.schedule('0 0 * * *', async () => {
    try {
      const db = getDb();
      console.log('🔄 [Daily Reset] Running midnight task to reset all medicine statuses to "pending"...');

      const snapshot = await db.collection('medicines').get();
      if (snapshot.empty) {
        console.log('🔄 [Daily Reset] No medicine schedules found to reset.');
        return;
      }

      const batch = db.batch();
      snapshot.forEach(doc => {
        batch.update(doc.ref, { status: 'pending' });
      });

      await batch.commit();
      console.log(`🔄 [Daily Reset] Successfully reset ${snapshot.size} medicines to "pending" for the new day.`);
    } catch (error) {
      if (error.message && error.message.includes('not initialized')) {
        return;
      }
      console.error('Error executing midnight daily reset job:', error);
    }
  });
};

module.exports = {
  startReminderJob,
};
