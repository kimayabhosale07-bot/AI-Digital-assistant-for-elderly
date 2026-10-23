const crypto = require('crypto');
const { getDb, getAuth } = require('../config/firebase');
const { sendToPrincipal } = require('../services/pushNotifications');

const ACCESS_COLLECTION = 'notificationAccess';
const TOKEN_COLLECTION = 'notificationTokens';
const INVITATION_COLLECTION = 'notificationInvitations';
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizeEmail = value => String(value || '').trim().toLowerCase();

function accessDocumentId(emailHash, patientId, role) {
  return hash(`${emailHash}:${patientId}:${role}`);
}

async function getVerifiedIdentity(req, res) {
  const authorization = String(req.get('authorization') || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Sign in with your verified notification email first.' });
    return null;
  }

  let claims;
  try {
    claims = await getAuth().verifyIdToken(match[1], true);
  } catch (error) {
    const code = String(error?.code || '');
    if (/token-expired|invalid-id-token|argument-error|user-disabled|token-revoked/.test(code)) {
      res.status(401).json({ error: 'Your notification sign-in expired. Sign in again using the emailed link.' });
    } else {
      console.error('[Notifications] ID token verification failed:', code || 'unknown');
      res.status(503).json({ error: 'Could not verify your notification sign-in right now. Please retry.' });
    }
    return null;
  }

  const email = normalizeEmail(claims.email);
  if (!claims.email_verified || !email || !claims.uid) {
    res.status(403).json({ error: 'Use the verified email sign-in link before managing notifications.' });
    return null;
  }

  return { uid: claims.uid, email, emailHash: hash(email) };
}

async function resolvePrincipalAccess(identity, res) {
  try {
    const db = getDb();
    const snapshot = await db.collection(ACCESS_COLLECTION).where('emailHash', '==', identity.emailHash).get();
    const access = [];

    for (const candidate of snapshot.docs) {
      const resolved = await db.runTransaction(async transaction => {
        const current = await transaction.get(candidate.ref);
        if (!current.exists) return null;
        const data = current.data();
        if (data.status !== 'active' || data.emailHash !== identity.emailHash) return null;
        if (data.authUid && data.authUid !== identity.uid) return null;
        if (!data.patientId || !['patient', 'family'].includes(data.role)) return null;

        const profile = await transaction.get(db.collection('users').doc(data.patientId));
        if (!profile.exists) return null;
        if (!data.authUid) {
          transaction.update(candidate.ref, {
            authUid: identity.uid,
            activatedAt: new Date().toISOString(),
          });
        }
        return {
          patientId: data.patientId,
          patientName: String(profile.get('name') || 'Carewise patient'),
          role: data.role,
        };
      });
      if (resolved) access.push(resolved);
    }

    if (!access.length) {
      res.status(403).json({ error: 'This verified email is not linked to a Carewise profile or accepted family invitation.' });
      return null;
    }
    return { ...identity, access };
  } catch (error) {
    console.error('[Notifications] Access lookup failed:', error.code || 'unknown');
    res.status(503).json({ error: 'Could not check notification access right now. Please retry.' });
    return null;
  }
}

async function requireVerifiedPrincipal(req, res) {
  const identity = await getVerifiedIdentity(req, res);
  if (!identity) return null;
  return resolvePrincipalAccess(identity, res);
}

function accessResponse(identity) {
  return {
    success: true,
    access: identity.access,
    roles: [...new Set(identity.access.map(item => item.role))],
  };
}

async function verifyNotificationIdentity(req, res) {
  const identity = await requireVerifiedPrincipal(req, res);
  if (!identity) return;
  return res.status(200).json(accessResponse(identity));
}

async function registerNotificationToken(req, res) {
  const identity = await requireVerifiedPrincipal(req, res);
  if (!identity) return;
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token || token.length > 4096) return res.status(400).json({ error: 'A valid FCM registration token is required.' });
  const preferenceInput = req.body?.preferences || {};
  const preferences = {
    medicine: typeof preferenceInput.medicine === 'boolean' ? preferenceInput.medicine : true,
    health: typeof preferenceInput.health === 'boolean' ? preferenceInput.health : true,
    emergency: typeof preferenceInput.emergency === 'boolean' ? preferenceInput.emergency : true,
  };

  try {
    const db = getDb();
    const ref = db.collection(TOKEN_COLLECTION).doc(hash(token));
    const existing = await ref.get();
    const patientIds = [...new Set(identity.access.map(item => item.patientId))];
    const now = new Date().toISOString();
    await ref.set({
      principalUid: identity.uid,
      patientIds,
      token,
      platform: 'web',
      preferences,
      createdAt: existing.exists ? existing.data().createdAt : now,
      updatedAt: now,
    });
    return res.status(200).json({
      success: true,
      registrationId: ref.id,
      message: 'Notifications are enabled for this browser.',
    });
  } catch (error) {
    console.error('[Notifications] Token registration failed:', error.code || 'unknown');
    return res.status(503).json({ error: 'Could not save this browser registration. Please try again.' });
  }
}

async function removeNotificationToken(req, res) {
  const identity = await requireVerifiedPrincipal(req, res);
  if (!identity) return;
  const registrationId = String(req.body?.registrationId || '').trim();
  if (!/^[a-f0-9]{64}$/.test(registrationId)) return res.status(400).json({ error: 'A valid browser registration is required.' });
  try {
    const db = getDb();
    const tokenCollection = db.collection(TOKEN_COLLECTION);
    const ref = tokenCollection.doc(registrationId);
    const doc = await ref.get();
    if (doc.exists && doc.get('principalUid') === identity.uid) await ref.delete();
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Notifications] Token removal failed:', error.code || 'unknown');
    return res.status(503).json({ error: 'Could not remove this browser registration. Please try again.' });
  }
}

async function updateNotificationPreferences(req, res) {
  const identity = await requireVerifiedPrincipal(req, res);
  if (!identity) return;
  const registrationId = String(req.body?.registrationId || '').trim();
  const input = req.body?.preferences;
  if (!/^[a-f0-9]{64}$/.test(registrationId)
    || !input || ['medicine', 'health', 'emergency'].some(key => typeof input[key] !== 'boolean')) {
    return res.status(400).json({ error: 'A browser registration and all notification preferences are required.' });
  }
  try {
    const ref = getDb().collection(TOKEN_COLLECTION).doc(registrationId);
    const registration = await ref.get();
    if (!registration.exists || registration.get('principalUid') !== identity.uid) {
      return res.status(404).json({ error: 'This browser registration is not available to this account.' });
    }
    await ref.update({
      preferences: {
        medicine: input.medicine,
        health: input.health,
        emergency: input.emergency,
      },
      updatedAt: new Date().toISOString(),
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Notifications] Preference update failed:', error.code || 'unknown');
    return res.status(503).json({ error: 'Could not save notification preferences. Please retry.' });
  }
}

async function sendTestNotification(req, res) {
  const identity = await requireVerifiedPrincipal(req, res);
  if (!identity) return;
  if (req.body?.confirmed !== true) return res.status(400).json({ error: 'Confirm the test notification before sending.' });
  try {
    const result = await sendToPrincipal(identity.uid, {
      type: 'carewise-test',
      title: 'Carewise test notification',
      body: 'Notifications are connected on this device.',
    });
    if (!result.sent) return res.status(502).json({ error: 'The test push could not be delivered. Re-enable notifications and try again.' });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[Notifications] Test push failed:', error.code || 'unknown');
    return res.status(503).json({ error: 'The test notification service is unavailable. Please retry.' });
  }
}

async function inviteFamilyMember(req, res) {
  const identity = await requireVerifiedPrincipal(req, res);
  if (!identity) return;
  const patientId = String(req.body?.patientId || '').trim();
  const displayName = String(req.body?.name || '').trim().slice(0, 100);
  const email = normalizeEmail(req.body?.email);
  if (!patientId || !displayName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Select an authorized patient profile and enter the family member name and email.' });
  }
  if (!identity.access.some(item => item.patientId === patientId && item.role === 'patient')) {
    return res.status(403).json({ error: 'Only the authenticated patient account can invite family members to this profile.' });
  }
  if (hash(email) === identity.emailHash) return res.status(400).json({ error: 'Use a different email address for a family invitation.' });

  try {
    const emailHash = hash(email);
    const existingAccess = await getDb().collection(ACCESS_COLLECTION)
      .doc(accessDocumentId(emailHash, patientId, 'family')).get();
    if (existingAccess.exists && existingAccess.get('status') === 'active') {
      return res.status(409).json({ error: 'This family email already has access to the profile.' });
    }
    const previousInvitations = await getDb().collection(INVITATION_COLLECTION)
      .where('patientId', '==', patientId).where('emailHash', '==', emailHash).get();
    const supersededAt = new Date().toISOString();
    for (const previous of previousInvitations.docs) {
      if (previous.get('status') === 'pending') {
        await previous.ref.update({ status: 'revoked', revokedAt: supersededAt });
      }
    }
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const ref = getDb().collection(INVITATION_COLLECTION).doc(hash(inviteToken));
    const now = new Date().toISOString();
    const profile = await getDb().collection('users').doc(patientId).get();
    if (!profile.exists) return res.status(404).json({ error: 'The patient profile no longer exists.' });
    await ref.create({
      email,
      emailHash,
      patientId,
      displayName,
      role: 'family',
      status: 'pending',
      invitedByUid: identity.uid,
      createdAt: now,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
    });
    // This secret is returned once so the browser can place it in the emailed
    // sign-in link. Only its hash is stored server-side.
    return res.status(201).json({ success: true, invitationToken: inviteToken, expiresAt: new Date(Date.now() + INVITATION_TTL_MS).toISOString() });
  } catch (error) {
    console.error('[Notifications] Family invitation failed:', error.code || 'unknown');
    return res.status(503).json({ error: 'Could not create the family invitation. Please retry.' });
  }
}

async function acceptFamilyInvitation(req, res) {
  const identity = await getVerifiedIdentity(req, res);
  if (!identity) return;
  const invitationToken = String(req.body?.invitationToken || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(invitationToken)) {
    return res.status(400).json({ error: 'The family invitation link is invalid.' });
  }

  try {
    const db = getDb();
    const invitationRef = db.collection(INVITATION_COLLECTION).doc(hash(invitationToken));
    const invitation = await db.runTransaction(async transaction => {
      const invitationSnapshot = await transaction.get(invitationRef);
      if (!invitationSnapshot.exists) return { error: 'invalid' };
      const data = invitationSnapshot.data();
      if (data.status !== 'pending') return { error: 'used' };
      if (data.emailHash !== identity.emailHash) return { error: 'email' };
      if (!Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now()) {
        transaction.update(invitationRef, { status: 'expired', expiredAt: new Date().toISOString() });
        return { error: 'expired' };
      }

      const profileRef = db.collection('users').doc(data.patientId);
      const accessRef = db.collection(ACCESS_COLLECTION).doc(accessDocumentId(identity.emailHash, data.patientId, 'family'));
      const [profile, existingAccess] = await Promise.all([
        transaction.get(profileRef),
        transaction.get(accessRef),
      ]);
      if (!profile.exists) return { error: 'profile' };
      if (existingAccess.exists && existingAccess.get('status') === 'active'
        && existingAccess.get('authUid') !== identity.uid) return { error: 'conflict' };

      const now = new Date().toISOString();
      transaction.set(accessRef, {
        email: identity.email,
        emailHash: identity.emailHash,
        patientId: data.patientId,
        role: 'family',
        status: 'active',
        authUid: identity.uid,
        invitedByUid: data.invitedByUid,
        activatedAt: existingAccess.exists ? existingAccess.get('activatedAt') || now : now,
        acceptedAt: now,
      });
      transaction.update(invitationRef, {
        status: 'accepted',
        acceptedByUid: identity.uid,
        acceptedAt: now,
      });
      return {
        patientId: data.patientId,
        patientName: String(profile.get('name') || 'Carewise patient'),
        role: 'family',
      };
    });

    if (invitation.error === 'email') return res.status(403).json({ error: 'Sign in with the email address that received this invitation.' });
    if (invitation.error === 'expired') return res.status(410).json({ error: 'This family invitation expired. Ask the patient to send a new one.' });
    if (invitation.error === 'used') return res.status(410).json({ error: 'This family invitation has already been used or revoked.' });
    if (invitation.error === 'profile') return res.status(404).json({ error: 'The patient profile no longer exists.' });
    if (invitation.error === 'conflict') return res.status(409).json({ error: 'This family email is linked to a different notification account for this profile.' });
    if (invitation.error) return res.status(404).json({ error: 'The family invitation could not be found.' });
    return res.status(200).json({ success: true, access: invitation });
  } catch (error) {
    console.error('[Notifications] Family invitation acceptance failed:', error.code || 'unknown');
    return res.status(503).json({ error: 'Could not accept this family invitation. Please retry.' });
  }
}

async function listFamilyAccess(req, res) {
  const identity = await requireVerifiedPrincipal(req, res);
  if (!identity) return;
  const patientId = String(req.params.patientId || '').trim();
  if (!identity.access.some(item => item.patientId === patientId && item.role === 'patient')) {
    return res.status(403).json({ error: 'Only the authenticated patient account can manage family access.' });
  }
  try {
    const db = getDb();
    const [accessSnapshot, invitationSnapshot] = await Promise.all([
      db.collection(ACCESS_COLLECTION).where('patientId', '==', patientId).where('role', '==', 'family').get(),
      db.collection(INVITATION_COLLECTION).where('patientId', '==', patientId).get(),
    ]);
    const members = accessSnapshot.docs
      .filter(doc => ['active', 'revoked'].includes(doc.get('status')))
      .map(doc => ({ email: doc.get('email'), name: doc.get('displayName') || '', status: doc.get('status') === 'active' ? 'accepted' : 'revoked' }));
    const invitations = invitationSnapshot.docs
      .filter(doc => ['pending', 'accepted', 'revoked', 'expired'].includes(doc.get('status')))
      .map(doc => {
        const expiresAt = doc.get('expiresAt');
        const expired = doc.get('status') === 'pending' && Date.parse(expiresAt) <= Date.now();
        return {
          email: doc.get('email'),
          name: doc.get('displayName') || '',
          status: expired ? 'expired' : doc.get('status'),
          expiresAt,
        };
      });
    const byEmail = new Map(members.map(member => [member.email, member]));
    for (const invitation of invitations) {
      const current = byEmail.get(invitation.email);
      if (!current || ['pending', 'accepted', 'expired'].includes(invitation.status)) byEmail.set(invitation.email, invitation);
    }
    const membersList = [...byEmail.values()].filter(member => ['pending', 'accepted', 'expired'].includes(member.status));
    return res.status(200).json({ success: true, members: membersList });
  } catch (error) {
    console.error('[Notifications] Family access lookup failed:', error.code || 'unknown');
    return res.status(503).json({ error: 'Could not load family access. Please retry.' });
  }
}

async function revokeFamilyAccess(req, res) {
  const identity = await requireVerifiedPrincipal(req, res);
  if (!identity) return;
  const patientId = String(req.params.patientId || '').trim();
  const email = normalizeEmail(req.body?.email);
  if (!identity.access.some(item => item.patientId === patientId && item.role === 'patient')) {
    return res.status(403).json({ error: 'Only the authenticated patient account can manage family access.' });
  }
  if (!email) return res.status(400).json({ error: 'The family email address is required.' });
  try {
    const emailHash = hash(email);
    const ref = getDb().collection(ACCESS_COLLECTION).doc(accessDocumentId(emailHash, patientId, 'family'));
    const db = getDb();
    const [doc, invitations] = await Promise.all([
      ref.get(),
      db.collection(INVITATION_COLLECTION).where('patientId', '==', patientId).where('emailHash', '==', emailHash).get(),
    ]);
    let familyUid;
    if (doc.exists && doc.get('status') !== 'revoked') {
      familyUid = doc.get('authUid');
      await ref.update({ status: 'revoked', revokedAt: new Date().toISOString(), revokedByUid: identity.uid });
    }
    for (const invitation of invitations.docs) {
      if (['pending', 'accepted'].includes(invitation.get('status'))) {
        await invitation.ref.update({ status: 'revoked', revokedAt: new Date().toISOString(), revokedByUid: identity.uid });
      }
    }
    if (familyUid) {
      const registrations = await db.collection(TOKEN_COLLECTION).where('principalUid', '==', familyUid).get();
      for (const registration of registrations.docs) {
        const patientIds = (registration.get('patientIds') || []).filter(id => id !== patientId);
        if (!patientIds.length) await registration.ref.delete();
        else await registration.ref.update({ patientIds, updatedAt: new Date().toISOString() });
      }
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Notifications] Family access revocation failed:', error.code || 'unknown');
    return res.status(503).json({ error: 'Could not revoke family access. Please retry.' });
  }
}

async function getNotificationHistory(req, res) {
  const identity = await requireVerifiedPrincipal(req, res);
  if (!identity) return;
  try {
    const db = getDb();
    const histories = await Promise.all(identity.access.map(async profile => {
      const snapshot = await db.collection('alerts').where('userId', '==', profile.patientId).get();
      return snapshot.docs.map(doc => {
        const data = doc.data();
        const details = {
          SOS: ['Emergency alert', 'An emergency alert was recorded for this Carewise profile.'],
          HEART_RATE_ANOMALY: ['Health alert', 'A health reading needs attention. Open Carewise to review it.'],
          MEDICINE_DUE: ['Medicine reminder', 'A scheduled medicine is due. Open Carewise to review it.'],
          MEDICINE_MISSED: ['Missed medicine alert', 'A scheduled medicine was overdue. Open Carewise to review it.'],
        }[data.type] || ['Carewise alert', 'A Carewise alert was recorded. Open the app to review it.'];
        return {
          id: doc.id,
          patientId: profile.patientId,
          patientName: profile.patientName,
          type: data.type || 'ALERT',
          timestamp: data.timestamp || '',
          title: details[0],
          body: details[1],
        };
      });
    }));
    const events = histories.flat().sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 100);
    return res.status(200).json({ success: true, profiles: identity.access.map(({ patientId, patientName, role }) => ({ patientId, patientName, role })), events });
  } catch (error) {
    console.error('[Notifications] History lookup failed:', error.code || 'unknown');
    return res.status(503).json({ error: 'Could not load notification history. Please retry.' });
  }
}

module.exports = {
  verifyNotificationIdentity,
  registerNotificationToken,
  removeNotificationToken,
  updateNotificationPreferences,
  sendTestNotification,
  inviteFamilyMember,
  acceptFamilyInvitation,
  listFamilyAccess,
  revokeFamilyAccess,
  getNotificationHistory,
};
