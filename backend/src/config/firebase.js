const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getMessaging } = require('firebase-admin/messaging');
require('dotenv').config({ quiet: true });

// grpc-js does not honor the usual uppercase NO_PROXY variable. Allow a
// backend-specific host list so Firestore can bypass a broken local proxy
// without changing proxy behavior for other Google APIs or application traffic.
const firestoreNoProxyHosts = (process.env.FIRESTORE_NO_PROXY_HOSTS || '')
  .split(',').map(host => host.trim()).filter(Boolean);
if (firestoreNoProxyHosts.length) {
  const existingNoProxyHosts = (process.env.no_grpc_proxy || process.env.no_proxy || '')
    .split(',').map(host => host.trim()).filter(Boolean);
  process.env.no_grpc_proxy = [...new Set([...existingNoProxyHosts, ...firestoreNoProxyHosts])].join(',');
}
// Service-account tokens are fetched over HTTPS by google-auth-library, which
// uses NO_PROXY rather than grpc-js's no_grpc_proxy variable.
const googleApiNoProxyHosts = (process.env.GOOGLE_API_NO_PROXY_HOSTS || '')
  .split(',').map(host => host.trim()).filter(Boolean);
if (googleApiNoProxyHosts.length) {
  for (const variable of ['NO_PROXY', 'no_proxy']) {
    const existing = (process.env[variable] || '').split(',').map(host => host.trim()).filter(Boolean);
    process.env[variable] = [...new Set([...existing, ...googleApiNoProxyHosts])].join(',');
  }
}

let db;

try {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    // Handle escaped newlines in environment variables
    privateKey = privateKey.replace(/\\n/g, '\n');

    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });

    console.log('🔥 Firebase Admin SDK initialized successfully.');
    db = getFirestore();
    // Bound retries so unavailable Firestore returns an error to API callers
    // instead of keeping requests open for the SDK's default 10-minute window.
    db.settings({
      clientConfig: {
        interfaces: {
          'google.firestore.v1.Firestore': {
            retry_params: {
              default: {
                initial_retry_delay_millis: 200,
                retry_delay_multiplier: 1.5,
                max_retry_delay_millis: 1000,
                initial_rpc_timeout_millis: 3000,
                rpc_timeout_multiplier: 1,
                max_rpc_timeout_millis: 3000,
                total_timeout_millis: 5000,
              },
            },
          },
        },
      },
    });
  } else {
    console.warn('⚠️ WARNING: Firebase environment variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) are missing or incomplete.');
    console.warn('Attempts to interact with Firestore will fail. Please configure your .env file.');
  }
} catch (error) {
  console.error('❌ Firebase Admin SDK initialization failed:', error.message);
  console.warn('Firestore client is disabled. Please verify credentials in your .env file.');
}

module.exports = {
  db,
  getAuth: () => {
    if (!db) throw new Error('Firebase Admin is not initialized. Check backend configuration.');
    return getAuth();
  },
  getMessaging: () => {
    if (!db) throw new Error('Firebase Admin is not initialized. Check backend configuration.');
    return getMessaging();
  },
  getDb: () => {
    if (!db) {
      throw new Error('Firestore Database is not initialized. Please check your .env configuration.');
    }
    return db;
  }
};
