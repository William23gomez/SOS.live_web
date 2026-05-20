const express = require('express');

const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/auth.middleware');

const router = express.Router();

router.post('/register', authController.register);
router.post('/register-availability', authController.registerAvailability);
router.post('/login', authController.login);
router.post('/admin/resolve', authController.resolveAdminAccess);
router.post('/verify-session', authController.verifySession);
router.post('/verification-status', authController.verificationStatus);
router.post('/verify-email-code', authController.confirmEmailVerification);
router.get('/profile', authMiddleware, authController.profile);
router.put('/profile', authMiddleware, authController.updateProfile);
router.delete('/profile', authMiddleware, authController.deleteAccount);

module.exports = router;
