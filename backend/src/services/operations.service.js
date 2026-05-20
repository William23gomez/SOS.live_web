const { auth, db } = require('../config/firebase');
const authService = require('./auth.service');
const { geocodeLocation } = require('./location.service');

const ALERTS_COLLECTION = 'dashboard_alerts';
const MOBILE_NOTICES_COLLECTION = 'notices';
const NOTIFICATIONS_COLLECTION = 'dashboard_notifications';
const AGENTS_COLLECTION = 'dashboard_agents';
const AGENTS_MIRROR_COLLECTION = 'Agentes';
const HISTORY_COLLECTION = 'dashboard_history';
const USERS_COLLECTION = 'users';

const sortByRecent = (items) => {
  return [...items].sort((first, second) => {
    const firstValue =
      first.updatedAt || first.createdAt || first.hora || first.fecha || '';
    const secondValue =
      second.updatedAt || second.createdAt || second.hora || second.fecha || '';

    return String(secondValue).localeCompare(String(firstValue));
  });
};

const buildDateLabel = () => {
  return new Date().toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const buildDateLabelFromValue = (value) => {
  const resolvedDate = resolveDateValue(value);

  if (!resolvedDate) {
    return buildDateLabel();
  }

  return resolvedDate.toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const buildRelativeLabel = () => 'Hace unos segundos';

const normalizeAgentCode = (value) =>
  String(value || '')
    .trim()
    .toUpperCase();

const normalizeAgentUsername = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const buildAgentInternalEmail = (codigo, usuario) => {
  const seed = `${codigo}_${usuario}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `${seed || `agent_${Date.now()}`}@sos.live`;
};

const resolveDateValue = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value.toDate === 'function') {
    const timestampDate = value.toDate();
    return Number.isNaN(timestampDate.getTime()) ? null : timestampDate;
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const formatMobileLocation = (notice) => {
  const exactAddress = String(
    notice?.direccionExacta || notice?.ubicacion?.direccionExacta || ''
  ).trim();

  if (exactAddress) {
    return exactAddress;
  }

  const lat = Number(notice?.ubicacion?.lat);
  const lng = Number(notice?.ubicacion?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return 'Ubicacion compartida desde SOS movil';
  }

  return `Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)}`;
};

const buildMobileMapLocation = (location) => {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    lat,
    lng,
    label: 'Ubicacion SOS movil',
    query: `${lat},${lng}`,
    source: 'geocoded',
  };
};

const normalizeAlertStatus = (status) => {
  if (status === 'Nueva') {
    return 'En proceso';
  }

  if (status === 'Asignada') {
    return 'Asignado';
  }

  return status;
};

const buildHistoryDuration = (createdAt, finishedAt) => {
  if (!createdAt || !finishedAt) {
    return 'Sin dato';
  }

  const start = new Date(createdAt).getTime();
  const end = new Date(finishedAt).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 'Menos de 1 min';
  }

  const totalMinutes = Math.max(1, Math.round((end - start) / 60000));

  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!minutes) {
    return `${hours} h`;
  }

  return `${hours} h ${minutes} min`;
};

const buildMobileAlertFromNotice = (noticeId, notice, userName) => {
  const createdAt = resolveDateValue(notice.timestamp)?.toISOString() || new Date().toISOString();
  const descripcion =
    typeof notice.mensaje === 'string' && notice.mensaje.trim()
      ? notice.mensaje.trim()
      : 'Alerta SOS creada desde la app movil.';

  return {
    id: noticeId,
    usuario: userName || notice.creadoPor || 'Usuario movil SOS',
    tipo: 'SOS movil',
    ubicacion: formatMobileLocation(notice),
    hora: buildDateLabelFromValue(notice.timestamp),
    prioridad: 'Alta',
    estado: 'En proceso',
    agenteAsignado: 'Sin asignar',
    descripcion,
    mapa: buildMobileMapLocation(notice.ubicacion),
    createdAt,
    updatedAt: createdAt,
    createdBy: notice.creadoPor || null,
    source: 'mobile_notice',
    sourceNoticeId: noticeId,
  };
};

const listMobileSosAlerts = async () => {
  const snapshot = await db.collection(MOBILE_NOTICES_COLLECTION).where('tipo', '==', 'sos').get();

  if (snapshot.empty) {
    return [];
  }

  const creatorIds = [
    ...new Set(
      snapshot.docs
        .map((doc) => doc.data()?.creadoPor)
        .filter((value) => typeof value === 'string' && value.trim())
    ),
  ];

  const creatorDocs = await Promise.all(
    creatorIds.map(async (creatorId) => {
      try {
        const userDoc = await db.collection(USERS_COLLECTION).doc(creatorId).get();
        return [creatorId, userDoc.exists ? userDoc.data() : null];
      } catch (error) {
        return [creatorId, null];
      }
    })
  );

  const usersById = new Map(creatorDocs);

  return snapshot.docs.map((doc) => {
    const notice = doc.data() || {};
    const userData = usersById.get(notice.creadoPor) || {};
    const userName =
      typeof userData.nombre === 'string' && userData.nombre.trim()
        ? userData.nombre.trim()
        : typeof userData.email === 'string' && userData.email.trim()
          ? userData.email.trim()
          : '';

    return buildMobileAlertFromNotice(doc.id, notice, userName);
  });
};

const createAlert = async (userId, payload) => {
  const tipo = String(payload.tipo || '').trim();
  const ubicacion = String(payload.ubicacion || '').trim();
  const prioridad = String(payload.prioridad || '').trim();
  const descripcion = String(payload.descripcion || '').trim();

  if (!tipo || !ubicacion || !prioridad || !descripcion) {
    const error = new Error('Completa tipo, ubicacion, prioridad y descripcion de la alerta.');
    error.statusCode = 400;
    throw error;
  }

  const profile = await authService.getProfile(userId);
  const alertId = `ALT-${Date.now()}`;
  const notificationId = `NOT-${Date.now()}`;
  const mapa = await geocodeLocation(ubicacion, { type: 'address' });

  const alert = {
    id: alertId,
    usuario: profile.nombre,
    tipo,
    ubicacion,
    hora: buildDateLabel(),
    prioridad,
    estado: 'En proceso',
    agenteAsignado: 'Sin asignar',
    descripcion,
    mapa,
    createdAt: new Date().toISOString(),
    createdBy: userId,
  };

  const notification = {
    id: notificationId,
    titulo: `Nueva alerta de ${tipo.toLowerCase()}`,
    descripcion: `${profile.nombre} registro una alerta en ${ubicacion}`,
    tiempo: buildRelativeLabel(),
    tipo: prioridad === 'Alta' ? 'danger' : 'info',
    leida: false,
    relatedAlertId: alertId,
    createdAt: new Date().toISOString(),
  };

  await Promise.all([
    db.collection(ALERTS_COLLECTION).doc(alertId).set(alert),
    db.collection(NOTIFICATIONS_COLLECTION).doc(notificationId).set(notification),
  ]);

  return { alert, notification };
};

const listAlerts = async () => {
  const [dashboardSnapshot, mobileAlerts] = await Promise.all([
    db.collection(ALERTS_COLLECTION).get(),
    listMobileSosAlerts(),
  ]);

  const alertsById = new Map(mobileAlerts.map((alert) => [alert.id, alert]));

  dashboardSnapshot.docs.forEach((doc) => {
    const alert = doc.data();
    alertsById.set(alert.id || doc.id, alert);
  });

  return sortByRecent(Array.from(alertsById.values()));
};

const listAgents = async () => {
  const snapshot = await db.collection(AGENTS_COLLECTION).get();
  return sortByRecent(snapshot.docs.map((doc) => doc.data()));
};

const listNotifications = async () => {
  const snapshot = await db.collection(NOTIFICATIONS_COLLECTION).get();
  return sortByRecent(snapshot.docs.map((doc) => doc.data()));
};

const createAgent = async (userId, payload) => {
  const nombre = String(payload.nombre || '').trim();
  const usuario = normalizeAgentUsername(payload.usuario);
  const password = String(payload.password || '').trim();
  const zona = String(payload.zona || '').trim();
  const telefono = String(payload.telefono || '').trim();
  const codigo = normalizeAgentCode(payload.codigo);
  const email = payload.email;

  if (!nombre || !usuario || !password || !codigo || !zona || !telefono) {
    const error = new Error('Completa nombre, usuario, contraseña, codigo, zona y telefono.');
    error.statusCode = 400;
    throw error;
  }

  if (!/^[a-z0-9._-]{4,}$/.test(usuario)) {
    const error = new Error(
      'El usuario del agente debe tener minimo 4 caracteres y solo puede usar letras, numeros, punto, guion o guion bajo.'
    );
    error.statusCode = 400;
    throw error;
  }

  if (!/^\d+$/.test(telefono)) {
    const error = new Error('El telefono del agente solo puede contener numeros.');
    error.statusCode = 400;
    throw error;
  }

  if (password.length < 6) {
    const error = new Error('La contraseña del agente debe tener al menos 6 caracteres.');
    error.statusCode = 400;
    throw error;
  }

  const agentCodigo = codigo;
  const existingAgentDoc = await db.collection(AGENTS_COLLECTION).doc(agentCodigo).get();

  if (existingAgentDoc.exists) {
    const error = new Error('Ya existe un agente registrado con ese codigo.');
    error.statusCode = 409;
    throw error;
  }

  const agentEmail = email?.trim().toLowerCase() || buildAgentInternalEmail(agentCodigo, usuario);
  const mapa = await geocodeLocation(zona, { type: 'zone' });

  let userRecord;
  try {
    userRecord = await auth.createUser({
      email: agentEmail,
      password,
      displayName: nombre,
      emailVerified: true,
    });

    const now = new Date().toISOString();
    const agent = {
      codigo: agentCodigo,
      usuario,
      nombre,
      email: agentEmail,
      zona,
      telefono,
      estado: 'Disponible',
      mapa,
      uid: userRecord.uid,
      createdBy: userId,
      createdAt: now,
    };

    const mobileProfile = {
      name: nombre,
      nombre,
      email: agentEmail,
      role: 'agente',
      type: 'agente',
      age: null,
      gender: null,
      bloodType: null,
      agentCode: agentCodigo,
      agentUsername: usuario,
      linkedCompanyId: userId,
      createdAt: now,
      createdBy: userId,
    };

    await Promise.all([
      db.collection(AGENTS_COLLECTION).doc(agentCodigo).set(agent),
      db.collection(AGENTS_MIRROR_COLLECTION).doc(agentCodigo).set(agent),
      db.collection(USERS_COLLECTION).doc(userRecord.uid).set(mobileProfile, { merge: true }),
    ]);

    return agent;
  } catch (error) {
    if (userRecord?.uid) {
      await auth.deleteUser(userRecord.uid).catch(() => {});
    }

    throw error;
  }
};

const resolveAgentAccess = async (payload) => {
  const codigo = normalizeAgentCode(payload.codigo);
  const usuario = normalizeAgentUsername(payload.usuario);

  if (!codigo || !usuario) {
    const error = new Error('Debes ingresar el codigo y usuario del agente.');
    error.statusCode = 400;
    throw error;
  }

  const agentDoc = await db.collection(AGENTS_COLLECTION).doc(codigo).get();

  if (!agentDoc.exists) {
    const error = new Error('No encontramos un agente con ese codigo y usuario.');
    error.statusCode = 404;
    throw error;
  }

  const agent = agentDoc.data();

  if (normalizeAgentUsername(agent?.usuario) !== usuario || !agent?.email) {
    const error = new Error('No encontramos un agente con ese codigo y usuario.');
    error.statusCode = 404;
    throw error;
  }

  return {
    email: agent.email,
    agent: {
      codigo: agent.codigo,
      usuario: agent.usuario,
      nombre: agent.nombre,
      zona: agent.zona,
      telefono: agent.telefono,
      estado: agent.estado,
      uid: agent.uid,
    },
  };
};

const deleteAgent = async (codigo) => {
  const normalizedCodigo = normalizeAgentCode(codigo);
  const agentRef = db.collection(AGENTS_COLLECTION).doc(normalizedCodigo);
  const agentDoc = await agentRef.get();

  if (!agentDoc.exists) {
    const error = new Error('Agente no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  const agent = agentDoc.data();

  // Delete Firebase user
  if (agent.uid) {
    await auth.deleteUser(agent.uid);
  }

  // Delete from collections
  const deleteOperations = [
    agentRef.delete(),
    db.collection(AGENTS_MIRROR_COLLECTION).doc(normalizedCodigo).delete(),
  ];

  if (agent.uid) {
    deleteOperations.push(db.collection(USERS_COLLECTION).doc(agent.uid).delete());
  }

  await Promise.all(deleteOperations);
};

const assignAgentToAlert = async (alertId, agentCode, payload = {}) => {
  if (!alertId || !agentCode) {
    const error = new Error('Debes seleccionar una alerta y un agente.');
    error.statusCode = 400;
    throw error;
  }

  const alertRef = db.collection(ALERTS_COLLECTION).doc(alertId);
  const agentRef = db.collection(AGENTS_COLLECTION).doc(agentCode);

  const [alertDoc, agentDoc] = await Promise.all([alertRef.get(), agentRef.get()]);

  const alert =
    alertDoc.exists
      ? alertDoc.data()
      : {
          ...(payload.alert || {}),
          id: alertId,
          estado: 'En proceso',
          agenteAsignado: 'Sin asignar',
          createdAt: new Date().toISOString(),
        };

  const agent =
    agentDoc.exists
      ? agentDoc.data()
      : {
          ...(payload.agent || {}),
          codigo: agentCode,
          estado: 'Disponible',
          createdAt: new Date().toISOString(),
        };

  if (!alert.usuario || !alert.ubicacion) {
    const error = new Error('La alerta seleccionada no tiene datos suficientes para asignarse.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedAlertStatus = normalizeAlertStatus(alert.estado);

  if (normalizedAlertStatus === 'Finalizado' || normalizedAlertStatus === 'Cancelado') {
    const error = new Error(
      normalizedAlertStatus === 'Finalizado'
        ? 'No puedes asignar agentes a una alerta finalizada.'
        : 'No puedes asignar agentes a una alerta cancelada.'
    );
    error.statusCode = 409;
    throw error;
  }

  if (!agent.nombre) {
    const error = new Error('El agente seleccionado no tiene datos suficientes.');
    error.statusCode = 400;
    throw error;
  }

  if (agent.estado && agent.estado !== 'Disponible' && alert.agenteAsignado !== agent.nombre) {
    const error = new Error('El agente seleccionado no esta disponible para una nueva asignacion.');
    error.statusCode = 409;
    throw error;
  }

  const updatedAlert = {
    ...alert,
    agenteAsignado: agent.nombre,
    estado: 'Asignado',
    updatedAt: new Date().toISOString(),
  };

  const updatedAgent = {
    ...agent,
    estado: 'En servicio',
    updatedAt: new Date().toISOString(),
  };

  const notificationId = `NOT-${Date.now()}`;
  const notification = {
    id: notificationId,
    titulo: 'Agente asignado',
    descripcion: `${agent.nombre} fue asignado a la alerta ${alertId}`,
    tiempo: buildRelativeLabel(),
    tipo: 'info',
    leida: false,
    relatedAlertId: alertId,
    createdAt: new Date().toISOString(),
  };

  await Promise.all([
    alertRef.set(updatedAlert, { merge: true }),
    agentRef.set(updatedAgent, { merge: true }),
    db.collection(AGENTS_MIRROR_COLLECTION).doc(agentCode).set(updatedAgent, { merge: true }),
    db.collection(NOTIFICATIONS_COLLECTION).doc(notificationId).set(notification),
  ]);

  return { alert: updatedAlert, agent: updatedAgent };
};

const finalizeAlert = async (alertId, payload = {}) => {
  if (!alertId) {
    const error = new Error('Debes seleccionar una alerta.');
    error.statusCode = 400;
    throw error;
  }

  const alertRef = db.collection(ALERTS_COLLECTION).doc(alertId);
  const alertDoc = await alertRef.get();

  const alert =
    alertDoc.exists
      ? alertDoc.data()
      : {
          ...(payload.alert || {}),
          id: alertId,
          estado: 'En proceso',
          agenteAsignado: 'Sin asignar',
          createdAt: new Date().toISOString(),
        };

  if (!alert.usuario || !alert.ubicacion) {
    const error = new Error('La alerta seleccionada no tiene datos suficientes para finalizarse.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedAlertStatus = normalizeAlertStatus(alert.estado);

  if (normalizedAlertStatus === 'Finalizado') {
    const error = new Error('La alerta seleccionada ya fue finalizada.');
    error.statusCode = 409;
    throw error;
  }

  if (normalizedAlertStatus === 'Cancelado') {
    const error = new Error('No puedes finalizar una alerta cancelada.');
    error.statusCode = 409;
    throw error;
  }

  const updatedAlert = {
    ...alert,
    estado: 'Finalizado',
    updatedAt: new Date().toISOString(),
  };
  const finishedAt = updatedAlert.updatedAt;

  const tasks = [alertRef.set(updatedAlert, { merge: true })];

  if (alert.agenteAsignado && alert.agenteAsignado !== 'Sin asignar') {
    tasks.push(
      db
        .collection(AGENTS_COLLECTION)
        .where('nombre', '==', alert.agenteAsignado)
        .get()
        .then((snapshot) =>
          Promise.all(
            snapshot.docs.map((doc) =>
              Promise.all([
                doc.ref.set(
                  {
                    ...doc.data(),
                    estado: 'Disponible',
                    updatedAt: new Date().toISOString(),
                  },
                  { merge: true }
                ),
                db.collection(AGENTS_MIRROR_COLLECTION).doc(doc.id).set(
                  {
                    ...doc.data(),
                    estado: 'Disponible',
                    updatedAt: new Date().toISOString(),
                  },
                  { merge: true }
                ),
              ])
            )
          )
        )
    );
  }

  const notificationId = `NOT-${Date.now()}`;
  tasks.push(
    db.collection(NOTIFICATIONS_COLLECTION).doc(notificationId).set({
      id: notificationId,
      titulo: 'Servicio finalizado',
      descripcion: `La alerta ${alertId} fue marcada como finalizada`,
      tiempo: buildRelativeLabel(),
      tipo: 'success',
      leida: false,
      relatedAlertId: alertId,
      createdAt: new Date().toISOString(),
    })
  );

  const historyRecord = {
    id: `HIS-${Date.now()}`,
    usuario: alert.usuario,
    tipo: alert.tipo,
    fecha: finishedAt,
    duracion: buildHistoryDuration(alert.createdAt, finishedAt),
    estado: 'Completado',
    alertId,
    ubicacion: alert.ubicacion,
    agenteAsignado: alert.agenteAsignado,
    createdAt: finishedAt,
    updatedAt: finishedAt,
  };
  tasks.push(db.collection(HISTORY_COLLECTION).doc(historyRecord.id).set(historyRecord));

  await Promise.all(tasks);

  return { alert: updatedAlert };
};

const cancelAlert = async (alertId, payload = {}) => {
  if (!alertId) {
    const error = new Error('Debes seleccionar una alerta.');
    error.statusCode = 400;
    throw error;
  }

  const alertRef = db.collection(ALERTS_COLLECTION).doc(alertId);
  const alertDoc = await alertRef.get();

  const alert =
    alertDoc.exists
      ? alertDoc.data()
      : {
          ...(payload.alert || {}),
          id: alertId,
          estado: 'En proceso',
          agenteAsignado: 'Sin asignar',
          createdAt: new Date().toISOString(),
        };

  if (!alert.usuario || !alert.ubicacion) {
    const error = new Error('La alerta seleccionada no tiene datos suficientes para cancelarse.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedAlertStatus = normalizeAlertStatus(alert.estado);

  if (normalizedAlertStatus === 'Cancelado') {
    const error = new Error('La alerta seleccionada ya fue cancelada.');
    error.statusCode = 409;
    throw error;
  }

  if (normalizedAlertStatus === 'Finalizado') {
    const error = new Error('No puedes cancelar una alerta que ya fue finalizada.');
    error.statusCode = 409;
    throw error;
  }

  const updatedAlert = {
    ...alert,
    estado: 'Cancelado',
    updatedAt: new Date().toISOString(),
  };
  const finishedAt = updatedAlert.updatedAt;

  const tasks = [alertRef.set(updatedAlert, { merge: true })];

  if (alert.agenteAsignado && alert.agenteAsignado !== 'Sin asignar') {
    tasks.push(
      db
        .collection(AGENTS_COLLECTION)
        .where('nombre', '==', alert.agenteAsignado)
        .get()
        .then((snapshot) =>
          Promise.all(
            snapshot.docs.map((doc) =>
              Promise.all([
                doc.ref.set(
                  {
                    ...doc.data(),
                    estado: 'Disponible',
                    updatedAt: new Date().toISOString(),
                  },
                  { merge: true }
                ),
                db.collection(AGENTS_MIRROR_COLLECTION).doc(doc.id).set(
                  {
                    ...doc.data(),
                    estado: 'Disponible',
                    updatedAt: new Date().toISOString(),
                  },
                  { merge: true }
                ),
              ])
            )
          )
        )
    );
  }

  const notificationId = `NOT-${Date.now()}`;
  tasks.push(
    db.collection(NOTIFICATIONS_COLLECTION).doc(notificationId).set({
      id: notificationId,
      titulo: 'Servicio cancelado',
      descripcion: `La alerta ${alertId} fue marcada como cancelada`,
      tiempo: buildRelativeLabel(),
      tipo: 'danger',
      leida: false,
      relatedAlertId: alertId,
      createdAt: new Date().toISOString(),
    })
  );

  const historyRecord = {
    id: `HIS-${Date.now()}`,
    usuario: alert.usuario,
    tipo: alert.tipo,
    fecha: finishedAt,
    duracion: buildHistoryDuration(alert.createdAt, finishedAt),
    estado: 'Cancelado',
    alertId,
    ubicacion: alert.ubicacion,
    agenteAsignado: alert.agenteAsignado,
    createdAt: finishedAt,
    updatedAt: finishedAt,
  };
  tasks.push(db.collection(HISTORY_COLLECTION).doc(historyRecord.id).set(historyRecord));

  await Promise.all(tasks);

  return { alert: updatedAlert };
};

const updateAgentStatus = async (agentCode) => {
  if (!agentCode) {
    const error = new Error('Debes indicar el agente a actualizar.');
    error.statusCode = 400;
    throw error;
  }

  const agentRef = db.collection(AGENTS_COLLECTION).doc(agentCode);
  const agentDoc = await agentRef.get();

  if (!agentDoc.exists) {
    const error = new Error('El agente no existe.');
    error.statusCode = 404;
    throw error;
  }

  const agent = agentDoc.data();
  const updatedAgent = {
    ...agent,
    estado: agent.estado === 'Disponible' ? 'En servicio' : 'Disponible',
    updatedAt: new Date().toISOString(),
  };

  await Promise.all([
    agentRef.set(updatedAgent, { merge: true }),
    db.collection(AGENTS_MIRROR_COLLECTION).doc(agentCode).set(updatedAgent, { merge: true }),
  ]);

  return updatedAgent;
};

const markNotificationAsRead = async (notificationId) => {
  if (!notificationId) {
    const error = new Error('Debes indicar la notificacion.');
    error.statusCode = 400;
    throw error;
  }

  const notificationRef = db.collection(NOTIFICATIONS_COLLECTION).doc(notificationId);
  const notificationDoc = await notificationRef.get();

  if (!notificationDoc.exists) {
    const error = new Error('La notificacion no existe.');
    error.statusCode = 404;
    throw error;
  }

  await notificationRef.set(
    {
      ...notificationDoc.data(),
      leida: true,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
};

const markAllNotificationsAsRead = async () => {
  const snapshot = await db.collection(NOTIFICATIONS_COLLECTION).where('leida', '==', false).get();

  if (snapshot.empty) {
    return;
  }

  const tasks = snapshot.docs.map((doc) =>
    doc.ref.set(
      {
        ...doc.data(),
        leida: true,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    )
  );

  await Promise.all(tasks);
};

module.exports = {
  listAlerts,
  listAgents,
  listNotifications,
  createAlert,
  assignAgentToAlert,
  finalizeAlert,
  cancelAlert,
  resolveAgentAccess,
  updateAgentStatus,
  createAgent,
  deleteAgent,
  markNotificationAsRead,
  markAllNotificationsAsRead,
};
