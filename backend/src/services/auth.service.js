const { auth, db } = require('../config/firebase');
const env = require('../config/env');

const USERS_COLLECTION = 'usuarios';
const COMPANIES_COLLECTION = 'Empresas';
const DASHBOARD_META_COLLECTION = 'dashboard_meta';
const COMPANY_PROFILE_DOC = 'company_profile';

const normalizeUser = (user) => ({
  id: user.id || user.uid,
  uid: user.uid || user.id,
  nombre: user.nombre,
  email: user.email,
  telefono: user.telefono,
  nit: user.nit,
  rol: user.rol || 'empresa',
  createdAt: user.createdAt,
});

const syncCompanyProfile = async (user, overrides = {}) => {
  const companyProfileRef = db.collection(DASHBOARD_META_COLLECTION).doc(COMPANY_PROFILE_DOC);
  const companyProfileDoc = await companyProfileRef.get();
  const currentCompanyProfile = companyProfileDoc.exists ? companyProfileDoc.data() : {};

  const companyProfile = {
    nombre: overrides.nombre ?? currentCompanyProfile.nombre ?? user.nombre ?? '',
    correo: overrides.correo ?? currentCompanyProfile.correo ?? user.email ?? '',
    telefono: overrides.telefono ?? currentCompanyProfile.telefono ?? user.telefono ?? '',
    direccion: overrides.direccion ?? currentCompanyProfile.direccion ?? '',
    nitEmpresa: overrides.nitEmpresa ?? currentCompanyProfile.nitEmpresa ?? user.nit ?? '',
    plan: overrides.plan ?? currentCompanyProfile.plan ?? 'Plan base',
    estado: overrides.estado ?? currentCompanyProfile.estado ?? 'Activa',
    updatedAt: new Date().toISOString(),
  };

  await companyProfileRef.set(companyProfile, { merge: true });
};

const syncCompanyRecord = async (user, overrides = {}) => {
  const companyRef = db.collection(COMPANIES_COLLECTION).doc(user.uid || user.id);
  const companyDoc = await companyRef.get();
  const currentCompany = companyDoc.exists ? companyDoc.data() : {};

  const company = {
    uid: user.uid || user.id,
    nombre: overrides.nombre ?? currentCompany.nombre ?? user.nombre ?? '',
    email: overrides.email ?? currentCompany.email ?? user.email ?? '',
    telefono: overrides.telefono ?? currentCompany.telefono ?? user.telefono ?? '',
    nit: overrides.nit ?? currentCompany.nit ?? user.nit ?? '',
    direccion: overrides.direccion ?? currentCompany.direccion ?? '',
    plan: overrides.plan ?? currentCompany.plan ?? 'Plan base',
    estado: overrides.estado ?? currentCompany.estado ?? 'Aprobada',
    createdAt: currentCompany.createdAt ?? user.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await companyRef.set(company, { merge: true });
};

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
      rol: 'empresa',
      createdAt: new Date().toISOString(),
    };

    await db.collection(USERS_COLLECTION).doc(firebaseUser.uid).set(user);
    await syncCompanyProfile(user);
    await syncCompanyRecord(user);

    return {
      user: normalizeUser(user),
    };
  } catch (error) {
    error.message = traducirErrorFirebase(error);
    throw error;
  }
};

const updateProfile = async (userId, { nombre, telefono, nit, direccion, plan }) => {
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
  await syncCompanyProfile(updatedUser, {
    nombre,
    correo: firebaseUser.email,
    telefono,
    direccion,
    nitEmpresa: nit,
    plan,
  });
  await syncCompanyRecord(updatedUser, {
    nombre,
    email: firebaseUser.email,
    telefono,
    nit,
    direccion,
    plan,
  });

  return normalizeUser(updatedUser);
};

const deleteAccount = async (userId) => {
  const userDocRef = db.collection(USERS_COLLECTION).doc(userId);
  const companyRef = db.collection(COMPANIES_COLLECTION).doc(userId);

  await userDocRef.delete().catch(() => {});
  await companyRef.delete().catch(() => {});
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

  const user = normalizeUser(userDoc.data());
  await syncCompanyProfile(user);
  await syncCompanyRecord(user);

  return user;
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
