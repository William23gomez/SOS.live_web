const authService = require('../services/auth.service');

const adminMiddleware = async (req, res, next) => {
  try {
    const profile = await authService.getProfile(req.user.id);

    if (profile.rol !== 'admin') {
      return res.status(403).json({
        message: 'Acceso restringido al panel admin.',
      });
    }

    req.user.rol = profile.rol;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = adminMiddleware;
