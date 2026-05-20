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

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = String(origin).replace(/\/+$/, '');
      const isConfiguredFrontend = configuredFrontendOrigins.includes(normalizedOrigin);
      const isLocalDevOrigin = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);

      if (isConfiguredFrontend || isLocalDevOrigin) {
        callback(null, true);
        return;
      }

      callback(new Error('Origen no permitido por CORS'));
    },
  })
);
app.use(express.json());

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
