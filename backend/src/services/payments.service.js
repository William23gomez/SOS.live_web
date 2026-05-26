const crypto = require('crypto');

const { db } = require('../config/firebase');
const env = require('../config/env');

const USERS_COLLECTION = 'usuarios';
const COMPANIES_COLLECTION = 'Empresas';
const BILLING_COLLECTION = 'dashboard_billing';
const MERCADO_PAGO_API_BASE_URL = 'https://api.mercadopago.com';

const PAYMENT_STATUS_LABELS = {
  approved: 'Completado',
  authorized: 'Pendiente',
  in_process: 'Pendiente',
  pending: 'Pendiente',
  in_mediation: 'Pendiente',
  rejected: 'Rechazado',
  cancelled: 'Anulado',
  refunded: 'Anulado',
  charged_back: 'Anulado',
};

const PAYMENT_METHOD_LABELS = {
  credit_card: 'Tarjeta de credito',
  debit_card: 'Tarjeta debito',
  prepaid_card: 'Tarjeta prepago',
  account_money: 'Saldo Mercado Pago',
  bank_transfer: 'PSE',
  ticket: 'Efectivo',
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value);

const formatDate = (value = new Date()) =>
  new Intl.DateTimeFormat('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

const buildError = (message, statusCode = 400, code = 'payments/error') => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const validateMercadoPagoConfig = () => {
  if (!env.mercadoPagoAccessToken) {
    throw buildError(
      'Falta MERCADO_PAGO_ACCESS_TOKEN en el backend para iniciar pagos reales con Mercado Pago.',
      500,
      'payments/missing-mercado-pago-config'
    );
  }
};

const normalizeAmount = (value) => {
  const amount = Number(String(value || '').replace(/[^0-9.]/g, ''));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw buildError('Ingresa un monto valido para pagar.');
  }

  if (amount < 1000) {
    throw buildError('El monto minimo de prueba es $1.000 COP.');
  }

  return Math.round(amount);
};

const getPaymentStatusLabel = (status = '') =>
  PAYMENT_STATUS_LABELS[String(status).toLowerCase()] || 'Pendiente';

const getPaymentMethodLabel = (payment = {}, fallback = '') => {
  const methodType = String(payment.payment_type_id || payment.paymentTypeId || '').toLowerCase();
  const methodId = String(payment.payment_method_id || payment.paymentMethodId || '').toLowerCase();

  if (methodId === 'pse' || methodType === 'bank_transfer') {
    return 'PSE';
  }

  return PAYMENT_METHOD_LABELS[methodType] || fallback || 'Mercado Pago';
};

const getPaymentMethodPreferenceLabel = (method = '') => {
  if (method === 'card') {
    return 'Tarjeta credito/debito';
  }

  if (method === 'pse') {
    return 'PSE';
  }

  return 'Tarjeta / PSE';
};

const getSimulatedPaymentMethodLabel = (method = '') => {
  if (method === 'pse') {
    return 'PSE simulado';
  }

  if (method === 'card') {
    return 'Tarjeta simulada';
  }

  return 'Checkout simulado';
};

const getRedirectUrl = () => {
  const configuredUrl = String(env.mercadoPagoRedirectUrl || '').trim();

  if (configuredUrl) {
    return configuredUrl;
  }

  const frontendUrl = String(env.frontendUrl || '').replace(/\/+$/, '');
  const publicAppUrl = String(env.publicAppUrl || '').replace(/\/+$/, '');
  const baseUrl = frontendUrl && !frontendUrl.includes('localhost') ? frontendUrl : publicAppUrl;

  return `${baseUrl || 'http://localhost:4200'}/pagos`;
};

const getNotificationUrl = () => {
  const configuredUrl = String(env.mercadoPagoNotificationUrl || '').trim();

  if (configuredUrl) {
    return configuredUrl;
  }

  const publicBackendUrl = String(env.publicBackendUrl || '').replace(/\/+$/, '');

  return publicBackendUrl ? `${publicBackendUrl}/api/payments/mercadopago/events` : '';
};

const buildReference = (userId) => {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `SOS-${Date.now()}-${String(userId || '').slice(0, 6).toUpperCase()}-${suffix}`;
};

const getPayerProfile = async (userId) => {
  const [userDoc, companyDoc] = await Promise.all([
    db.collection(USERS_COLLECTION).doc(userId).get(),
    db.collection(COMPANIES_COLLECTION).doc(userId).get(),
  ]);
  const user = userDoc.exists ? userDoc.data() : {};
  const company = companyDoc.exists ? companyDoc.data() : {};
  const profile = {
    ...company,
    ...user,
  };

  return {
    uid: profile.uid || userId,
    nombre: profile.nombre || profile.name || 'Empresa SOS.LIVE',
    email: profile.email || '',
    telefono: profile.telefono || '',
    nit: profile.nit || '',
  };
};

const splitName = (fullName = '') => {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);

  return {
    name: parts.slice(0, 2).join(' ') || 'Empresa',
    surname: parts.slice(2).join(' ') || 'SOS.LIVE',
  };
};

const buildPaymentMethods = (method = 'checkout') => {
  if (method === 'pse') {
    return {
      excluded_payment_types: [{ id: 'ticket' }],
      default_payment_method_id: 'pse',
      installments: 1,
    };
  }

  if (method === 'card') {
    return {
      excluded_payment_types: [{ id: 'ticket' }, { id: 'bank_transfer' }],
      installments: 12,
    };
  }

  return {
    excluded_payment_types: [{ id: 'ticket' }],
    installments: 12,
  };
};

const mercadoPagoFetch = async (path, options = {}) => {
  validateMercadoPagoConfig();

  const response = await fetch(`${MERCADO_PAGO_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.mercadoPagoAccessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data.message ||
      data.error ||
      data.cause?.[0]?.description ||
      'No fue posible procesar el pago con Mercado Pago.';

    throw buildError(message, response.status || 400, 'payments/mercado-pago-request-failed');
  }

  return data;
};

const buildPreferenceBody = ({ amount, concept, reference, payer, method }) => {
  const redirectUrl = getRedirectUrl();
  const notificationUrl = getNotificationUrl();
  const { name, surname } = splitName(payer.nombre);
  const body = {
    items: [
      {
        id: reference,
        title: String(concept || 'Pago SOS.LIVE').trim(),
        description: 'Servicio SOS.LIVE',
        quantity: 1,
        currency_id: 'COP',
        unit_price: amount,
      },
    ],
    payer: {
      name,
      surname,
      email: payer.email || undefined,
      phone: payer.telefono ? { number: payer.telefono } : undefined,
      identification: payer.nit ? { type: 'NIT', number: payer.nit } : undefined,
    },
    payment_methods: buildPaymentMethods(method),
    back_urls: {
      success: redirectUrl,
      pending: redirectUrl,
      failure: redirectUrl,
    },
    auto_return: 'approved',
    external_reference: reference,
    statement_descriptor: 'SOS LIVE',
    metadata: {
      company_uid: payer.uid,
      method_preference: method,
    },
  };

  if (notificationUrl) {
    body.notification_url = notificationUrl;
  }

  return body;
};

const createCheckout = async (userId, { amount, concept = '', method = 'checkout' }) => {
  const normalizedAmount = normalizeAmount(amount);
  const payer = await getPayerProfile(userId);
  const reference = buildReference(userId);
  const now = new Date().toISOString();
  const preference = await mercadoPagoFetch('/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify(
      buildPreferenceBody({
        amount: normalizedAmount,
        concept,
        reference,
        payer,
        method,
      })
    ),
  });
  const checkoutUrl = preference.init_point || preference.sandbox_init_point;

  if (!checkoutUrl) {
    throw buildError('Mercado Pago no devolvio una URL de checkout valida.', 502);
  }

  const paymentRecord = {
    id: reference,
    reference,
    companyUid: userId,
    companyName: payer.nombre,
    companyEmail: payer.email,
    fecha: formatDate(now),
    metodo: getPaymentMethodPreferenceLabel(method),
    monto: formatCurrency(normalizedAmount),
    amount: normalizedAmount,
    amountInCents: normalizedAmount * 100,
    currency: 'COP',
    estado: 'Pendiente',
    mercadoPagoStatus: 'pending',
    provider: 'Mercado Pago',
    concept: String(concept || 'Pago SOS.LIVE').trim(),
    checkoutUrl,
    preferenceId: preference.id || '',
    createdAt: now,
    updatedAt: now,
  };

  await db.collection(BILLING_COLLECTION).doc(reference).set(paymentRecord, { merge: true });

  return {
    reference,
    checkoutUrl,
    payment: paymentRecord,
  };
};

const getAccessStatus = async (userId) => {
  const completedPaymentSnapshot = await db
    .collection(BILLING_COLLECTION)
    .where('companyUid', '==', userId)
    .where('estado', '==', 'Completado')
    .limit(1)
    .get();

  const payment = completedPaymentSnapshot.empty
    ? null
    : {
        id: completedPaymentSnapshot.docs[0].id,
        ...completedPaymentSnapshot.docs[0].data(),
      };

  return {
    hasActivePayment: Boolean(payment),
    payment,
  };
};

const requirePaymentAccess = async (userId) => {
  const accessStatus = await getAccessStatus(userId);

  if (!accessStatus.hasActivePayment) {
    throw buildError(
      'Debes registrar un pago para usar la plataforma SOS.LIVE.',
      402,
      'payments/payment-required'
    );
  }

  return accessStatus;
};

const simulatePayment = async (userId, { amount, concept = '', method = 'checkout' }) => {
  const normalizedAmount = normalizeAmount(amount);
  const payer = await getPayerProfile(userId);
  const reference = buildReference(userId);
  const now = new Date().toISOString();
  const transactionId = `SIM-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const paymentRecord = {
    id: reference,
    reference,
    transactionId,
    simulated: true,
    companyUid: userId,
    companyName: payer.nombre,
    companyEmail: payer.email,
    fecha: formatDate(now),
    metodo: getSimulatedPaymentMethodLabel(method),
    monto: formatCurrency(normalizedAmount),
    amount: normalizedAmount,
    amountInCents: normalizedAmount * 100,
    currency: 'COP',
    estado: 'Completado',
    mercadoPagoStatus: 'approved',
    mercadoPagoStatusDetail: 'simulated_payment',
    provider: 'Simulador SOS.LIVE',
    concept: String(concept || 'Pago SOS.LIVE').trim(),
    createdAt: now,
    updatedAt: now,
    rawStatusMessage: 'Pago aprobado en modo simulacion',
  };

  await db.collection(BILLING_COLLECTION).doc(reference).set(paymentRecord, { merge: true });

  return {
    reference,
    transaction: {
      id: transactionId,
      status: 'approved',
      status_detail: 'simulated_payment',
      external_reference: reference,
      transaction_amount: normalizedAmount,
      currency_id: 'COP',
      payment_method_id: method === 'pse' ? 'pse' : 'simulated_card',
      payment_type_id: method === 'pse' ? 'bank_transfer' : 'credit_card',
    },
    payment: paymentRecord,
  };
};

const fetchMercadoPagoPayment = async (paymentId) => {
  const normalizedPaymentId = String(paymentId || '').trim();

  if (!normalizedPaymentId) {
    throw buildError('No se recibio el id de pago de Mercado Pago.');
  }

  return mercadoPagoFetch(`/v1/payments/${encodeURIComponent(normalizedPaymentId)}`);
};

const updatePaymentFromMercadoPago = async (payment = {}) => {
  const reference = String(payment.external_reference || payment.externalReference || '').trim();

  if (!reference) {
    throw buildError('El pago de Mercado Pago no trae referencia externa.', 400);
  }

  const snapshot = await db.collection(BILLING_COLLECTION).where('reference', '==', reference).limit(1).get();
  const paymentRef = snapshot.empty
    ? db.collection(BILLING_COLLECTION).doc(reference)
    : snapshot.docs[0].ref;
  const existing = snapshot.empty ? {} : snapshot.docs[0].data();
  const updatedAt = new Date().toISOString();
  const status = String(payment.status || 'pending').toLowerCase();
  const amount = Number(payment.transaction_amount || existing.amount || existing.amountInCents / 100 || 0);
  const methodLabel = getPaymentMethodLabel(payment, existing.metodo);
  const patch = {
    reference,
    transactionId: payment.id || existing.transactionId || '',
    mercadoPagoPaymentId: payment.id || existing.mercadoPagoPaymentId || '',
    mercadoPagoStatus: status,
    mercadoPagoStatusDetail: payment.status_detail || '',
    estado: getPaymentStatusLabel(status),
    metodo: methodLabel,
    amount,
    amountInCents: amount ? Math.round(amount * 100) : existing.amountInCents || 0,
    monto: amount ? formatCurrency(amount) : existing.monto || '$0',
    currency: payment.currency_id || existing.currency || 'COP',
    provider: 'Mercado Pago',
    fecha: existing.fecha || formatDate(updatedAt),
    updatedAt,
    rawStatusMessage: payment.status_detail || '',
  };

  await paymentRef.set(
    {
      ...patch,
      id: paymentRef.id,
      createdAt: existing.createdAt || updatedAt,
    },
    { merge: true }
  );

  const updatedDoc = await paymentRef.get();
  return {
    id: updatedDoc.id,
    ...updatedDoc.data(),
  };
};

const confirmTransaction = async (userId, paymentId) => {
  const paymentData = await fetchMercadoPagoPayment(paymentId);
  const payment = await updatePaymentFromMercadoPago(paymentData);

  if (payment.companyUid && payment.companyUid !== userId) {
    throw buildError('Este pago no pertenece a la cuenta activa.', 403);
  }

  return {
    transaction: paymentData,
    payment,
  };
};

const handleMercadoPagoEvent = async (payload = {}, query = {}) => {
  const eventType = payload.type || query.type || query.topic || '';
  const paymentId = payload.data?.id || payload.id || query['data.id'] || query.id;

  if (!paymentId || !String(eventType).includes('payment')) {
    return {
      ignored: true,
    };
  }

  const paymentData = await fetchMercadoPagoPayment(paymentId);
  const payment = await updatePaymentFromMercadoPago(paymentData);

  return {
    ignored: false,
    payment,
  };
};

module.exports = {
  createCheckout,
  getAccessStatus,
  requirePaymentAccess,
  simulatePayment,
  confirmTransaction,
  handleMercadoPagoEvent,
};
