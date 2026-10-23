import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js';

const config = globalThis.CAREWISE_FIREBASE_CONFIG;
const app = getApps().find(existing => existing.options.projectId === config.projectId)
  || initializeApp(config);
const auth = getAuth(app);
const pendingEmailKey = `carewise_notification_email_${config.projectId}`;
const notificationEnabledKey = 'carewise_notifications_enabled';
const registrationIdKey = 'carewise_notification_registration_id';
const registrationUidKey = 'carewise_notification_registration_uid';
const preferenceKey = uid => `carewise_notification_preferences_${uid}`;
const initialUrl = new URL(window.location.href);
const invitationFromHash = new URLSearchParams(initialUrl.hash.slice(1)).get('invite');
let pendingInvitationToken = initialUrl.searchParams.get('invite') || invitationFromHash || '';
let messagingPromise;
let foregroundListenerReady = false;
let accessInfo = null;

function apiBase() {
  return window.CareMateAPI?.API_BASE_URL || 'http://127.0.0.1:5000/api';
}

async function backendRequest(path, idToken, body, method = 'POST') {
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function logRegistrationError(stage, error) {
  console.error(`[Carewise notifications][TEMP] ${stage} failed`, {
    name: error?.name || null,
    message: error?.message || String(error),
    code: error?.code || null,
    stack: error?.stack || null,
  });
}

async function getFcmTokenWithDiagnostics(messaging, options) {
  try {
    return await getToken(messaging, options);
  } catch (error) {
    logRegistrationError('Firebase Messaging getToken()', error);
    throw error;
  }
}

async function ensurePushSubscriptionWithDiagnostics(registration, applicationServerKey) {
  try {
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) return subscription;
  } catch (error) {
    logRegistrationError('Browser PushManager.getSubscription()', error);
    throw error;
  }

  try {
    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  } catch (error) {
    logRegistrationError('Browser PushManager.subscribe()', error);
    throw error;
  }
}

async function registerTokenWithBackendDiagnostics(token) {
  let idToken;
  try {
    idToken = await getIdToken();
  } catch (error) {
    logRegistrationError('Firebase ID-token retrieval before backend registration', error);
    throw error;
  }

  try {
    return await backendRequest('/notifications/token', idToken, { token, preferences: readNotificationPreferences() });
  } catch (error) {
    logRegistrationError('Backend POST /notifications/token', error);
    throw error;
  }
}

function readNotificationPreferences() {
  const checked = id => document.getElementById(id)?.checked;
  let saved = {};
  if (auth.currentUser) {
    try { saved = JSON.parse(localStorage.getItem(preferenceKey(auth.currentUser.uid)) || '{}'); } catch { /* Ignore an invalid local cache. */ }
  }
  return {
    medicine: checked('notification-pref-medicine') ?? saved.medicine ?? true,
    health: checked('notification-pref-health') ?? saved.health ?? true,
    emergency: checked('notification-pref-emergency') ?? saved.emergency ?? true,
  };
}

function saveLocalNotificationPreferences() {
  if (auth.currentUser) {
    localStorage.setItem(preferenceKey(auth.currentUser.uid), JSON.stringify(readNotificationPreferences()));
  }
}

function restoreLocalNotificationPreferences() {
  if (!auth.currentUser) return;
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey(auth.currentUser.uid)) || 'null');
    if (!saved) return;
    for (const [key, value] of Object.entries({ medicine: 'notification-pref-medicine', health: 'notification-pref-health', emergency: 'notification-pref-emergency' })) {
      const checkbox = document.getElementById(value);
      if (checkbox && typeof saved[key] === 'boolean') checkbox.checked = saved[key];
    }
  } catch { /* Ignore malformed local preference cache; server remains authoritative. */ }
}

function showNotificationPreferences(show) {
  const panel = document.getElementById('notification-preferences');
  if (panel) panel.hidden = !show;
}

function getIdToken() {
  if (!auth.currentUser || !auth.currentUser.emailVerified) {
    throw new Error('Sign in using the verified email link before managing notifications.');
  }
  return auth.currentUser.getIdToken();
}

function status(message, isError = false) {
  const target = document.getElementById('notification-status');
  if (!target) return;
  target.textContent = message;
  target.dataset.state = isError ? 'error' : 'info';
  target.hidden = false;
}

function mapError(error) {
  const messages = {
    'auth/operation-not-allowed': 'Email link sign-in is not enabled for this Firebase project. Enable Email/Password and Email link sign-in in Firebase Authentication.',
    'auth/unauthorized-domain': 'This site is not authorized for Firebase email links. Add this hostname under Firebase Authentication authorized domains.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/expired-action-code': 'This sign-in link expired. Request a new email link.',
    'auth/invalid-action-code': 'This sign-in link is invalid or already used. Request a new email link.',
    'auth/network-request-failed': 'Could not reach Firebase Authentication. Check your connection and try again.',
  };
  return messages[error.code] || error.message || 'Notification setup failed. Please try again.';
}

function setupDashboardNotificationPrompt() {
  const dialog = document.getElementById('notification-first-visit');
  if (!dialog) return;
  const promptChoiceKey = 'carewise_dashboard_notification_prompt_choice';
  const promptChoice = localStorage.getItem(promptChoiceKey);
  const registrationSucceeded = 'Notification' in window
    && Notification.permission === 'granted'
    && localStorage.getItem(notificationEnabledKey) === 'true'
    && Boolean(localStorage.getItem(registrationIdKey));

  if (!promptChoice && !registrationSucceeded) {
    if ('Notification' in window && Notification.permission === 'denied') {
      document.getElementById('notification-first-visit-message').textContent =
        'Browser notifications are blocked in this browser. You can change site permissions, then retry setup from the Notifications page.';
    }
    dialog.showModal();
  }

  document.getElementById('notification-first-visit-dismiss')?.addEventListener('click', () => {
    localStorage.setItem(promptChoiceKey, 'not-now');
    dialog.close();
  });

  document.getElementById('notification-first-visit-enable')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const retryLink = document.getElementById('notification-first-visit-retry');
    if (button.dataset.complete === 'true') {
      dialog.close();
      return;
    }
    button.disabled = true;
    localStorage.setItem(promptChoiceKey, 'enable');
    if (!auth.currentUser?.emailVerified) {
      status('Sign in to your verified notification account first. You can continue on the Notifications page.', true);
      retryLink.hidden = false;
      button.disabled = false;
      return;
    }

    try {
      status('Requesting browser notification permission…');
      const permissionGranted = await requestBrowserNotificationPermission();
      if (!accessInfo) await refreshAccess();
      await registerCurrentBrowser(permissionGranted);
      status('Notifications are enabled for this browser.');
      retryLink.hidden = true;
      button.textContent = 'Done';
      button.dataset.complete = 'true';
    } catch (error) {
      status(mapError(error), true);
      retryLink.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

function actionCodeSettings(returnPath = window.location.pathname, invitationToken = '') {
  const continueUrl = new URL(returnPath, window.location.origin);
  if (invitationToken) continueUrl.hash = `invite=${encodeURIComponent(invitationToken)}`;
  return {
    url: continueUrl.toString(),
    handleCodeInApp: true,
  };
}

function cleanEmailLinkUrl(preserveInvitation = false) {
  const fragment = preserveInvitation && pendingInvitationToken
    ? `#invite=${encodeURIComponent(pendingInvitationToken)}`
    : '';
  window.history.replaceState({}, document.title, `${window.location.pathname}${fragment}`);
}

async function getMessagingInstance() {
  if (!(await isSupported())) throw new Error('This browser does not support web push notifications.');
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    throw new Error('Web push requires HTTPS. For local development, use http://localhost:3000.');
  }
  messagingPromise ||= Promise.resolve(getMessaging(app));
  return messagingPromise;
}

function patientAccess() {
  return (accessInfo?.access || []).filter(item => item.role === 'patient');
}

function renderAccessControls() {
  const activeUser = auth.currentUser && auth.currentUser.emailVerified;
  const email = document.getElementById('notification-email');
  const emailLabel = document.getElementById('notification-email-label');
  const enable = document.getElementById('notification-enable');
  if (!email || !emailLabel || !enable) return;
  const signOutButton = document.getElementById('notification-auth-signout');
  const familyPanel = document.getElementById('notification-family-access');
  const patientSelect = document.getElementById('notification-patient-select');
  const patients = patientAccess();
  const completingEmailLink = isSignInWithEmailLink(auth, window.location.href);

  if (activeUser && !completingEmailLink) {
    email.value = auth.currentUser.email || '';
    email.hidden = true;
    emailLabel.hidden = true;
    enable.textContent = accessInfo ? 'Enable Notifications' : 'Check notification access';
    enable.disabled = false;
    signOutButton.hidden = false;
  } else {
    email.hidden = false;
    emailLabel.hidden = false;
    enable.textContent = completingEmailLink
      ? 'Complete email sign-in'
      : 'Email me a sign-in link';
    enable.disabled = false;
    signOutButton.hidden = true;
  }

  if (familyPanel) familyPanel.hidden = !activeUser || patients.length === 0;
  const acceptInvitation = document.getElementById('notification-accept-invitation');
  if (acceptInvitation) acceptInvitation.hidden = !activeUser || !pendingInvitationToken;
  if (patientSelect && patients.length) {
    const previous = patientSelect.value;
    patientSelect.replaceChildren(...patients.map(patient => {
      const option = document.createElement('option');
      option.value = patient.patientId;
      option.textContent = patient.patientName || 'Patient profile';
      return option;
    }));
    if (patients.some(patient => patient.patientId === previous)) patientSelect.value = previous;
  }
}

async function refreshAccess() {
  const result = await backendRequest('/notifications/access', await getIdToken(), {});
  accessInfo = result;
  renderAccessControls();
  renderAuthorizedProfiles();
  try { await renderFamilyAccessLists(); } catch { /* notification access does not depend on family-list rendering */ }
  try { await renderNotificationHistory(); } catch { /* history does not block notification controls */ }
  return result;
}

function renderAuthorizedProfiles() {
  const container = document.getElementById('notification-authorized-profiles');
  if (!container) return;
  container.replaceChildren();
  for (const profile of accessInfo?.access || []) {
    const item = document.createElement('li');
    item.textContent = `${profile.patientName || 'Carewise patient'} (${profile.role})`;
    container.append(item);
  }
}

async function renderNotificationHistory() {
  const container = document.getElementById('notification-history');
  if (!container || !accessInfo) return;
  const result = await backendRequest('/notifications/history', await getIdToken(), undefined, 'GET');
  container.replaceChildren();
  if (!result.events?.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No alerts have been recorded for your authorized profiles yet.';
    container.append(empty);
    return;
  }
  for (const event of result.events) {
    const row = document.createElement('article');
    row.style.cssText = 'padding:.7rem 0;border-top:1px solid var(--border-light);';
    const title = document.createElement('strong');
    title.textContent = `${event.title} · ${event.patientName}`;
    const body = document.createElement('p');
    body.textContent = event.body;
    const time = document.createElement('time');
    time.dateTime = event.timestamp;
    const date = new Date(event.timestamp);
    time.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
    row.append(title, body, time);
    container.append(row);
  }
}

async function renderFamilyAccessLists() {
  const container = document.getElementById('notification-family-list');
  const patients = patientAccess();
  if (!container || !patients.length) return;
  container.replaceChildren();
  let rowCount = 0;

  for (const patient of patients) {
    const result = await backendRequest(
      `/notifications/family-access/${encodeURIComponent(patient.patientId)}`,
      await getIdToken(),
      undefined,
      'GET',
    );
    for (const member of result.members || []) {
      rowCount += 1;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.45rem 0;border-top:1px solid var(--border-light);font-size:.84rem;';
      const label = document.createElement('span');
      label.textContent = [member.name, member.email, member.status].filter(Boolean).join(' · ');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-secondary';
      remove.textContent = 'Remove access';
      remove.dataset.patientId = patient.patientId;
      remove.dataset.email = member.email;
      row.append(label, remove);
      container.append(row);
    }
  }
  if (!rowCount) container.textContent = 'No family invitations yet.';
}

async function signInFromEmailLink(email) {
  const credential = await signInWithEmailLink(auth, email, window.location.href);
  localStorage.removeItem(pendingEmailKey);
  cleanEmailLinkUrl(Boolean(pendingInvitationToken));
  accessInfo = null;
  renderAccessControls();
  if (!pendingInvitationToken) await refreshAccess();
  return credential;
}

async function sendEmailLink(email, returnPath = window.location.pathname, invitationToken = '') {
  await sendSignInLinkToEmail(auth, email, actionCodeSettings(returnPath, invitationToken));
  localStorage.setItem(pendingEmailKey, email);
  status('Sign-in link sent. Open it in this browser, then enable notifications. No SMS code is used.');
}

function setupForegroundHandler(messaging) {
  if (foregroundListenerReady) return;
  foregroundListenerReady = true;
  onMessage(messaging, payload => {
    const title = payload.data?.title || payload.notification?.title || 'Carewise notification';
    const body = payload.data?.body || payload.notification?.body || '';
    status(`${title}${body ? ` — ${body}` : ''}`);
  });
}

async function requestBrowserNotificationPermission() {
  if (!('Notification' in window)) throw new Error('This browser does not support web notifications.');
  if (!window.isSecureContext) throw new Error('Web push requires HTTPS. For local development, use http://localhost:3000.');
  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Browser notifications are blocked. Allow them in site settings, then try again.'
      : 'Notification permission was not granted. Choose Allow to enable push notifications.');
  }
  return permission;
}

async function registerCurrentBrowser(permissionGranted = false) {
  if (!accessInfo) throw new Error('This verified email has no authorized Carewise profile or family invitation.');
  if (!permissionGranted) await requestBrowserNotificationPermission();

  const vapidKey = globalThis.CAREWISE_VAPID_PUBLIC_KEY || '';
  let vapidBytes;
  try {
    const padded = vapidKey.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(vapidKey.length / 4) * 4, '=');
    vapidBytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  } catch {
    vapidBytes = new Uint8Array();
  }
  if (vapidBytes.length !== 65 || vapidBytes[0] !== 4) {
    throw new Error('The Firebase Web Push public key is missing or invalid.');
  }

  const messaging = await getMessagingInstance();
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const readyRegistration = await navigator.serviceWorker.ready;
  await ensurePushSubscriptionWithDiagnostics(readyRegistration, vapidBytes);
  const token = await getFcmTokenWithDiagnostics(messaging, { vapidKey, serviceWorkerRegistration: readyRegistration });
  if (!token) throw new Error('Firebase did not return a browser registration token. Check the Web Push setup and try again.');
  const result = await registerTokenWithBackendDiagnostics(token);
  localStorage.setItem(notificationEnabledKey, 'true');
  localStorage.setItem(registrationIdKey, result.registrationId);
  localStorage.setItem(registrationUidKey, auth.currentUser.uid);
  saveLocalNotificationPreferences();
  const testButton = document.getElementById('notification-test');
  const disableButton = document.getElementById('notification-disable');
  if (testButton) testButton.hidden = false;
  if (disableButton) disableButton.hidden = false;
  showNotificationPreferences(true);
  setupForegroundHandler(messaging);
  status(result.message || 'Notifications are enabled for this browser.');
}

async function restoreRegistration() {
  if (localStorage.getItem(notificationEnabledKey) !== 'true' || !auth.currentUser || !accessInfo) return;
  if (localStorage.getItem(registrationUidKey) !== auth.currentUser.uid) return;
  const testButton = document.getElementById('notification-test');
  const disableButton = document.getElementById('notification-disable');
  if (testButton) testButton.hidden = false;
  if (disableButton) disableButton.hidden = false;
  showNotificationPreferences(true);
  if (!('Notification' in window)) {
    status('This browser does not support web notifications.', true);
    return;
  }
  if (Notification.permission !== 'granted') {
    status('Notifications are blocked in this browser. Allow them in site settings to receive pushes.', true);
    return;
  }
  try {
    const messaging = await getMessagingInstance();
    await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const readyRegistration = await navigator.serviceWorker.ready;
    const vapidKey = globalThis.CAREWISE_VAPID_PUBLIC_KEY || '';
    const padded = vapidKey.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(vapidKey.length / 4) * 4, '=');
    const applicationServerKey = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
    await ensurePushSubscriptionWithDiagnostics(readyRegistration, applicationServerKey);
    const token = await getFcmTokenWithDiagnostics(messaging, {
      vapidKey,
      serviceWorkerRegistration: readyRegistration,
    });
    if (token) {
      const result = await registerTokenWithBackendDiagnostics(token);
      localStorage.setItem(registrationIdKey, result.registrationId);
    }
    setupForegroundHandler(messaging);
    status('Notifications are enabled for this browser.');
  } catch (error) {
    status(mapError(error), true);
  }
}

async function initializeNotifications() {
  await auth.authStateReady();
  if (document.getElementById('notification-first-visit')) {
    setupDashboardNotificationPrompt();
    return;
  }
  restoreLocalNotificationPreferences();
  const emailLink = isSignInWithEmailLink(auth, window.location.href);
  if (emailLink) {
    const savedEmail = localStorage.getItem(pendingEmailKey);
    if (savedEmail) {
      try {
        await signInFromEmailLink(savedEmail);
        status(pendingInvitationToken
          ? 'Email verified. Accept the family invitation to continue.'
          : 'Email verified. Click Enable Notifications to allow browser pushes.');
      } catch (error) {
        status(mapError(error), true);
      }
    } else {
      status('Enter the email address that received this link, then complete sign-in.');
    }
  } else if (auth.currentUser?.emailVerified) {
    try {
      await refreshAccess();
    } catch (error) {
      accessInfo = null;
      status(mapError(error), true);
    }
  }
  renderAccessControls();
  await restoreRegistration();
}

document.getElementById('notification-enable')?.addEventListener('click', async () => {
  const button = document.getElementById('notification-enable');
  button.disabled = true;
  try {
    const email = document.getElementById('notification-email').value.trim();
    if (isSignInWithEmailLink(auth, window.location.href)) {
      if (!email) throw new Error('Enter the email address that received this sign-in link.');
      await signInFromEmailLink(email);
      status(pendingInvitationToken
        ? 'Email verified. Accept the family invitation to continue.'
        : 'Email verified. Click Enable Notifications to allow browser pushes.');
      return;
    }
    if (!auth.currentUser?.emailVerified) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
      await sendEmailLink(email);
      return;
    }
    if (!accessInfo) {
      await refreshAccess();
      status('Notification access confirmed. Click Enable Notifications to allow browser pushes.');
      return;
    }
    status('Requesting browser notification permission…');
    await registerCurrentBrowser();
  } catch (error) {
    console.error('[Carewise notifications]', error.code || error.name || 'error');
    status(mapError(error), true);
  } finally {
    button.disabled = false;
    renderAccessControls();
  }
});

document.getElementById('notification-accept-invitation')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await backendRequest('/notifications/family-access/accept', await getIdToken(), {
      invitationToken: pendingInvitationToken,
    });
    pendingInvitationToken = '';
    cleanEmailLinkUrl();
    await refreshAccess();
    status(`Invitation accepted for ${result.access.patientName}. Click Enable Notifications when you are ready to allow browser pushes.`);
  } catch (error) {
    status(mapError(error), true);
  } finally {
    button.disabled = false;
    renderAccessControls();
  }
});

document.getElementById('notification-auth-signout')?.addEventListener('click', async () => {
  try {
    const registrationId = localStorage.getItem(registrationIdKey);
    if (registrationId && auth.currentUser) {
      await backendRequest('/notifications/token', await getIdToken(), { registrationId }, 'DELETE');
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      try { await deleteToken(await getMessagingInstance()); } catch { /* account sign-out still proceeds */ }
    }
    await signOut(auth);
    accessInfo = null;
    localStorage.removeItem(registrationIdKey);
    localStorage.removeItem(registrationUidKey);
    localStorage.removeItem(notificationEnabledKey);
    document.getElementById('notification-test').hidden = true;
    document.getElementById('notification-disable').hidden = true;
    showNotificationPreferences(false);
    document.getElementById('notification-family-list')?.replaceChildren();
    status('Signed out of the notification account. Your Carewise sign-in is unchanged.');
  } catch (error) {
    status(mapError(error), true);
  } finally {
    renderAccessControls();
  }
});

document.getElementById('notification-disable')?.addEventListener('click', async () => {
  const button = document.getElementById('notification-disable');
  button.disabled = true;
  try {
    const registrationId = localStorage.getItem(registrationIdKey);
    if (!registrationId) throw new Error('Sign in again to remove this browser registration securely.');
    await backendRequest('/notifications/token', await getIdToken(), { registrationId }, 'DELETE');
    if ('Notification' in window && Notification.permission === 'granted') {
      try { await deleteToken(await getMessagingInstance()); } catch { /* token can already be absent */ }
    }
    localStorage.removeItem(registrationIdKey);
    localStorage.removeItem(registrationUidKey);
    localStorage.removeItem(notificationEnabledKey);
    document.getElementById('notification-test').hidden = true;
    showNotificationPreferences(false);
    button.hidden = true;
    status('This browser was removed from web push notifications.');
  } catch (error) {
    status(mapError(error), true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('notification-preferences-save')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const registrationId = localStorage.getItem(registrationIdKey);
    if (!registrationId) throw new Error('Enable notifications on this browser before saving preferences.');
    await backendRequest('/notifications/preferences', await getIdToken(), {
      registrationId,
      preferences: readNotificationPreferences(),
    }, 'PUT');
    saveLocalNotificationPreferences();
    status('Notification preferences saved for this browser.');
  } catch (error) {
    status(mapError(error), true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('notification-test')?.addEventListener('click', async () => {
  const button = document.getElementById('notification-test');
  button.disabled = true;
  try {
    await backendRequest('/notifications/test', await getIdToken(), { confirmed: true });
    status('Test push sent. Keep this page open to see it here, or check the device notification in the background.');
  } catch (error) {
    status(mapError(error), true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('notification-family-invite')?.addEventListener('click', async () => {
  const button = document.getElementById('notification-family-invite');
  button.disabled = true;
  try {
    const name = document.getElementById('notification-family-name').value.trim();
    const email = document.getElementById('notification-family-email').value.trim();
    const patientId = document.getElementById('notification-patient-select').value;
    if (!name) throw new Error('Enter the family member name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid family member email address.');
    const invitation = await backendRequest('/notifications/family-access', await getIdToken(), { patientId, name, email });
    await sendEmailLink(email, '/pages/notifications.html', invitation.invitationToken);
    status(`Invitation sent to ${email}. It expires in seven days; they must verify their email and accept it.`);
    await renderFamilyAccessLists();
  } catch (error) {
    status(mapError(error), true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('notification-family-list')?.addEventListener('click', async event => {
  const button = event.target.closest('button[data-patient-id]');
  if (!button) return;
  button.disabled = true;
  try {
    await backendRequest(`/notifications/family-access/${encodeURIComponent(button.dataset.patientId)}`,
      await getIdToken(), { email: button.dataset.email }, 'DELETE');
    await renderFamilyAccessLists();
    status('Family notification access was removed.');
  } catch (error) {
    status(mapError(error), true);
  }
});

initializeNotifications().catch(error => status(mapError(error), true));
