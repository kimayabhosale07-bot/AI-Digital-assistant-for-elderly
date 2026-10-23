const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');

class FakeSnapshot {
  constructor(ref, data) {
    this.ref = ref;
    this.id = ref.id;
    this._data = data ? structuredClone(data) : undefined;
    this.exists = data !== undefined;
  }
  data() { return this._data ? structuredClone(this._data) : undefined; }
  get(path) { return path.split('.').reduce((value, key) => value?.[key], this._data); }
}

class FakeReference {
  constructor(db, collection, id) { this.db = db; this.collectionName = collection; this.id = id; }
  get key() { return `${this.collectionName}/${this.id}`; }
  async get() { return new FakeSnapshot(this, this.db.documents.get(this.key)); }
  async create(data) {
    if (this.db.documents.has(this.key)) throw new Error('already exists');
    this.db.documents.set(this.key, structuredClone(data));
  }
  async set(data, options = {}) {
    const previous = options.merge ? this.db.documents.get(this.key) || {} : {};
    this.db.documents.set(this.key, { ...structuredClone(previous), ...structuredClone(data) });
  }
  async update(data) {
    const previous = this.db.documents.get(this.key);
    if (!previous) throw new Error('not found');
    this.db.documents.set(this.key, { ...previous, ...structuredClone(data) });
  }
  async delete() { this.db.documents.delete(this.key); }
}

class FakeQuery {
  constructor(db, collection, filters = []) { this.db = db; this.collectionName = collection; this.filters = filters; }
  where(field, operator, value) { return new FakeQuery(this.db, this.collectionName, [...this.filters, [field, operator, value]]); }
  async get() {
    const docs = [...this.db.documents.entries()]
      .filter(([key]) => key.startsWith(`${this.collectionName}/`))
      .map(([key, data]) => new FakeSnapshot(new FakeReference(this.db, this.collectionName, key.slice(this.collectionName.length + 1)), data))
      .filter(snapshot => this.filters.every(([field, operator, expected]) => {
        const actual = snapshot.get(field);
        if (operator === '==') return actual === expected;
        if (operator === 'array-contains') return Array.isArray(actual) && actual.includes(expected);
        return false;
      }));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

class FakeDb {
  constructor() { this.documents = new Map(); }
  collection(name) {
    const db = this;
    return {
      doc(id) { return new FakeReference(db, name, id); },
      where(field, operator, value) { return new FakeQuery(db, name).where(field, operator, value); },
    };
  }
  async runTransaction(callback) {
    return callback({
      get: ref => ref.get(),
      set: (ref, data, options) => ref.set(data, options),
      update: (ref, data) => ref.update(data),
    });
  }
}

let db = new FakeDb();
let claimsByToken = new Map();
let testPushCount = 0;
let testPushError = null;
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '../config/firebase' && parent?.filename.endsWith('notificationController.js')) {
    return {
      getDb: () => db,
      getAuth: () => ({ verifyIdToken: async token => {
        const claims = claimsByToken.get(token);
        if (!claims) throw Object.assign(new Error('invalid token'), { code: 'auth/invalid-id-token' });
        return claims;
      } }),
    };
  }
  if (request === '../services/pushNotifications' && parent?.filename.endsWith('notificationController.js')) {
    return { sendToPrincipal: async () => {
      testPushCount += 1;
      if (testPushError) throw testPushError;
      return { sent: 1, removed: 0, failed: 0 };
    } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const controller = require('../src/controllers/notificationController');
Module._load = originalLoad;

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const emailHash = email => hash(email.toLowerCase());
const accessId = (email, patientId, role) => hash(`${emailHash(email)}:${patientId}:${role}`);
const addDoc = (collection, id, data) => db.documents.set(`${collection}/${id}`, structuredClone(data));

function setUp() {
  db = new FakeDb();
  claimsByToken = new Map([
    ['patient-token', { uid: 'patient-uid', email: 'patient@example.test', email_verified: true }],
    ['family-token', { uid: 'family-uid', email: 'family@example.test', email_verified: true }],
    ['other-family-token', { uid: 'other-family-uid', email: 'other@example.test', email_verified: true }],
    ['unverified-token', { uid: 'unverified-uid', email: 'unverified@example.test', email_verified: false }],
  ]);
  testPushCount = 0;
  testPushError = null;
  addDoc('users', 'patient-1', { name: 'Patient One' });
  addDoc('users', 'patient-2', { name: 'Patient Two' });
  addDoc('notificationAccess', accessId('patient@example.test', 'patient-1', 'patient'), {
    email: 'patient@example.test', emailHash: emailHash('patient@example.test'), patientId: 'patient-1',
    role: 'patient', status: 'active', authUid: 'patient-uid',
  });
}

function request(token, body = {}, params = {}) {
  return { get: name => name.toLowerCase() === 'authorization' ? `Bearer ${token}` : '', body, params };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function createInvitation() {
  const res = response();
  await controller.inviteFamilyMember(request('patient-token', {
    patientId: 'patient-1', name: 'Family Member', email: 'family@example.test',
  }), res);
  assert.equal(res.statusCode, 201);
  return res.body.invitationToken;
}

test('family invite requires patient grant and stores only a hashed one-time token', async () => {
  setUp();
  const denied = response();
  await controller.inviteFamilyMember(request('other-family-token', {
    patientId: 'patient-1', name: 'Family', email: 'family@example.test',
  }), denied);
  assert.equal(denied.statusCode, 403);

  const token = await createInvitation();
  assert.match(token, /^[a-f0-9]{64}$/);
  const invitationData = [...db.documents.entries()].find(([key]) => key.startsWith('notificationInvitations/'))[1];
  assert.equal(invitationData.status, 'pending');
  assert.equal(invitationData.emailHash, emailHash('family@example.test'));
  assert.ok(Date.parse(invitationData.expiresAt) > Date.now());
  assert.equal(JSON.stringify(invitationData).includes(token), false);
  assert.equal(db.documents.has(`notificationAccess/${accessId('family@example.test', 'patient-1', 'family')}`), false);
});

test('resending an invite revokes the previous pending invitation', async () => {
  setUp();
  await createInvitation();
  await createInvitation();
  const pending = [...db.documents.entries()]
    .filter(([key]) => key.startsWith('notificationInvitations/'))
    .map(([, data]) => data)
    .filter(data => data.status === 'pending');
  assert.equal(pending.length, 1);
  assert.equal([...db.documents.values()].filter(data => data.status === 'revoked').length, 1);
});

test('family acceptance requires verified invited email and rejects replay', async () => {
  setUp();
  const token = await createInvitation();
  const wrongEmail = response();
  await controller.acceptFamilyInvitation(request('other-family-token', { invitationToken: token }), wrongEmail);
  assert.equal(wrongEmail.statusCode, 403);

  const unverified = response();
  await controller.acceptFamilyInvitation(request('unverified-token', { invitationToken: token }), unverified);
  assert.equal(unverified.statusCode, 403);

  const accepted = response();
  await controller.acceptFamilyInvitation(request('family-token', { invitationToken: token }), accepted);
  assert.equal(accepted.statusCode, 200);
  assert.equal(db.documents.get(`notificationAccess/${accessId('family@example.test', 'patient-1', 'family')}`).authUid, 'family-uid');

  const replay = response();
  await controller.acceptFamilyInvitation(request('family-token', { invitationToken: token }), replay);
  assert.equal(replay.statusCode, 410);
});

test('expired family invitations cannot be accepted', async () => {
  setUp();
  const token = 'a'.repeat(64);
  addDoc('notificationInvitations', hash(token), {
    emailHash: emailHash('family@example.test'), patientId: 'patient-1', role: 'family',
    status: 'pending', expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  const res = response();
  await controller.acceptFamilyInvitation(request('family-token', { invitationToken: token }), res);
  assert.equal(res.statusCode, 410);
  assert.equal(db.documents.get(`notificationInvitations/${hash(token)}`).status, 'expired');
});

test('token registration and test push require authorized identity and explicit confirmation', async () => {
  setUp();
  const invitationToken = await createInvitation();
  const accepted = response();
  await controller.acceptFamilyInvitation(request('family-token', { invitationToken }), accepted);
  const registered = response();
  await controller.registerNotificationToken(request('family-token', { token: 'test-fcm-token' }), registered);
  assert.equal(registered.statusCode, 200);
  const tokenDoc = db.documents.get(`notificationTokens/${hash('test-fcm-token')}`);
  assert.equal(tokenDoc.principalUid, 'family-uid');
  assert.deepEqual(tokenDoc.patientIds, ['patient-1']);
  assert.equal(tokenDoc.preferences.medicine, true);

  const noConfirmation = response();
  await controller.sendTestNotification(request('family-token', {}), noConfirmation);
  assert.equal(noConfirmation.statusCode, 400);
  assert.equal(testPushCount, 0);
  const confirmed = response();
  await controller.sendTestNotification(request('family-token', { confirmed: true }), confirmed);
  assert.equal(confirmed.statusCode, 200);
  assert.equal(testPushCount, 1);
});

test('family access revocation removes profile access and browser token association', async () => {
  setUp();
  const invitationToken = await createInvitation();
  const accepted = response();
  await controller.acceptFamilyInvitation(request('family-token', { invitationToken }), accepted);
  const registered = response();
  await controller.registerNotificationToken(request('family-token', { token: 'test-fcm-token' }), registered);

  const revoked = response();
  await controller.revokeFamilyAccess(request('patient-token', { email: 'family@example.test' }, { patientId: 'patient-1' }), revoked);
  assert.equal(revoked.statusCode, 200);
  assert.equal(db.documents.has(`notificationTokens/${hash('test-fcm-token')}`), false);
  const access = response();
  await controller.verifyNotificationIdentity(request('family-token'), access);
  assert.equal(access.statusCode, 403);
});

test('token removal is scoped to the verified principal', async () => {
  setUp();
  const invitationToken = await createInvitation();
  const accepted = response();
  await controller.acceptFamilyInvitation(request('family-token', { invitationToken }), accepted);
  const familyRegistration = response();
  await controller.registerNotificationToken(request('family-token', { token: 'family-device-token' }), familyRegistration);
  const patientRegistration = response();
  await controller.registerNotificationToken(request('patient-token', { token: 'patient-device-token' }), patientRegistration);

  const deniedRemoval = response();
  await controller.removeNotificationToken(request('family-token', { registrationId: patientRegistration.body.registrationId }), deniedRemoval);
  assert.equal(deniedRemoval.statusCode, 200);
  assert.ok(db.documents.has(`notificationTokens/${patientRegistration.body.registrationId}`));

  const ownRemoval = response();
  await controller.removeNotificationToken(request('family-token', { registrationId: familyRegistration.body.registrationId }), ownRemoval);
  assert.equal(ownRemoval.statusCode, 200);
  assert.equal(db.documents.has(`notificationTokens/${familyRegistration.body.registrationId}`), false);
});

test('test-push delivery failure is reported so the user can retry', async () => {
  setUp();
  testPushError = Object.assign(new Error('temporary delivery failure'), { code: 'messaging/server-unavailable' });
  const res = response();
  await controller.sendTestNotification(request('patient-token', { confirmed: true }), res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /unavailable|retry/i);
});

test('notification history is limited to profiles in the verified access grant', async () => {
  setUp();
  addDoc('alerts', 'alert-p1', { userId: 'patient-1', type: 'SOS', timestamp: '2026-01-01T00:00:00.000Z' });
  addDoc('alerts', 'alert-p2', { userId: 'patient-2', type: 'SOS', timestamp: '2026-01-02T00:00:00.000Z' });
  const res = response();
  await controller.getNotificationHistory(request('patient-token'), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.events.map(event => event.id), ['alert-p1']);
});
