const crypto = require('crypto');
const { getDb, getAuth } = require('../config/firebase');

async function hasPatientPushAuthorization(req, patientId) {
  const authorization = String(req.get('authorization') || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  try {
    const claims = await getAuth().verifyIdToken(match[1], true);
    const email = String(claims.email || '').trim().toLowerCase();
    if (!claims.uid || !claims.email_verified || !email) return false;

    const emailHash = crypto.createHash('sha256').update(email).digest('hex');
    const snapshot = await getDb().collection('notificationAccess')
      .where('emailHash', '==', emailHash).get();
    return snapshot.docs.some(doc =>
      doc.get('status') === 'active'
      && doc.get('authUid') === claims.uid
      && doc.get('patientId') === patientId
      && doc.get('role') === 'patient');
  } catch (error) {
    console.error('[Notifications] Patient push authorization failed:', error.code || 'unknown');
    return false;
  }
}

module.exports = { hasPatientPushAuthorization };
