const express = require('express');

const authRoutes = require('./auth.routes');

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({
    message: 'Backend SOS Live funcionando',
  });
});

router.use('/auth', authRoutes);

module.exports = router;
