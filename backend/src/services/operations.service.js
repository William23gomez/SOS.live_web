const { db } = require('../config/firebase');
const authService = require('./auth.service');

const ALERTS_COLLECTION = 'dashboard_alerts';
const NOTIFICATIONS_COLLECTION = 'dashboard_notifications';
const AGENTS_COLLECTION = 'dashboard_agents';
const AGENTS_MIRROR_COLLECTION = 'Agentes';
const HISTORY_COLLECTION = 'dashboard_history';

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

const buildRelativeLabel = () => 'Hace unos segundos';

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

const createAlert = async (userId, payload) => {
  const { tipo, ubicacion, prioridad, descripcion } = payload;

  if (!tipo || !ubicacion || !prioridad || !descripcion) {
    const error = new Error('Completa tipo, ubicacion, prioridad y descripcion de la alerta.');
    error.statusCode = 400;
    throw error;
  }

  const profile = await authService.getProfile(userId);
  const alertId = `ALT-${Date.now()}`;
  const notificationId = `NOT-${Date.now()}`;

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
  const snapshot = await db.collection(ALERTS_COLLECTION).get();
  return sortByRecent(snapshot.docs.map((doc) => doc.data()));
};

const listAgents = async () => {
  const snapshot = await db.collection(AGENTS_COLLECTION).get();
  return sortByRecent(snapshot.docs.map((doc) => doc.data()));
};

const listNotifications = async () => {
  const snapshot = await db.collection(NOTIFICATIONS_COLLECTION).get();
  return sortByRecent(snapshot.docs.map((doc) => doc.data()));
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

  if (!agent.nombre) {
    const error = new Error('El agente seleccionado no tiene datos suficientes.');
    error.statusCode = 400;
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

const createAgent = async (userId, payload) => {
  const { nombre, codigo, zona, telefono } = payload;

  if (!nombre || !codigo || !zona || !telefono) {
    const error = new Error('Completa nombre, codigo, zona y telefono del agente.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedCode = String(codigo).trim().toUpperCase();
  const normalizedPhone = String(telefono).trim();

  if (!/^\d+$/.test(normalizedPhone)) {
    const error = new Error('El telefono del agente solo puede contener numeros.');
    error.statusCode = 400;
    throw error;
  }

  const agentRef = db.collection(AGENTS_COLLECTION).doc(normalizedCode);
  const mirrorRef = db.collection(AGENTS_MIRROR_COLLECTION).doc(normalizedCode);
  const existingDoc = await agentRef.get();

  if (existingDoc.exists) {
    const error = new Error('Ya existe un agente con ese codigo.');
    error.statusCode = 409;
    throw error;
  }

  const agent = {
    codigo: normalizedCode,
    nombre: String(nombre).trim(),
    estado: 'Disponible',
    zona: String(zona).trim(),
    telefono: normalizedPhone,
    createdAt: new Date().toISOString(),
    createdBy: userId,
  };

  await Promise.all([
    agentRef.set(agent),
    mirrorRef.set(agent),
  ]);

  return agent;
};

const deleteAgent = async (agentCode) => {
  if (!agentCode) {
    const error = new Error('Debes indicar el agente a eliminar.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedCode = String(agentCode).trim().toUpperCase();
  const agentRef = db.collection(AGENTS_COLLECTION).doc(normalizedCode);
  const mirrorRef = db.collection(AGENTS_MIRROR_COLLECTION).doc(normalizedCode);
  const agentDoc = await agentRef.get();

  if (!agentDoc.exists) {
    const error = new Error('El agente no existe.');
    error.statusCode = 404;
    throw error;
  }

  await Promise.all([
    agentRef.delete(),
    mirrorRef.delete(),
  ]);
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
  updateAgentStatus,
  createAgent,
  deleteAgent,
  markNotificationAsRead,
  markAllNotificationsAsRead,
};
