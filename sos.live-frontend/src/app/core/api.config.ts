const browserHostname = typeof window !== 'undefined' ? window.location.hostname : '';
const browserProtocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
const isPrivateNetworkHost =
  /^10\.\d+\.\d+\.\d+$/.test(browserHostname) ||
  /^192\.168\.\d+\.\d+$/.test(browserHostname) ||
  /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(browserHostname);
const isLocalDevHost =
  browserHostname === 'localhost' ||
  browserHostname === '127.0.0.1' ||
  browserHostname === '0.0.0.0' ||
  isPrivateNetworkHost;
const PRODUCTION_API_BASE_URL = 'https://us-central1-soslive-f7513.cloudfunctions.net/api';

export const API_BASE_URL = isLocalDevHost
  ? `${browserProtocol}//${browserHostname === '0.0.0.0' ? 'localhost' : browserHostname}:3000/api`
  : PRODUCTION_API_BASE_URL;
export const PUBLIC_APP_URL = 'https://soslive-f7513.web.app';
