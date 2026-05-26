const express = require('express');

const paymentsController = require('../controllers/payments.controller');
const authMiddleware = require('../middlewares/auth.middleware');

const router = express.Router();

router.post('/mercadopago/events', paymentsController.handleMercadoPagoEvent);
router.get('/mercadopago/events', paymentsController.handleMercadoPagoEvent);

router.use(authMiddleware);

router.get('/access-status', paymentsController.getAccessStatus);
router.post('/checkout', paymentsController.createCheckout);
router.post('/simulate', paymentsController.simulatePayment);
router.post('/mercadopago/payments/:transactionId/confirm', paymentsController.confirmTransaction);

module.exports = router;
