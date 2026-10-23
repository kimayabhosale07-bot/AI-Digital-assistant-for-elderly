const cron = require('node-cron');
const { getDb } = require('../config/firebase');
require('dotenv').config();

const MEDICINE_GRACE_PERIOD_MIN = parseInt(process.env.MEDICINE_GRACE_PERIOD_MIN || '30', 10);

const startReminderJob = () => {
  console.log('⏰ Medicine schedule jobs initialized.');

  cron.schedule('* * * * *', async () => {
    try {
      const db = getDb();
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      const snapshot = await db.collection('medicines')
        .where('status', '==', 'pending')
        .get();

      for (const doc of snapshot.docs) {
        const { medicineName, time } = doc.data();
        if (!time) continue;

        const [hours, minutes] = time.split(':').map(Number);
        const scheduledTime = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          hours,
          minutes,
        );
        const elapsedMinutes = Math.floor((now.getTime() - scheduledTime.getTime()) / 60000);

        if (elapsedMinutes >= MEDICINE_GRACE_PERIOD_MIN) {
          await doc.ref.update({ status: 'missed' });
          console.log(`[Medicine Overdue] "${medicineName}" scheduled for ${time} marked as missed.`);
        } else if (time === currentTime) {
          console.log(`[Medicine Due] "${medicineName}" is scheduled now at ${time}.`);
        }
      }
    } catch (error) {
      if (error.message && error.message.includes('not initialized')) return;
      console.error('Error in medicine schedule job execution:', error);
    }
  });

  cron.schedule('0 0 * * *', async () => {
    try {
      const db = getDb();
      const snapshot = await db.collection('medicines').get();
      if (snapshot.empty) return;

      const batch = db.batch();
      snapshot.forEach(doc => batch.update(doc.ref, { status: 'pending' }));
      await batch.commit();
      console.log(`[Daily Reset] Reset ${snapshot.size} medicine schedules to pending.`);
    } catch (error) {
      if (error.message && error.message.includes('not initialized')) return;
      console.error('Error executing midnight medicine status reset:', error);
    }
  });
};

module.exports = { startReminderJob };
