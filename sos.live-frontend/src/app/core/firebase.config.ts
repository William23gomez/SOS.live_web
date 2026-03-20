import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAmYp4oZYgVSuOe-d0sd5VndyrOAunirhY',
  authDomain: 'soslive-f7513.firebaseapp.com',
  projectId: 'soslive-f7513',
  storageBucket: 'soslive-f7513.firebasestorage.app',
  messagingSenderId: '1043689888340',
  appId: '1:1043689888340:web:45767b37d8b27e25682bc1',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
