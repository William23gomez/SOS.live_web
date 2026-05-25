const dotenv = require('dotenv');

dotenv.config();

module.exports = {
  port: process.env.BACKEND_PORT || process.env.PORT || 3000,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200',
  publicAppUrl:
    process.env.PUBLIC_APP_URL ||
    `https://${process.env.APP_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'soslive-f7513'}.web.app`,
  firebaseWebApiKey:
    process.env.APP_FIREBASE_WEB_API_KEY ||
    process.env.FIREBASE_WEB_API_KEY ||
    'AIzaSyAmYp4oZYgVSuOe-d0sd5VndyrOAunirhY',
  firebaseProjectId:
    process.env.APP_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'soslive-f7513',
  firebasePrivateKeyId:
    process.env.APP_FIREBASE_PRIVATE_KEY_ID || process.env.FIREBASE_PRIVATE_KEY_ID,
  firebasePrivateKey:
    process.env.APP_FIREBASE_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY,
  firebaseClientEmail:
    process.env.APP_FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL,
  firebaseClientId:
    process.env.APP_FIREBASE_CLIENT_ID || process.env.FIREBASE_CLIENT_ID,
  firebaseClientX509CertUrl:
    process.env.APP_FIREBASE_CLIENT_X509_CERT_URL || process.env.FIREBASE_CLIENT_X509_CERT_URL,
  publicBackendUrl: process.env.PUBLIC_BACKEND_URL || '',
  mercadoPagoAccessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN || '',
  mercadoPagoRedirectUrl: process.env.MERCADO_PAGO_REDIRECT_URL || '',
  mercadoPagoNotificationUrl: process.env.MERCADO_PAGO_NOTIFICATION_URL || '',
};
