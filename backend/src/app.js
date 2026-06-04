const express = require('express');
const cors = require('cors');

const env = require('./config/env');
const routes = require('./routes');
const errorMiddleware = require('./middlewares/error.middleware');

const app = express();

const healthPayload = {
  message: 'SOS Live funcionando',
};

const configuredFrontendOrigins = [
  env.frontendUrl,
  env.publicAppUrl,
  env.firebaseProjectId ? `https://${env.firebaseProjectId}.web.app` : '',
  env.firebaseProjectId ? `https://${env.firebaseProjectId}.firebaseapp.com` : '',
]
  .map((origin) => String(origin || '').replace(/\/+$/, ''))
  .filter(Boolean);

const normalizedProjectId = String(env.firebaseProjectId || '')
  .trim()
  .toLowerCase();

const isFirebaseHostingOriginForProject = (origin) => {
  if (!origin || !normalizedProjectId) {
    return false;
  }

  try {
    const { hostname, protocol } = new URL(origin);
    const normalizedHostname = String(hostname || '').trim().toLowerCase();
    const isSecureProtocol = protocol === 'https:';
    const isFirebaseHostingDomain =
      normalizedHostname.endsWith('.web.app') || normalizedHostname.endsWith('.firebaseapp.com');

    if (!isSecureProtocol || !isFirebaseHostingDomain) {
      return false;
    }

    return normalizedHostname.includes(normalizedProjectId);
  } catch {
    return false;
  }
};

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = String(origin).replace(/\/+$/, '');
      const isConfiguredFrontend = configuredFrontendOrigins.includes(normalizedOrigin);
      const isFirebaseHostingProjectOrigin = isFirebaseHostingOriginForProject(normalizedOrigin);
      const isLocalDevOrigin = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
      const isPrivateNetworkDevOrigin =
        /^https?:\/\/10\.\d+\.\d+\.\d+:\d+$/.test(origin) ||
        /^https?:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin) ||
        /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+:\d+$/.test(origin);

      if (
        isConfiguredFrontend ||
        isFirebaseHostingProjectOrigin ||
        isLocalDevOrigin ||
        isPrivateNetworkDevOrigin
      ) {
        callback(null, true);
        return;
      }

      callback(new Error('Origen no permitido por CORS'));
    },
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/', (req, res) => {
  res.status(200).json(healthPayload);
});

app.get('/health', (req, res) => {
  res.status(200).json(healthPayload);
});

app.use(routes);
app.use('/api', routes);

app.use(errorMiddleware);

module.exports = app;
