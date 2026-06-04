const express = require('express');

const authRoutes = require('./auth.routes');
const adminRoutes = require('./admin.routes');
const operationsRoutes = require('./operations.routes');
const paymentsRoutes = require('./payments.routes');

const router = express.Router();
const healthPayload = {
  message: 'SOS Live funcionando',
};

router.get('/', (req, res) => {
  res.status(200).json(healthPayload);
});

router.get('/health', (req, res) => {
  res.status(200).json(healthPayload);
});

router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/operations', operationsRoutes);
router.use('/payments', paymentsRoutes);

module.exports = router;
