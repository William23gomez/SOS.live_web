const { auth, db } = require('../config/firebase');
const env = require('../config/env');

const USERS_COLLECTION = 'usuarios';

const normalizeUser = (user) => ({
  id: user.id || user.uid,
  uid: user.uid || user.id,
  nombre: user.nombre,
  email: user.email,
  telefono: user.telefono,
  nit: user.nit,
  createdAt: user.createdAt,
});

const buildFirebaseError = (code, fallbackMessage, statusCode = 400) => {
  const error = new Error(fallbackMessage);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

const traducirErrorFirebase = (error) => {
  const code = error?.code || '';

  if (code === 'auth/email-already-exists' || code === 'auth/email-already-in-use') {
    return 'Este correo ya esta registrado.';
  }
  if (code === 'auth/invalid-email') return 'El correo no es valido.';
  if (code === 'auth/weak-password') return 'La contrasena debe tener al menos 6 caracteres.';
  if (code === 'auth/invalid-credential' || code === 'INVALID_LOGIN_CREDENTIALS') {
    return 'Correo o contrasena incorrectos.';
  }
  if (code === 'auth/requires-recent-login') {
    return 'Por seguridad, vuelve a iniciar sesion y repite la accion.';
  }
  if (code === 'permission-denied' || code === 'firestore/permission-denied') {
    return 'Firestore bloqueo la escritura. Revisa las reglas.';
  }
  if (code === 'auth/email-not-verified') {
    return 'Debes verificar tu correo antes de iniciar sesion.';
  }

  return error?.message || 'Ocurrio un error inesperado.';
};

const registrarUsuario = async ({ idToken, nombre, telefono, nit }) => {
  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    const firebaseUser = await auth.getUser(decodedToken.uid);

    const user = {
      uid: firebaseUser.uid,
      nombre,
      email: firebaseUser.email,
      telefono,
      nit,
      createdAt: new Date().toISOString(),
    };

    await db.collection(USERS_COLLECTION).doc(firebaseUser.uid).set(user);

    return {
      user: normalizeUser(user),
    };
  } catch (error) {
    error.message = traducirErrorFirebase(error);
    throw error;
  }
};

const updateProfile = async (userId, { nombre, telefono, nit }) => {
  const userDocRef = db.collection(USERS_COLLECTION).doc(userId);
  const userDoc = await userDocRef.get();
  const firebaseUser = await auth.getUser(userId);

  if (!userDoc.exists) {
    const error = new Error('Usuario no encontrado');
    error.statusCode = 404;
    throw error;
  }

  const currentUser = userDoc.data();
  const updatedUser = {
    ...currentUser,
    nombre,
    email: firebaseUser.email,
    telefono,
    nit,
    updatedAt: new Date().toISOString(),
  };

  await userDocRef.set(updatedUser, { merge: true });

  return normalizeUser(updatedUser);
};

const deleteAccount = async (userId) => {
  const userDocRef = db.collection(USERS_COLLECTION).doc(userId);

  await userDocRef.delete().catch(() => {});
  await auth.deleteUser(userId);
};

const loginUsuario = async (email, password) => {
  if (!env.firebaseWebApiKey) {
    throw buildFirebaseError(
      'auth/missing-api-key',
      'Falta FIREBASE_WEB_API_KEY en el backend.',
      500
    );
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.firebaseWebApiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    const firebaseCode = data?.error?.message || 'auth/invalid-credential';
    throw buildFirebaseError(firebaseCode, traducirErrorFirebase({ code: firebaseCode }), 401);
  }

  const firebaseUser = await auth.getUser(data.localId);

  if (!firebaseUser.emailVerified) {
    throw buildFirebaseError(
      'auth/email-not-verified',
      'Debes verificar tu correo antes de iniciar sesion.',
      403
    );
  }

  const user = await getProfile(firebaseUser.uid);

  return {
    user,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresIn: data.expiresIn,
  };
};

const verifyLoginToken = async (idToken) => {
  const decodedToken = await auth.verifyIdToken(idToken);
  const user = await getProfile(decodedToken.uid);

  return {
    user,
  };
};

const getProfile = async (userId) => {
  const userDoc = await db.collection(USERS_COLLECTION).doc(userId).get();

  if (!userDoc.exists) {
    const error = new Error('Usuario no encontrado');
    error.statusCode = 404;
    throw error;
  }

  return normalizeUser(userDoc.data());
};

module.exports = {
  registrarUsuario,
  updateProfile,
  deleteAccount,
  loginUsuario,
  traducirErrorFirebase,
  verifyLoginToken,
  getProfile,
};
