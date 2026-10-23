const { getDb, getMessaging } = require('../config/firebase');

function isInvalidToken(error) {
  const code = String(error?.code || '');
  return code.includes('registration-token-not-registered') || code.includes('invalid-registration-token');
}

function preferenceForType(type) {
  if (String(type).startsWith('medicine-')) return 'medicine';
  if (String(type).startsWith('health-')) return 'health';
  if (String(type).startsWith('emergency-') || String(type) === 'sos') return 'emergency';
  return null;
}

async function deliver(entries, payload) {
  const unique = new Map();
  for (const entry of entries) {
    const token = String(entry.data()?.token || '').trim();
    if (token && !unique.has(token)) unique.set(token, entry);
  }

  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (const [token, doc] of unique) {
    try {
      await getMessaging().send({
        token,
        data: {
          type: String(payload.type || 'carewise-alert'),
          title: String(payload.title || 'Carewise alert'),
          body: String(payload.body || 'Open Carewise to review an update.'),
          url: String(payload.url || '/pages/notifications.html'),
        },
        webpush: { headers: { Urgency: payload.urgency || 'normal' } },
      });
      sent += 1;
    } catch (error) {
      if (isInvalidToken(error)) {
        await doc.ref.delete().catch(() => {});
        removed += 1;
      } else {
        failed += 1;
        console.error('[Notifications] Push delivery failed:', error.code || 'unknown');
      }
    }
  }
  return { sent, removed, failed };
}

async function sendToPatient(patientId, payload, roles = ['patient', 'family']) {
  // Automated alerts stay off until an operator has verified the explicit test push.
  if (process.env.FCM_AUTOMATED_NOTIFICATIONS_ENABLED !== 'true') {
    return { sent: 0, removed: 0, failed: 0, skipped: true };
  }

  const db = getDb();
  const tokens = db.collection('notificationTokens');
  const access = db.collection('notificationAccess');
  const [accessSnapshot, registeredSnapshot] = await Promise.all([
    access.where('patientId', '==', patientId).where('status', '==', 'active').get(),
    tokens.where('patientIds', 'array-contains', patientId).get(),
  ]);

  const allowedUids = new Set(accessSnapshot.docs
    .filter(doc => roles.includes(doc.get('role')) && doc.get('authUid'))
    .map(doc => doc.get('authUid')));
  const preference = preferenceForType(payload.type);
  const entries = registeredSnapshot.docs.filter(doc => {
    if (!allowedUids.has(doc.get('principalUid'))) return false;
    return !preference || doc.get(`preferences.${preference}`) !== false;
  });
  return deliver(entries, payload);
}

async function sendToPrincipal(uid, payload) {
  const snapshot = await getDb().collection('notificationTokens')
    .where('principalUid', '==', uid).get();
  return deliver(snapshot.docs, payload);
}

module.exports = { sendToPatient, sendToPrincipal };
