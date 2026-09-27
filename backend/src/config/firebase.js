const admin = require('firebase-admin');
require('dotenv').config();

let db;

try {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    // Handle escaped newlines in environmental variables
    privateKey = privateKey.replace(/\\n/g, '\n');

    let credential;
    if (admin.credential && typeof admin.credential.cert === 'function') {
      credential = admin.credential.cert({ projectId, clientEmail, privateKey });
    } else if (typeof admin.cert === 'function') {
      credential = admin.cert({ projectId, clientEmail, privateKey });
    } else {
      throw new Error('Firebase Admin SDK: No credential.cert helper found.');
    }

    admin.initializeApp({
      credential,
    });
    console.log('🔥 Firebase Admin SDK initialized successfully.');
    db = admin.firestore();
  } else {
    console.warn('⚠️ WARNING: Firebase environment variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) are missing or incomplete.');
    console.warn('Attempts to interact with Firestore will fail. Please configure your .env file.');
  }
} catch (error) {
  console.error('❌ Firebase Admin SDK initialization failed:', error.message);
  console.warn('Firestore client is disabled. Please verify credentials in your .env file.');
}

module.exports = {
  admin,
  db,
  getDb: () => {
    if (!db) {
      throw new Error('Firestore Database is not initialized. Please check your .env configuration.');
    }
    return db;
  }
};
