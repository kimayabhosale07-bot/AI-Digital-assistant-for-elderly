import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const config = globalThis.CAREWISE_FIREBASE_CONFIG;
const app = getApps().find(existing => existing.options.projectId === config.projectId)
  || initializeApp(config);
const auth = getAuth(app);

export async function getNotificationIdToken() {
  await auth.authStateReady();
  if (!auth.currentUser?.emailVerified) return null;
  return auth.currentUser.getIdToken();
}
