const browserHostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isLocalDevHost = browserHostname === 'localhost' || browserHostname === '127.0.0.1';
const PRODUCTION_API_BASE_URL = 'https://us-central1-soslive-f7513.cloudfunctions.net/api';

export const API_BASE_URL = isLocalDevHost
  ? 'http://localhost:3001/api'
  : PRODUCTION_API_BASE_URL;
export const PUBLIC_APP_URL = 'https://soslive-f7513.web.app';
