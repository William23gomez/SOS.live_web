const express = require('express');

const paymentsController = require('../controllers/payments.controller');
const authMiddleware = require('../middlewares/auth.middleware');

const router = express.Router();

router.post('/mercadopago/events', paymentsController.handleMercadoPagoNotification);
router.get('/mercadopago/events', paymentsController.handleMercadoPagoNotification);

router.use(authMiddleware);

router.get('/setup-status', paymentsController.getSetupStatus);
router.get('/access-status', paymentsController.getAccessStatus);
router.get('/billing', paymentsController.listBilling);
router.post('/checkout', paymentsController.createCheckout);
router.post('/simulate', paymentsController.simulatePayment);
router.post('/mercadopago/payments/:paymentId/confirm', paymentsController.confirmTransaction);

module.exports = router;
