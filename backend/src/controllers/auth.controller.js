const authService = require('../services/auth.service');

const validateRegisterBody = ({ idToken, nombre, telefono, nit }) => {
  if (!idToken || !nombre || !telefono || !nit) {
    const error = new Error('Todos los campos son obligatorios');
    error.statusCode = 400;
    throw error;
  }

  if (!/^\d+$/.test(telefono) || !/^\d+$/.test(nit)) {
    const error = new Error('Telefono y NIT deben contener solo numeros');
    error.statusCode = 400;
    throw error;
  }
};

const validateFirebaseTokenBody = ({ idToken }) => {
  if (!idToken) {
    const error = new Error('El idToken de Firebase es obligatorio');
    error.statusCode = 400;
    throw error;
  }
};

const validateLoginBody = ({ email, password }) => {
  if (!email || !password) {
    const error = new Error('Correo y contrasena son obligatorios');
    error.statusCode = 400;
    throw error;
  }
};

const validateUpdateProfileBody = ({ nombre, telefono, nit }) => {
  if (!nombre || !telefono || !nit) {
    const error = new Error('Todos los campos son obligatorios');
    error.statusCode = 400;
    throw error;
  }

  if (!/^\d+$/.test(telefono) || !/^\d+$/.test(nit)) {
    const error = new Error('Telefono y NIT deben contener solo numeros');
    error.statusCode = 400;
    throw error;
  }
};

const register = async (req, res, next) => {
  try {
    validateRegisterBody(req.body);

    const result = await authService.registrarUsuario(req.body);

    res.status(201).json({
      message: 'Usuario registrado correctamente',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    validateLoginBody(req.body);

    const result = await authService.loginUsuario(req.body.email, req.body.password);

    res.status(200).json({
      message: 'Inicio de sesion exitoso',
      ...result,
    });
  } catch (error) {
    error.message = authService.traducirErrorFirebase(error);
    next(error);
  }
};

const verifySession = async (req, res, next) => {
  try {
    validateFirebaseTokenBody(req.body);

    const result = await authService.verifyLoginToken(req.body.idToken);

    res.status(200).json({
      message: 'Token de Firebase validado correctamente',
      ...result,
    });
  } catch (error) {
    error.message = authService.traducirErrorFirebase(error);
    next(error);
  }
};

const profile = async (req, res, next) => {
  try {
    const user = await authService.getProfile(req.user.id);

    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    validateUpdateProfileBody(req.body);

    const user = await authService.updateProfile(req.user.id, req.body);

    res.status(200).json({
      message: 'Perfil actualizado correctamente',
      user,
    });
  } catch (error) {
    next(error);
  }
};

const deleteAccount = async (req, res, next) => {
  try {
    await authService.deleteAccount(req.user.id);

    res.status(200).json({
      message: 'Cuenta eliminada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  verifySession,
  profile,
  updateProfile,
  deleteAccount,
};
