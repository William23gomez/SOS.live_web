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

const getSetupStatus = async (_req, res, next) => {
  try {
    const result = paymentsService.getPaymentSetupStatus();

    res.status(200).json(result);
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

const listBilling = async (req, res, next) => {
  try {
    const payments = await paymentsService.listCompanyBilling(req.user.id);

    res.status(200).json({
      payments,
    });
  } catch (error) {
    next(error);
  }
};

const confirmTransaction = async (req, res, next) => {
  try {
    const result = await paymentsService.confirmTransaction(
      req.user.id,
      req.params.reference,
      req.body
    );

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

const handleMercadoPagoNotification = async (req, res, next) => {
  try {
    const result = await paymentsService.handleMercadoPagoNotification({
      ...req.query,
      ...req.body,
    });

    res.status(200).json({
      message: 'Confirmacion recibida.',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createCheckout,
  getSetupStatus,
  getAccessStatus,
  listBilling,
  simulatePayment,
  confirmTransaction,
  handleMercadoPagoNotification,
};
