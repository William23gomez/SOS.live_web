const express = require('express');

const adminController = require('../controllers/admin.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const adminMiddleware = require('../middlewares/admin.middleware');

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

router.get('/overview', adminController.getOverview);
router.get('/companies', adminController.listCompanies);
router.get('/payments', adminController.listBilling);

module.exports = router;
