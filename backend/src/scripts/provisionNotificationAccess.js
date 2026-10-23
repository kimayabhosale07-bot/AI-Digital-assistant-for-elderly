const crypto = require('crypto');
const { getDb } = require('../config/firebase');

const [profileIdArg, emailArg, modeArg] = process.argv.slice(2);
const profileId = String(profileIdArg || '').trim();
const email = String(emailArg || '').trim().toLowerCase();
const apply = modeArg === '--apply';
const emailHash = crypto.createHash('sha256').update(email).digest('hex');
const grantId = crypto.createHash('sha256')
  .update(`${emailHash}:${profileId}:patient`).digest('hex');

async function main() {
  if (!profileId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (modeArg && !apply)) {
    throw new Error('Usage: node src/scripts/provisionNotificationAccess.js <existing-profile-id> <verified-email> [--apply]');
  }

  const db = getDb();
  const profile = await db.collection('users').doc(profileId).get();
  if (!profile.exists) throw new Error('The specified existing Carewise profile was not found.');

  const ref = db.collection('notificationAccess').doc(grantId);
  const existing = await ref.get();
  if (existing.exists && existing.get('status') !== 'revoked') {
    console.log('A notification access grant already exists; no changes made.');
    return;
  }
  if (!apply) {
    console.log('Dry run complete: an existing patient profile was found. Re-run with --apply after confirming this email belongs to that patient.');
    return;
  }

  const grant = {
    email,
    emailHash,
    patientId: profileId,
    role: 'patient',
    status: 'active',
    authUid: null,
    createdAt: new Date().toISOString(),
  };
  if (existing.exists) await ref.set(grant);
  else await ref.create(grant);
  console.log('Patient notification access was provisioned. The patient must sign in with this verified email to activate it.');
}

main().catch(error => {
  console.error('Notification access provisioning failed:', error.message);
  process.exitCode = 1;
});
