const { auth, db } = require('../config/firebase');
const env = require('../config/env');

const USERS_COLLECTION = 'usuarios';
const COMPANIES_COLLECTION = 'Empresas';
const DASHBOARD_COMPANY_PROFILES_COLLECTION = 'dashboard_company_profiles';
const publicAppUrl = String(env.publicAppUrl || '').replace(/\/+$/, '');
const DUPLICATE_COMPANY_DATA_MESSAGE = 'Ya existe una empresa registrada con esos datos.';
const DUPLICATE_COMPANY_EMAIL_MESSAGE = 'Ya hay una empresa registrada con este correo.';
const DUPLICATE_COMPANY_NIT_MESSAGE = 'Ya hay una empresa registrada con este NIT.';
const DUPLICATE_COMPANY_PHONE_MESSAGE = 'Ya hay una empresa registrada con este telefono.';
const DUPLICATE_COMPANY_NAME_MESSAGE = 'Ya hay una empresa registrada con este nombre.';
const FIREBASE_AUTH_TIMEOUT_MS = 12000;
const FIREBASE_EMAIL_TIMEOUT_MS = 8000;

const normalizeText = (value = '') => String(value).trim();
const normalizeName = (value = '') => normalizeText(value).replace(/\s+/g, ' ').toLowerCase();
const normalizeEmail = (value = '') => normalizeText(value).toLowerCase();
const normalizeDigits = (value = '') => String(value).replace(/\D+/g, '');
const buildVerificationContinueUrl = (email = '') => {
  const normalizedEmail = normalizeEmail(email);

  try {
    const url = new URL(`${publicAppUrl}/email-verified`);
    url.searchParams.set('app', 'empresa');

    if (normalizedEmail) {
      url.searchParams.set('email', normalizedEmail);
    }

    return url.toString();
  } catch {
    const emailQuery = normalizedEmail ? `&email=${encodeURIComponent(normalizedEmail)}` : '';
    return `${publicAppUrl}/email-verified?app=empresa${emailQuery}`;
  }
};

const normalizeUser = (user) => ({
  id: user.id || user.uid,
  uid: user.uid || user.id,
  nombre: user.nombre,
  email: user.email,
  telefono: user.telefono,
  nit: user.nit,
  direccion: user.direccion || '',
  plan: user.plan || '',
  estado: user.estado || '',
  rol: user.rol || 'empresa',
  createdAt: user.createdAt,
});

const fetchFirebaseAuthJson = async (
  path,
  payload,
  {
    timeoutMs = FIREBASE_AUTH_TIMEOUT_MS,
    fallbackCode = 'auth/network-request-failed',
    fallbackMessage = 'No fue posible conectar con Firebase.',
    statusCode = 400,
  } = {}
) => {
  if (!env.firebaseWebApiKey) {
    throw buildFirebaseError(
      'auth/missing-api-key',
      'Falta FIREBASE_WEB_API_KEY en el backend.',
      500
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetch(`https://identitytoolkit.googleapis.com/v1/${path}?key=${env.firebaseWebApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw buildFirebaseError(fallbackCode, fallbackMessage, statusCode);
    }

    throw buildFirebaseError(fallbackCode, fallbackMessage, statusCode);
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const firebaseCode =
      data?.error?.details?.find((detail) => typeof detail?.reason === 'string')?.reason ||
      data?.error?.message ||
      fallbackCode;

    throw buildFirebaseError(firebaseCode, traducirErrorFirebase({ code: firebaseCode }), statusCode);
  }

  return data;
};

const buildStoredCompanyProfile = (company = {}, firebaseUser = null) => ({
  uid: company.uid || firebaseUser?.uid || '',
  nombre: company.nombre || firebaseUser?.displayName || '',
  email: company.email || firebaseUser?.email || '',
  telefono: company.telefono || '',
  nit: company.nit || '',
  direccion: company.direccion || '',
  plan: company.plan || '',
  estado: company.estado || '',
  rol: 'empresa',
  createdAt: company.createdAt || new Date().toISOString(),
});

const resolveStoredAccount = async (userId, firebaseUser = null) => {
  const [userDoc, companyDoc, resolvedFirebaseUser] = await Promise.all([
    db.collection(USERS_COLLECTION).doc(userId).get(),
    db.collection(COMPANIES_COLLECTION).doc(userId).get(),
    firebaseUser ? Promise.resolve(firebaseUser) : auth.getUser(userId),
  ]);

  if (userDoc.exists) {
    const user = userDoc.data();

    if (user.rol === 'admin') {
      return {
        role: 'admin',
        source: USERS_COLLECTION,
        data: user,
        firebaseUser: resolvedFirebaseUser,
      };
    }
  }

  if (companyDoc.exists) {
    const company = buildStoredCompanyProfile(companyDoc.data(), resolvedFirebaseUser);

    return {
      role: 'empresa',
      source: COMPANIES_COLLECTION,
      data: company,
      firebaseUser: resolvedFirebaseUser,
    };
  }

  if (userDoc.exists) {
    const legacyUser = userDoc.data();

    return {
      role: legacyUser.rol || 'empresa',
      source: USERS_COLLECTION,
      data: legacyUser,
      firebaseUser: resolvedFirebaseUser,
    };
  }

  const error = new Error('Usuario no encontrado');
  error.statusCode = 404;
  throw error;
};

const syncCompanyProfile = async (user, overrides = {}) => {
  const companyProfileRef = db
    .collection(DASHBOARD_COMPANY_PROFILES_COLLECTION)
    .doc(user.uid || user.id);
  const companyProfileDoc = await companyProfileRef.get();
  const currentCompanyProfile = companyProfileDoc.exists ? companyProfileDoc.data() : {};

  const companyProfile = {
    uid: user.uid || user.id,
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

const syncCompanyUserRecord = async (user, overrides = {}) => {
  const userRef = db.collection(USERS_COLLECTION).doc(user.uid || user.id);
  const userDoc = await userRef.get();
  const currentUser = userDoc.exists ? userDoc.data() : {};

  if (currentUser.rol === 'admin') {
    throw buildFirebaseError(
      'auth/admin-access-denied',
      'No es posible registrar una empresa sobre una cuenta administrativa.',
      409
    );
  }

  const companyUser = {
    uid: user.uid || user.id,
    id: user.uid || user.id,
    nombre: overrides.nombre ?? currentUser.nombre ?? user.nombre ?? '',
    email: overrides.email ?? currentUser.email ?? user.email ?? '',
    telefono: overrides.telefono ?? currentUser.telefono ?? user.telefono ?? '',
    nit: overrides.nit ?? currentUser.nit ?? user.nit ?? '',
    rol: 'empresa',
    createdAt: currentUser.createdAt ?? user.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await userRef.set(companyUser, { merge: true });
};

const buildFirebaseError = (code, fallbackMessage, statusCode = 400) => {
  const error = new Error(fallbackMessage);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

const findCompanyConflictByField = async (field, value) => {
  if (!value) {
    return false;
  }

  const [usersSnapshot, companiesSnapshot] = await Promise.all([
    db.collection(USERS_COLLECTION).where(field, '==', value).limit(5).get(),
    db.collection(COMPANIES_COLLECTION).where(field, '==', value).limit(1).get(),
  ]);

  const hasUserConflict = usersSnapshot.docs.some((doc) => doc.data().rol === 'empresa');

  return hasUserConflict || !companiesSnapshot.empty;
};

const assertCompanyRegistrationIsUnique = async ({ nombre, email, telefono, nit }) => {
  const normalizedCandidate = {
    nombre: normalizeName(nombre),
    email: normalizeEmail(email),
    telefono: normalizeDigits(telefono),
    nit: normalizeDigits(nit),
  };

  const fieldRules = [
    {
      field: 'email',
      code: 'auth/company-email-already-exists',
      message: DUPLICATE_COMPANY_EMAIL_MESSAGE,
    },
    {
      field: 'nit',
      code: 'auth/company-nit-already-exists',
      message: DUPLICATE_COMPANY_NIT_MESSAGE,
    },
    {
      field: 'telefono',
      code: 'auth/company-phone-already-exists',
      message: DUPLICATE_COMPANY_PHONE_MESSAGE,
    },
  ];

  for (const rule of fieldRules) {
    const value = normalizedCandidate[rule.field];

    if (await findCompanyConflictByField(rule.field, value)) {
      throw buildFirebaseError(rule.code, rule.message, 409);
    }
  }

  if (!normalizedCandidate.nombre) {
    return;
  }

  const [usersSnapshot, companiesSnapshot] = await Promise.all([
    db.collection(USERS_COLLECTION).where('rol', '==', 'empresa').get(),
    db.collection(COMPANIES_COLLECTION).get(),
  ]);
  const companies = [
    ...usersSnapshot.docs.map((doc) => doc.data()),
    ...companiesSnapshot.docs.map((doc) => doc.data()),
  ];

  const duplicateName = companies.some(
    (company) => normalizeName(company.nombre) === normalizedCandidate.nombre
  );

  if (duplicateName) {
    throw buildFirebaseError(
      'auth/company-name-already-exists',
      DUPLICATE_COMPANY_NAME_MESSAGE,
      409
    );
  }
};

const normalizeLoginIdentifier = (value = '') => String(value).trim().toLowerCase();
const isDuplicateCompanyRegistrationCode = (code = '') =>
  [
    'auth/company-email-already-exists',
    'auth/company-nit-already-exists',
    'auth/company-phone-already-exists',
    'auth/company-name-already-exists',
  ].includes(code);

const traducirErrorFirebase = (error) => {
  const code = error?.code || '';
  const message = String(error?.message || '');

  if (
    message.includes('Could not load the default credentials') ||
    message.includes('DefaultCredentialsError')
  ) {
    return 'El backend local no tiene configuradas las credenciales de Firebase Admin. Revisa el archivo .env del backend.';
  }

  if (
    code === 'auth/email-already-exists' ||
    code === 'auth/email-already-in-use' ||
    code === 'EMAIL_EXISTS'
  ) {
    return 'Este correo ya est\u00e1 registrado.';
  }

  if (code === 'auth/invalid-email' || code === 'INVALID_EMAIL') {
    return 'El correo no es v\u00e1lido.';
  }

  if (code === 'auth/weak-password' || String(code).startsWith('WEAK_PASSWORD')) {
    return 'La contrase\u00f1a debe tener al menos 6 caracteres.';
  }

  if (code === 'auth/invalid-credential' || code === 'INVALID_LOGIN_CREDENTIALS') {
    return 'Correo o contrase\u00f1a incorrectos.';
  }

  if (code === 'API_KEY_INVALID' || code === 'auth/invalid-api-key') {
    return 'La FIREBASE_WEB_API_KEY configurada no es v\u00e1lida.';
  }

  if (code === 'auth/requires-recent-login') {
    return 'Por seguridad, vuelve a iniciar sesi\u00f3n y repite la acci\u00f3n.';
  }

  if (code === 'permission-denied' || code === 'firestore/permission-denied') {
    return 'Firestore bloque\u00f3 la escritura. Revisa las reglas.';
  }

  if (code === 'auth/email-not-verified') {
    return 'Debes verificar tu correo antes de iniciar sesi\u00f3n.';
  }

  if (code === 'auth/invalid-action-code' || code === 'INVALID_OOB_CODE') {
    return 'El enlace ya no es v\u00e1lido o ya fue usado. Solicita uno nuevo si hace falta.';
  }

  if (code === 'auth/expired-action-code' || code === 'EXPIRED_OOB_CODE') {
    return 'El enlace de verificaci\u00f3n venci\u00f3. Solicita uno nuevo.';
  }

  if (code === 'auth/missing-admin-identifier') {
    return 'Escribe el usuario o correo del administrador.';
  }

  if (code === 'auth/admin-access-denied') {
    return 'Este acceso es solo para administradores autorizados.';
  }

  if (code === 'auth/admin-identifier-ambiguous') {
    return 'Hay varios administradores con ese usuario. Usa el correo completo del administrador.';
  }

  if (code === 'auth/missing-register-credentials') {
    return 'Correo y contrase\u00f1a son obligatorios para crear la cuenta.';
  }

  if (code === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
    return 'Firebase bloque\u00f3 temporalmente la acci\u00f3n. Intenta de nuevo en unos minutos.';
  }

  if (code === 'auth/company-email-already-exists') {
    return DUPLICATE_COMPANY_EMAIL_MESSAGE;
  }

  if (code === 'auth/company-nit-already-exists') {
    return DUPLICATE_COMPANY_NIT_MESSAGE;
  }

  if (code === 'auth/company-phone-already-exists') {
    return DUPLICATE_COMPANY_PHONE_MESSAGE;
  }

  if (code === 'auth/company-name-already-exists') {
    return DUPLICATE_COMPANY_NAME_MESSAGE;
  }

  if (isDuplicateCompanyRegistrationCode(code)) {
    return DUPLICATE_COMPANY_DATA_MESSAGE;
  }

  return error?.message || 'Ocurri\u00f3 un error inesperado.';
};

const createFirebaseAccount = async (email, password) => {
  return fetchFirebaseAuthJson(
    'accounts:signUp',
    {
      email,
      password,
      returnSecureToken: true,
    },
    {
      fallbackMessage: 'Firebase tardó demasiado al crear la cuenta. Intenta de nuevo.',
      statusCode: 400,
    }
  );
};

const sendVerificationEmail = async (idToken, email = '') => {
  return fetchFirebaseAuthJson(
    'accounts:sendOobCode',
    {
      requestType: 'VERIFY_EMAIL',
      idToken,
      continueUrl: buildVerificationContinueUrl(email),
      canHandleCodeInApp: false,
    },
    {
      timeoutMs: FIREBASE_EMAIL_TIMEOUT_MS,
      fallbackMessage:
        'El correo de verificación tardó demasiado en salir. Intenta solicitarlo de nuevo desde el inicio de sesión.',
      statusCode: 400,
    }
  );
};

const confirmEmailVerificationCode = async (code, email = '') => {
  const normalizedCode = String(code || '').trim();
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedCode) {
    throw buildFirebaseError(
      'auth/invalid-action-code',
      'El enlace de verificaci\u00f3n no es v\u00e1lido. Solicita uno nuevo.',
      400
    );
  }

  let data;

  try {
    data = await fetchFirebaseAuthJson(
      'accounts:update',
      {
        oobCode: normalizedCode,
      },
      {
        fallbackCode: 'auth/invalid-action-code',
        fallbackMessage: 'La validación del correo tardó demasiado. Intenta abrir el enlace otra vez.',
        statusCode: 400,
      }
    );
  } catch (error) {
    const firebaseCode = error?.code || 'auth/invalid-action-code';
    const normalizedCodeError =
      firebaseCode === 'INVALID_OOB_CODE'
        ? 'auth/invalid-action-code'
        : firebaseCode === 'EXPIRED_OOB_CODE'
          ? 'auth/expired-action-code'
          : firebaseCode;

    if (
      normalizedEmail &&
      (normalizedCodeError === 'auth/invalid-action-code' ||
        normalizedCodeError === 'auth/expired-action-code')
    ) {
      try {
        const verificationStatus = await getEmailVerificationStatus(normalizedEmail);

        if (verificationStatus.emailVerified) {
          return verificationStatus;
        }
      } catch {
        // If the lookup fails, we fall back to the original Firebase error below.
      }
    }

    throw buildFirebaseError(
      normalizedCodeError,
      traducirErrorFirebase({ code: normalizedCodeError }),
      400
    );
  }

  return {
    email: normalizeEmail(data.email || ''),
    emailVerified: Boolean(data.emailVerified),
  };
};

const resolveAdminIdentifier = async (identifier) => {
  const normalizedIdentifier = normalizeLoginIdentifier(identifier);

  if (!normalizedIdentifier) {
    throw buildFirebaseError(
      'auth/missing-admin-identifier',
      'Escribe el usuario o correo del administrador.'
    );
  }

  const adminSnapshot = await db.collection(USERS_COLLECTION).where('rol', '==', 'admin').get();
  const adminUsers = adminSnapshot.docs.map((doc) => normalizeUser(doc.data()));

  const matchingAdmins = adminUsers.filter((user) => {
    const normalizedEmail = normalizeLoginIdentifier(user.email);
    const emailUser = normalizedEmail.split('@')[0];
    const normalizedUsername = normalizeLoginIdentifier(
      user.usuario || user.username || user.userName || ''
    );

    return (
      normalizedIdentifier === normalizedEmail ||
      normalizedIdentifier === emailUser ||
      (normalizedUsername && normalizedIdentifier === normalizedUsername)
    );
  });

  if (!matchingAdmins.length) {
    throw buildFirebaseError(
      'auth/admin-access-denied',
      'Este acceso es solo para administradores autorizados.',
      403
    );
  }

  if (matchingAdmins.length > 1 && !normalizedIdentifier.includes('@')) {
    throw buildFirebaseError(
      'auth/admin-identifier-ambiguous',
      'Hay varios administradores con ese usuario. Usa el correo completo del administrador.'
    );
  }

  const adminUser = matchingAdmins[0];

  return {
    email: adminUser.email,
    nombre: adminUser.nombre || 'Administrador',
  };
};

const registrarUsuario = async ({ idToken, email, password, nombre, telefono, nit }) => {
  let firebaseUid = '';

  try {
    const normalizedNombre = normalizeText(nombre);
    const normalizedTelefono = normalizeDigits(telefono);
    const normalizedNit = normalizeDigits(nit);
    const normalizedRegisterEmail = normalizeEmail(email);

    await assertCompanyRegistrationIsUnique({
      nombre: normalizedNombre,
      email: normalizedRegisterEmail,
      telefono: normalizedTelefono,
      nit: normalizedNit,
    });

    let firebaseEmail = normalizedRegisterEmail;
    let verificationToken = idToken;

    if (idToken) {
      const decodedToken = await auth.verifyIdToken(idToken);
      const firebaseUser = await auth.getUser(decodedToken.uid);
      firebaseUid = firebaseUser.uid;
      firebaseEmail = firebaseUser.email;
    } else {
      if (!email || !password) {
        throw buildFirebaseError(
          'auth/missing-register-credentials',
          'Correo y contrase\u00f1a son obligatorios para crear la cuenta.',
          400
        );
      }

      const signUpData = await createFirebaseAccount(normalizedRegisterEmail, password);
      firebaseUid = signUpData.localId;
      firebaseEmail = signUpData.email || normalizedRegisterEmail;
      verificationToken = signUpData.idToken;
    }

    const user = {
      uid: firebaseUid,
      nombre: normalizedNombre,
      email: firebaseEmail,
      telefono: normalizedTelefono,
      nit: normalizedNit,
      rol: 'empresa',
      createdAt: new Date().toISOString(),
    };

    const [companyProfileResult, companyRecordResult, companyUserResult, verificationResult] =
      await Promise.allSettled([
        syncCompanyProfile(user),
        syncCompanyRecord(user),
        syncCompanyUserRecord(user),
        verificationToken ? sendVerificationEmail(verificationToken, firebaseEmail) : Promise.resolve(null),
      ]);

    if (companyProfileResult.status === 'rejected') {
      throw companyProfileResult.reason;
    }

    if (companyRecordResult.status === 'rejected') {
      throw companyRecordResult.reason;
    }

    if (companyUserResult.status === 'rejected') {
      throw companyUserResult.reason;
    }

    const emailVerificationSent =
      Boolean(verificationToken) && verificationResult.status === 'fulfilled';
    const emailVerificationError =
      verificationToken && verificationResult.status === 'rejected'
        ? traducirErrorFirebase(verificationResult.reason)
        : '';

    return {
      user: normalizeUser(user),
      emailVerificationSent,
      emailVerificationError,
    };
  } catch (error) {
    if (!idToken && firebaseUid) {
      await db.collection(USERS_COLLECTION).doc(firebaseUid).delete().catch(() => {});
      await db.collection(COMPANIES_COLLECTION).doc(firebaseUid).delete().catch(() => {});

      await auth.deleteUser(firebaseUid).catch(() => {});
    }

    error.message = traducirErrorFirebase(error);
    throw error;
  }
};

const checkCompanyRegistrationAvailability = async ({ nombre, email, telefono, nit }) => {
  await assertCompanyRegistrationIsUnique({
    nombre: normalizeText(nombre),
    email: normalizeEmail(email),
    telefono: normalizeDigits(telefono),
    nit: normalizeDigits(nit),
  });

  return {
    available: true,
  };
};

const updateProfile = async (userId, { nombre, telefono, nit, direccion, plan }) => {
  const firebaseUser = await auth.getUser(userId);
  const currentAccount = await resolveStoredAccount(userId, firebaseUser);
  const currentUser = currentAccount.data;
  const normalizedProfile = {
    nombre: normalizeText(nombre),
    telefono: normalizeDigits(telefono),
    nit: normalizeDigits(nit),
    direccion: normalizeText(direccion),
    plan: normalizeText(plan),
  };
  const updatedUser = {
    ...currentUser,
    nombre: normalizedProfile.nombre,
    email: firebaseUser.email,
    telefono: normalizedProfile.telefono,
    nit: normalizedProfile.nit,
    updatedAt: new Date().toISOString(),
  };

  if (currentAccount.source === USERS_COLLECTION) {
    await db.collection(USERS_COLLECTION).doc(userId).set(updatedUser, { merge: true });
  }

  if (currentAccount.role === 'empresa') {
    await syncCompanyUserRecord(updatedUser, {
      nombre: normalizedProfile.nombre,
      email: firebaseUser.email,
      telefono: normalizedProfile.telefono,
      nit: normalizedProfile.nit,
    });
    await syncCompanyProfile(updatedUser, {
      nombre: normalizedProfile.nombre,
      correo: firebaseUser.email,
      telefono: normalizedProfile.telefono,
      direccion: normalizedProfile.direccion,
      nitEmpresa: normalizedProfile.nit,
      plan: normalizedProfile.plan,
    });
    await syncCompanyRecord(updatedUser, {
      nombre: normalizedProfile.nombre,
      email: firebaseUser.email,
      telefono: normalizedProfile.telefono,
      nit: normalizedProfile.nit,
      direccion: normalizedProfile.direccion,
      plan: normalizedProfile.plan,
    });
  }

  return normalizeUser(updatedUser);
};

const deleteAccount = async (userId) => {
  await db.collection(USERS_COLLECTION).doc(userId).delete().catch(() => {});
  await db.collection(COMPANIES_COLLECTION).doc(userId).delete().catch(() => {});
  await db.collection(DASHBOARD_COMPANY_PROFILES_COLLECTION).doc(userId).delete().catch(() => {});
  await auth.deleteUser(userId);
};

const loginUsuario = async (email, password) => {
  const data = await fetchFirebaseAuthJson(
    'accounts:signInWithPassword',
    {
      email,
      password,
      returnSecureToken: true,
    },
    {
      fallbackCode: 'auth/invalid-credential',
      fallbackMessage: 'Firebase tardó demasiado al iniciar sesión. Intenta de nuevo.',
      statusCode: 401,
    }
  );

  const firebaseUser = await auth.getUser(data.localId);

  if (!firebaseUser.emailVerified) {
    throw buildFirebaseError(
      'auth/email-not-verified',
      'Debes verificar tu correo antes de iniciar sesi\u00f3n.',
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
  const profile = await resolveStoredAccount(userId);
  const user = normalizeUser(profile.data);

  if (user.rol === 'empresa') {
    await syncCompanyUserRecord(user);
    await syncCompanyProfile(user);
    await syncCompanyRecord(user);
  }

  return user;
};

const getEmailVerificationStatus = async (email) => {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw buildFirebaseError('auth/missing-email', 'Escribe el correo a consultar.', 400);
  }

  try {
    const firebaseUser = await auth.getUserByEmail(normalizedEmail);

    return {
      email: firebaseUser.email || normalizedEmail,
      emailVerified: Boolean(firebaseUser.emailVerified),
    };
  } catch (error) {
    if (error?.code === 'auth/user-not-found') {
      throw buildFirebaseError(
        'auth/user-not-found',
        'No encontramos una cuenta con ese correo.',
        404
      );
    }

    throw error;
  }
};

module.exports = {
  registrarUsuario,
  checkCompanyRegistrationAvailability,
  updateProfile,
  deleteAccount,
  loginUsuario,
  resolveAdminIdentifier,
  traducirErrorFirebase,
  verifyLoginToken,
  getProfile,
  getEmailVerificationStatus,
  confirmEmailVerificationCode,
};
