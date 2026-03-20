const { auth } = require('../config/firebase');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      message: 'Token no enviado',
    });
  }

  const token = authHeader.split(' ')[1];

  auth
    .verifyIdToken(token)
    .then((decodedToken) => {
      req.user = {
        id: decodedToken.uid,
        email: decodedToken.email,
      };

      next();
    })
    .catch(() => {
      res.status(401).json({
        message: 'Token de Firebase invalido o expirado',
      });
    });
};

module.exports = authMiddleware;
