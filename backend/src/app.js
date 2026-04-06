const express = require('express');
const cors = require('cors');

const env = require('./config/env');
const routes = require('./routes');
const errorMiddleware = require('./middlewares/error.middleware');

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const isConfiguredFrontend = origin === env.frontendUrl;
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

app.use('/api', routes);

app.use(errorMiddleware);

module.exports = app;
