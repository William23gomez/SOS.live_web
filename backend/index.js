const functions = require('firebase-functions/v1');

const app = require('./src/app');

exports.api = functions.region('us-central1').https.onRequest(app);
