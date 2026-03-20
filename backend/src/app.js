const express = require('express');
const cors = require('cors');

const env = require('./config/env');
const routes = require('./routes');
const errorMiddleware = require('./middlewares/error.middleware');

const app = express();

app.use(
  cors({
    origin: env.frontendUrl,
  })
);
app.use(express.json());

app.use('/api', routes);

app.use(errorMiddleware);

module.exports = app;
