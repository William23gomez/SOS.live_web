const express = require('express');

const paymentsController = require('../controllers/payments.controller');
const authMiddleware = require('../middlewares/auth.middleware');

const router = express.Router();

router.post('/mercadopago/events', paymentsController.handleMercadoPagoEvent);
router.get('/mercadopago/events', paymentsController.handleMercadoPagoEvent);

router.use(authMiddleware);

router.post('/checkout', paymentsController.createCheckout);
router.post('/mercadopago/payments/:transactionId/confirm', paymentsController.confirmTransaction);

module.exports = router;
