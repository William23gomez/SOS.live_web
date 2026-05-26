const paymentsService = require('../services/payments.service');

const createCheckout = async (req, res, next) => {
  try {
    const result = await paymentsService.createCheckout(req.user.id, req.body);

    res.status(201).json({
      message: 'Checkout de pago creado correctamente.',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

const getAccessStatus = async (req, res, next) => {
  try {
    const result = await paymentsService.getAccessStatus(req.user.id);

    res.status(200).json({
      message: result.hasActivePayment
        ? 'La cuenta tiene pago activo.'
        : 'La cuenta requiere pago para continuar.',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

const confirmTransaction = async (req, res, next) => {
  try {
    const result = await paymentsService.confirmTransaction(req.user.id, req.params.transactionId);

    res.status(200).json({
      message: 'Pago confirmado correctamente.',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

const simulatePayment = async (req, res, next) => {
  try {
    const result = await paymentsService.simulatePayment(req.user.id, req.body);

    res.status(201).json({
      message: 'Pago simulado registrado correctamente.',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

const handleMercadoPagoEvent = async (req, res, next) => {
  try {
    const result = await paymentsService.handleMercadoPagoEvent(req.body, req.query);

    res.status(200).json({
      message: 'Evento recibido.',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createCheckout,
  getAccessStatus,
  simulatePayment,
  confirmTransaction,
  handleMercadoPagoEvent,
};
