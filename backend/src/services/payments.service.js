const crypto = require('crypto');

const { db } = require('../config/firebase');
const env = require('../config/env');

const USERS_COLLECTION = 'usuarios';
const COMPANIES_COLLECTION = 'Empresas';
const BILLING_COLLECTION = 'dashboard_billing';
const NOTIFICATIONS_COLLECTION = 'dashboard_notifications';
const HISTORY_COLLECTION = 'dashboard_history';
const MERCADO_PAGO_API_URL = 'https://api.mercadopago.com';

const MERCADO_PAGO_STATUS_LABELS = {
  approved: 'Completado',
  authorized: 'Pendiente',
  pending: 'Pendiente',
  in_process: 'Pendiente',
  in_mediation: 'Pendiente',
  rejected: 'Rechazado',
  cancelled: 'Anulado',
  refunded: 'Anulado',
  charged_back: 'Anulado',
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value);

const formatDate = (value = new Date()) =>
  new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

const sortBillingRows = (items) =>
  [...items].sort((first, second) =>
    String(second.updatedAt || second.createdAt || second.fecha || '').localeCompare(
      String(first.updatedAt || first.createdAt || first.fecha || '')
    )
  );

const buildError = (message, statusCode = 400, code = 'payments/error') => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
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

const getMercadoPagoConfig = () => ({
  accessToken: String(env.mercadoPagoAccessToken || '').trim(),
  publicKey: String(env.mercadoPagoPublicKey || '').trim(),
});

const validateMercadoPagoConfig = () => {
  const config = getMercadoPagoConfig();

  if (!config.accessToken || config.accessToken.startsWith('tu_')) {
    throw buildError(
      'Falta configurar MERCADO_PAGO_ACCESS_TOKEN en el backend para habilitar pagos reales con Mercado Pago.',
      500,
      'payments/missing-mercadopago-config'
    );
  }

  return config;
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

const getPaymentSetupStatus = () => {
  const config = getMercadoPagoConfig();
  const realPaymentsEnabled = Boolean(config.accessToken && !config.accessToken.startsWith('tu_'));

  return {
    paymentProvider: 'Mercado Pago',
    realPaymentsEnabled,
    simulationEnabled: !realPaymentsEnabled,
    supportedMethods: ['card', 'pse', 'checkout'],
    redirectUrl: getRedirectUrl(),
    notificationUrl: getNotificationUrl(),
    webhookSignatureValidationEnabled: false,
    checkoutUrl: 'https://www.mercadopago.com.co/checkout',
    environment: config.accessToken.startsWith('TEST-') ? 'sandbox' : 'production',
    message: realPaymentsEnabled
      ? 'Pagos activos con Mercado Pago para tarjetas, PSE y Checkout Pro.'
      : 'Modo simulacion activo. Crea una cuenta de Mercado Pago y configura MERCADO_PAGO_ACCESS_TOKEN para habilitar cobros reales.',
  };
};

const getPaymentMethodPreferenceLabel = (method = '') => {
  if (method === 'card') {
    return 'Tarjeta Mercado Pago';
  }

  if (method === 'pse') {
    return 'PSE Mercado Pago';
  }

  return 'Checkout Mercado Pago';
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

const buildRelativeLabel = () => 'Hace unos segundos';

const buildScopedRecord = (record = {}, companyUid) => ({
  ...record,
  companyUid,
  createdBy: record.createdBy || companyUid,
});

const recordPaymentEvent = async (payment = {}, eventType = 'pending') => {
  const companyUid = String(payment.companyUid || '').trim();
  const reference = String(payment.reference || payment.id || '').trim();

  if (!companyUid || !reference) {
    return;
  }

  const now = new Date().toISOString();
  const isCompleted = eventType === 'completed';
  const notificationId = `PAY-NOT-${reference}-${eventType}`;
  const historyId = `PAY-HIST-${reference}-${eventType}`;
  const amountLabel = payment.monto || formatCurrency(Number(payment.amount || 0));
  const methodLabel = payment.metodo || 'Pago SOS.LIVE';
  const concept = payment.concept || 'Pago SOS.LIVE';

  const notification = buildScopedRecord(
    {
      id: notificationId,
      titulo: isCompleted ? 'Pago registrado' : 'Pago pendiente',
      descripcion: isCompleted
        ? `Se registro un pago de ${amountLabel} por ${methodLabel}.`
        : `Hay un pago pendiente de ${amountLabel} por ${concept}.`,
      tiempo: buildRelativeLabel(),
      tipo: isCompleted ? 'success' : 'info',
      leida: false,
      relatedPaymentId: reference,
      createdAt: now,
      updatedAt: now,
    },
    companyUid
  );

  const history = buildScopedRecord(
    {
      id: historyId,
      usuario: payment.companyName || 'Empresa',
      tipo: isCompleted ? 'Pago completado' : 'Pago pendiente',
      fecha: payment.fecha || formatDate(now),
      duracion: isCompleted ? 'Pago confirmado' : 'En conciliacion',
      estado: isCompleted ? 'Completado' : 'Pendiente',
      paymentId: reference,
      createdAt: now,
      updatedAt: now,
    },
    companyUid
  );

  await Promise.all([
    db.collection(NOTIFICATIONS_COLLECTION).doc(notificationId).set(notification, { merge: true }),
    db.collection(HISTORY_COLLECTION).doc(historyId).set(history, { merge: true }),
  ]);
};

const normalizeSimulationCard = (card = {}) => {
  const cardholderName = String(card.cardholderName || '').trim().replace(/\s{2,}/g, ' ');
  const cardLast4 = String(card.cardLast4 || '').replace(/\D/g, '').slice(-4);
  const cardBrand = String(card.cardBrand || 'Tarjeta').trim();
  const cardExpiry = String(card.cardExpiry || '').trim();
  const cardDocument = String(card.cardDocument || '').replace(/\D/g, '').trim();

  if (
    !/^[a-zA-ZÀ-ÿÑñ\s]+$/.test(cardholderName) ||
    cardLast4.length !== 4 ||
    !cardExpiry ||
    cardDocument.length < 5
  ) {
    return null;
  }

  return {
    cardholderName,
    cardLast4,
    cardBrand,
    cardExpiry,
    cardDocument,
  };
};

const buildReference = (userId) => {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  const userSegment = String(userId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
  return `SOS${Date.now()}${userSegment}${suffix}`;
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

const mercadoPagoRequest = async (path, options = {}) => {
  const config = validateMercadoPagoConfig();
  const response = await fetch(`${MERCADO_PAGO_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw buildError(
      data.message || data.error || 'Mercado Pago no pudo procesar la solicitud.',
      response.status,
      'payments/mercadopago-error'
    );
  }

  return data;
};

const createPreference = async ({ amount, concept, reference, payer, method }) => {
  const redirectUrl = getRedirectUrl();
  const notificationUrl = getNotificationUrl();
  const preferencePayload = {
    items: [
      {
        id: reference,
        title: String(concept || 'Pago SOS.LIVE').trim(),
        description: getPaymentMethodPreferenceLabel(method),
        quantity: 1,
        currency_id: 'COP',
        unit_price: amount,
      },
    ],
    external_reference: reference,
    back_urls: {
      success: redirectUrl,
      pending: redirectUrl,
      failure: redirectUrl,
    },
    auto_return: 'approved',
    metadata: {
      companyUid: payer.uid,
      method,
    },
    statement_descriptor: 'SOSLIVE',
  };

  if (notificationUrl) {
    preferencePayload.notification_url = notificationUrl;
  }

  return mercadoPagoRequest('/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify(preferencePayload),
  });
};

const createCheckout = async (userId, { amount, concept = '', method = 'checkout' }) => {
  const normalizedAmount = normalizeAmount(amount);
  const payer = await getPayerProfile(userId);
  const reference = buildReference(userId);
  const now = new Date().toISOString();
  const preference = await createPreference({
    amount: normalizedAmount,
    concept,
    reference,
    payer,
    method,
  });
  const isSandboxToken = getMercadoPagoConfig().accessToken.startsWith('TEST-');
  const checkoutUrl = isSandboxToken
    ? preference.sandbox_init_point || preference.init_point || ''
    : preference.init_point || preference.sandbox_init_point || '';
  const paymentRecord = {
    id: reference,
    reference,
    preferenceId: preference.id || '',
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
    checkoutForm: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection(BILLING_COLLECTION).doc(reference).set(paymentRecord, { merge: true });
  await recordPaymentEvent(paymentRecord, 'pending');

  return {
    reference,
    checkoutUrl,
    checkoutForm: null,
    preference,
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

const listCompanyBilling = async (userId) => {
  const snapshot = await db.collection(BILLING_COLLECTION).where('companyUid', '==', userId).get();

  return sortBillingRows(
    snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      fecha: formatDate(doc.data().createdAt || doc.data().updatedAt || doc.data().fecha),
    }))
  );
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

const simulatePayment = async (userId, { amount, concept = '', method = 'checkout', simulationCard = null }) => {
  const normalizedAmount = normalizeAmount(amount);
  const payer = await getPayerProfile(userId);
  const card = normalizeSimulationCard(simulationCard);
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
    simulatedCard: card
      ? {
          cardholderName: card.cardholderName,
          cardLast4: card.cardLast4,
          cardBrand: card.cardBrand,
          cardExpiry: card.cardExpiry,
          cardDocument: card.cardDocument,
        }
      : null,
    createdAt: now,
    updatedAt: now,
    rawStatusMessage: 'Pago aprobado en modo simulacion',
  };

  await db.collection(BILLING_COLLECTION).doc(reference).set(paymentRecord, { merge: true });
  await recordPaymentEvent(paymentRecord, 'completed');

  return {
    reference,
    transaction: {
      id: transactionId,
      status: 'approved',
      status_detail: 'simulated_payment',
      external_reference: reference,
      transaction_amount: normalizedAmount,
      currency_id: 'COP',
    },
    payment: paymentRecord,
  };
};

const findPaymentRefByReference = async (reference) => {
  const snapshot = await db
    .collection(BILLING_COLLECTION)
    .where('reference', '==', reference)
    .limit(1)
    .get();

  return snapshot.empty ? db.collection(BILLING_COLLECTION).doc(reference) : snapshot.docs[0].ref;
};

const updatePaymentFromMercadoPago = async (transaction = {}) => {
  const reference = String(transaction.external_reference || '').trim();

  if (!reference) {
    return null;
  }

  const paymentRef = await findPaymentRefByReference(reference);
  const existingDoc = await paymentRef.get();
  const existing = existingDoc.exists ? existingDoc.data() : {};
  const updatedAt = new Date().toISOString();
  const status = String(transaction.status || existing.mercadoPagoStatus || 'pending');
  const amount = Number(transaction.transaction_amount || existing.amount || 0);
  const patch = {
    reference,
    transactionId: String(transaction.id || existing.transactionId || ''),
    mercadoPagoPaymentId: String(transaction.id || existing.mercadoPagoPaymentId || ''),
    mercadoPagoStatus: status,
    mercadoPagoStatusDetail: String(transaction.status_detail || existing.mercadoPagoStatusDetail || ''),
    estado: MERCADO_PAGO_STATUS_LABELS[status] || 'Pendiente',
    metodo:
      transaction.payment_method_id ||
      transaction.payment_type_id ||
      existing.metodo ||
      'Mercado Pago',
    amount,
    amountInCents: amount ? Math.round(amount * 100) : existing.amountInCents || 0,
    monto: amount ? formatCurrency(amount) : existing.monto || '$0',
    currency: transaction.currency_id || existing.currency || 'COP',
    provider: 'Mercado Pago',
    fecha: formatDate(existing.createdAt || updatedAt),
    updatedAt,
    rawStatusMessage: transaction.status_detail || '',
    mercadoPagoPayload: transaction,
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
  const updatedPayment = {
    id: updatedDoc.id,
    ...updatedDoc.data(),
  };

  if (updatedPayment.estado === 'Completado') {
    await recordPaymentEvent(updatedPayment, 'completed');
  } else if (updatedPayment.estado === 'Pendiente') {
    await recordPaymentEvent(updatedPayment, 'pending');
  }

  return updatedPayment;
};

const getMercadoPagoPayment = async (paymentId) =>
  mercadoPagoRequest(`/v1/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
  });

const confirmTransaction = async (userId, paymentId, payload = {}) => {
  const transaction = await getMercadoPagoPayment(paymentId);
  const payment = await updatePaymentFromMercadoPago({
    ...transaction,
    external_reference: transaction.external_reference || payload.external_reference || payload.reference,
  });

  if (!payment) {
    throw buildError('Mercado Pago no retorno una referencia para conciliar el pago.', 400);
  }

  if (payment.companyUid && payment.companyUid !== userId) {
    throw buildError('Este pago no pertenece a la cuenta activa.', 403);
  }

  return {
    transaction,
    payment,
  };
};

const handleMercadoPagoNotification = async (payload = {}) => {
  const paymentId = String(
    payload.id || payload['data.id'] || payload.payment_id || payload.collection_id || ''
  ).trim();
  const type = String(payload.type || payload.topic || '').toLowerCase();

  if (!paymentId || (type && !['payment', 'merchant_order'].includes(type))) {
    return {
      ignored: true,
    };
  }

  if (type === 'merchant_order') {
    return {
      ignored: true,
    };
  }

  const transaction = await getMercadoPagoPayment(paymentId);
  const payment = await updatePaymentFromMercadoPago(transaction);

  return {
    ignored: !payment,
    payment,
  };
};

module.exports = {
  createCheckout,
  getPaymentSetupStatus,
  getAccessStatus,
  listCompanyBilling,
  requirePaymentAccess,
  simulatePayment,
  confirmTransaction,
  handleMercadoPagoNotification,
};
