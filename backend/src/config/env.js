const dotenv = require('dotenv');

dotenv.config();

module.exports = {
  port: process.env.PORT || 3000,
  frontendUrl: process.env.FRONTEND_URL ||'http://localhost:4200',
  firebaseWebApiKey: process.env.FIREBASE_WEB_API_KEY || 'AIzaSyAmYp4oZYgVSuOe-d0sd5VndyrOAunirhY',
};
