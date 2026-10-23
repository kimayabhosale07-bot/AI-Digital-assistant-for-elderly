// Firebase Web settings are public client configuration. Keep private Admin
// credentials exclusively in the backend environment.
globalThis.CAREWISE_FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyDO1Ej3usxJMbE34sU8_3m9VLiY2RokKhs',
  authDomain: 'ai-assistant-elderly.firebaseapp.com',
  projectId: 'ai-assistant-elderly',
  storageBucket: 'ai-assistant-elderly.firebasestorage.app',
  messagingSenderId: '459757652240',
  appId: '1:459757652240:web:684e946f81bf335978bd95',
  measurementId: 'G-QMHC52GLD6',
});

// Public Web Push key from Firebase Console. Never place the private key here.
globalThis.CAREWISE_VAPID_PUBLIC_KEY = 'BPJqV-OtInk3OL_dFqSursheLpDKvk9A-sXDw59z1N1L8mUjuLLVcSYUR8iehsvIsz6Hc6Vjb-qya47JQNx9Olc';
