const admin = require('firebase-admin');
const env = require('./env');

const hasExplicitServiceAccount =
  Boolean(env.firebaseClientEmail) && Boolean(env.firebasePrivateKey);

if (!admin.apps.length) {
  const appConfig = {
    projectId: env.firebaseProjectId || 'soslive-f7513',
  };

  if (hasExplicitServiceAccount) {
    const serviceAccount = {
      type: 'service_account',
      project_id: env.firebaseProjectId || 'soslive-f7513',
      private_key_id: env.firebasePrivateKeyId,
      private_key: env.firebasePrivateKey ? env.firebasePrivateKey.replace(/\\n/g, '\n') : undefined,
      client_email: env.firebaseClientEmail,
      client_id: env.firebaseClientId,
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      client_x509_cert_url: env.firebaseClientX509CertUrl,
    };

    admin.initializeApp({
      ...appConfig,
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    // In Cloud Functions / Cloud Run, Firebase Admin can use the runtime service account automatically.
    admin.initializeApp(appConfig);
  }
}

const auth = admin.auth();
const db = admin.firestore();

module.exports = {
  admin,
  auth,
  db,
};
