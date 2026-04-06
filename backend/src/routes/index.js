const express = require('express');

const authRoutes = require('./auth.routes');
const adminRoutes = require('./admin.routes');
const operationsRoutes = require('./operations.routes');

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({
    message: 'Backend SOS Live funcionando',
  });
});

router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/operations', operationsRoutes);

module.exports = router;
