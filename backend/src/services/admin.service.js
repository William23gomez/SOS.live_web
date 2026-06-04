const { db } = require('../config/firebase');

const USERS_COLLECTION = 'usuarios';
const COMPANIES_COLLECTION = 'Empresas';
const BILLING_COLLECTION = 'dashboard_billing';
const ALERTS_COLLECTION = 'dashboard_alerts';

const parseCurrency = (value) => {
  if (!value) {
    return 0;
  }

  const normalized = String(value).replace(/[^0-9]/g, '');
  return normalized ? Number(normalized) : 0;
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value);

const toDate = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value.toDate === 'function') {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const formatColombiaDateTime = (value) => {
  const date = toDate(value);

  if (!date) {
    return '';
  }

  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const resolveBillingDateValue = (payment = {}) =>
  payment.createdAt || payment.updatedAt || payment.fecha || null;

const buildAdminIdentitySet = (users = [], field) => {
  return new Set(
    users
      .filter((user) => user.rol === 'admin')
      .map((user) => String(user[field] || '').trim().toLowerCase())
      .filter(Boolean)
  );
};

const normalizeCompanies = (companies = [], users = []) => {
  const adminUids = buildAdminIdentitySet(users, 'uid');
  const adminEmails = buildAdminIdentitySet(users, 'email');

  return companies
    .filter((company) => {
      const uid = String(company.uid || '').trim().toLowerCase();
      const email = String(company.email || '').trim().toLowerCase();

      if (company.rol === 'admin') {
        return false;
      }

      if (uid && adminUids.has(uid)) {
        return false;
      }

      if (email && adminEmails.has(email)) {
        return false;
      }

      return true;
    })
    .map((company) => ({
      uid: company.uid,
      nombre: company.nombre,
      email: company.email,
      telefono: company.telefono,
      nit: company.nit,
      estado: company.estado || 'Aprobada',
      createdAt: company.createdAt || null,
    }))
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));
};

const listCompanies = async () => {
  const [usersSnapshot, companiesSnapshot] = await Promise.all([
    db.collection(USERS_COLLECTION).get(),
    db.collection(COMPANIES_COLLECTION).get(),
  ]);
  const users = usersSnapshot.docs.map((doc) => doc.data());
  const companies = companiesSnapshot.docs.map((doc) => doc.data());

  return normalizeCompanies(companies, users);
};

const listBilling = async () => {
  const snapshot = await db.collection(BILLING_COLLECTION).get();

  return snapshot.docs
    .map((doc) => {
      const payment = doc.data();
      const dateValue = resolveBillingDateValue(payment);

      return {
        id: doc.id,
        ...payment,
        fecha: formatColombiaDateTime(dateValue) || payment.fecha || '',
      };
    })
    .sort((a, b) => {
      const firstDate = toDate(resolveBillingDateValue(a))?.getTime() || 0;
      const secondDate = toDate(resolveBillingDateValue(b))?.getTime() || 0;

      return secondDate - firstDate;
    });
};

const getOverview = async () => {
  const [usersSnapshot, companiesSnapshot, billingSnapshot, alertsSnapshot] = await Promise.all([
    db.collection(USERS_COLLECTION).get(),
    db.collection(COMPANIES_COLLECTION).get(),
    db.collection(BILLING_COLLECTION).get(),
    db.collection(ALERTS_COLLECTION).get(),
  ]);

  const users = usersSnapshot.docs.map((doc) => doc.data());
  const companies = companiesSnapshot.docs.map((doc) => doc.data());
  const billingRows = billingSnapshot.docs.map((doc) => doc.data());
  const visibleCompanies = normalizeCompanies(companies, users);

  const companiesCount = visibleCompanies.length;
  const adminCount = users.filter((user) => user.rol === 'admin').length;
  const alertsCount = alertsSnapshot.size;
  const totalRevenue = billingRows.reduce((sum, row) => {
    return row.estado === 'Completado' ? sum + parseCurrency(row.monto) : sum;
  }, 0);
  const pendingPayments = billingRows.reduce((sum, row) => {
    return row.estado === 'Pendiente' ? sum + parseCurrency(row.monto) : sum;
  }, 0);

  return {
    companiesCount,
    adminCount,
    alertsCount,
    totalRevenue: formatCurrency(totalRevenue),
    pendingPayments: formatCurrency(pendingPayments),
  };
};

module.exports = {
  listCompanies,
  listBilling,
  getOverview,
};
