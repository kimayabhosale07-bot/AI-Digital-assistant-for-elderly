const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Optional one-off diagnostic for proxy troubleshooting. Apply before the
// Firebase module constructs the Firestore transport.
if (process.argv.includes('--direct')) {
  process.env.FIRESTORE_NO_PROXY_HOSTS = [
    process.env.FIRESTORE_NO_PROXY_HOSTS,
    'firestore.googleapis.com',
  ].filter(Boolean).join(',');
  process.env.GOOGLE_API_NO_PROXY_HOSTS = [
    process.env.GOOGLE_API_NO_PROXY_HOSTS,
    'googleapis.com',
  ].filter(Boolean).join(',');
}

require('dotenv').config({ quiet: true });

const config = {
  projectIdPresent: Boolean(process.env.FIREBASE_PROJECT_ID),
  clientEmailPresent: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
  privateKeyPresent: Boolean(process.env.FIREBASE_PRIVATE_KEY),
  privateKeyParseable: false,
  projectMatchesExample: false,
  serviceAccountDomainMatchesProject: false,
};

if (process.env.FIREBASE_PRIVATE_KEY) {
  try {
    crypto.createPrivateKey(process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'));
    config.privateKeyParseable = true;
  } catch (_) {}
}

try {
  const example = fs.readFileSync(path.resolve(__dirname, '../../.env.example'), 'utf8');
  const exampleProject = example.match(/^FIREBASE_PROJECT_ID=["']?([^"'\r\n]+)["']?$/m)?.[1];
  config.projectMatchesExample = Boolean(exampleProject && process.env.FIREBASE_PROJECT_ID === exampleProject);
  const emailDomain = process.env.FIREBASE_CLIENT_EMAIL?.split('@')[1]?.toLowerCase();
  config.serviceAccountDomainMatchesProject = Boolean(
    emailDomain && process.env.FIREBASE_PROJECT_ID && emailDomain === `${process.env.FIREBASE_PROJECT_ID}.iam.gserviceaccount.com`
  );
} catch (_) {}

const redact = value => {
  let message = String(value || 'No error message supplied');
  for (const secret of [process.env.FIREBASE_PRIVATE_KEY, process.env.FIREBASE_CLIENT_EMAIL]) {
    if (secret) {
      message = message.split(secret).join('[redacted]');
      message = message.split(secret.replace(/\n/g, '\\n')).join('[redacted]');
    }
  }
  return message
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[redacted credential]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted email]')
    .replace(/projects\/[^/\s]+/g, 'projects/[redacted]')
    .slice(0, 600);
};

function classify(error) {
  const code = Number(error.code ?? error.errorInfo?.code);
  if ([4, 14].includes(code) || /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|No connection established/i.test(error.message || '')) return 'connectivity';
  if (code === 7) return 'permission';
  if (code === 16 || /invalid_grant|invalid credential|unauthenticated/i.test(error.message || '')) return 'credentials';
  if (code === 5 || code === 3) return 'project_or_database_configuration';
  if (/not initialized|private key|credential/i.test(error.message || '')) return 'firebase_initialization';
  return 'unknown';
}

async function main() {
  const { getDb } = require('../config/firebase');
  const startedAt = Date.now();
  console.log('Firebase configuration checks:', JSON.stringify({
    ...config,
    firestoreProxyBypassConfigured: Boolean(process.env.no_grpc_proxy?.includes('firestore.googleapis.com')),
    googleApiProxyBypassConfigured: Boolean(process.env.NO_PROXY?.split(',').includes('googleapis.com')),
  }));
  const snapshot = await getDb().collection('users').limit(1).get();
  console.log(JSON.stringify({ firestoreRead: 'succeeded', documentCount: snapshot.size, elapsedMs: Date.now() - startedAt }));
}

main().catch(error => {
  console.error(JSON.stringify({
    firestoreRead: 'failed',
    code: error.code ?? error.errorInfo?.code ?? 'UNKNOWN',
    category: classify(error),
    message: redact(error.message),
  }));
  process.exitCode = 1;
});
