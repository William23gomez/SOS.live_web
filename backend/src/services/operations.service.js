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

const normalizeCompanyUid = (value) => String(value || '').trim();

const resolveRecordCompanyCandidates = (record = {}) => {
  if (!record || typeof record !== 'object') {
    return [];
  }

  return [
    record.companyUid,
    record.linkedCompanyId,
    record.createdBy,
    record.companyId,
  ].map((value) => normalizeCompanyUid(value));
};

const belongsToCompany = (record = {}, companyUid) => {
  const normalizedCompanyUid = normalizeCompanyUid(companyUid);

  if (!normalizedCompanyUid) {
    return false;
  }

  return resolveRecordCompanyCandidates(record).some(
    (candidate) => candidate && candidate === normalizedCompanyUid
  );
};

const attachCompanyScope = (record = {}, companyUid, { defaultCreatedBy } = {}) => {
  const normalizedCompanyUid = normalizeCompanyUid(companyUid);

  if (!normalizedCompanyUid) {
    return { ...record };
  }

  return {
    ...record,
    companyUid: normalizedCompanyUid,
    ...(record.createdBy
      ? {}
      : normalizeCompanyUid(defaultCreatedBy)
        ? { createdBy: normalizeCompanyUid(defaultCreatedBy) }
        : {}),
  };
};

const buildOwnershipError = (entityName = 'registro') => {
  const error = new Error(`No tienes acceso a este ${entityName}.`);
  error.statusCode = 403;
  return error;
};

const assertCompanyOwnership = (record, companyUid, entityName = 'registro') => {
  if (!belongsToCompany(record, companyUid)) {
    throw buildOwnershipError(entityName);
  }
};

const maybeBackfillCompanyUid = async (collectionName, docId, record, companyUid) => {
  const normalizedCompanyUid = normalizeCompanyUid(companyUid);

  if (!collectionName || !docId || !normalizedCompanyUid) {
    return;
  }

  if (normalizeCompanyUid(record?.companyUid) === normalizedCompanyUid) {
    return;
  }

  await db
    .collection(collectionName)
    .doc(docId)
    .set(
      {
        companyUid: normalizedCompanyUid,
      },
      { merge: true }
    )
    .catch(() => {});
};

const normalizeServiceRating = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 1 || parsedValue > 5) {
    const error = new Error('La calificacion del servicio debe estar entre 1 y 5.');
    error.statusCode = 400;
    throw error;
  }

  return Math.round(parsedValue);
};

const readServiceRating = (value) => {
  try {
    return normalizeServiceRating(value);
  } catch {
    return null;
  }
};

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
    source: 'device',
    precision: 'exact',
  };
};

const toFiniteNumber = (value) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
};

const normalizeLocationText = (value = '') => String(value || '').trim();

const extractLocationPayload = (payload = {}) => {
  const nestedLocation =
    payload.location && typeof payload.location === 'object' ? payload.location : {};
  const nestedMap = payload.mapa && typeof payload.mapa === 'object' ? payload.mapa : {};

  return {
    lat: toFiniteNumber(
      payload.lat ??
        payload.latitude ??
        nestedLocation.lat ??
        nestedLocation.latitude ??
        nestedMap.lat
    ),
    lng: toFiniteNumber(
      payload.lng ??
        payload.longitude ??
        nestedLocation.lng ??
        nestedLocation.longitude ??
        nestedMap.lng
    ),
    exactAddress: normalizeLocationText(
      payload.ubicacionExacta ??
        payload.direccionExacta ??
        payload.address ??
        payload.label ??
        nestedLocation.ubicacionExacta ??
        nestedLocation.direccionExacta ??
        nestedLocation.address ??
        nestedLocation.label ??
        nestedMap.label ??
        nestedMap.query
    ),
  };
};

const hasCoordinates = (location) =>
  Number.isFinite(Number(location?.lat)) && Number.isFinite(Number(location?.lng));

const normalizeMapPrecision = (location) => {
  const precision = String(location?.precision || '')
    .trim()
    .toLowerCase();

  if (precision === 'exact') {
    return 'exact';
  }

  if (precision === 'approximate') {
    return 'approximate';
  }

  return null;
};

const isExactMapLocation = (location) => {
  if (!hasCoordinates(location)) {
    return false;
  }

  const precision = normalizeMapPrecision(location);

  if (precision) {
    return precision === 'exact';
  }

  return location?.source === 'device';
};

const areMapLocationsEquivalent = (first, second) => {
  if (!first && !second) {
    return true;
  }

  if (!first || !second) {
    return false;
  }

  return (
    Number(first.lat).toFixed(6) === Number(second.lat).toFixed(6) &&
    Number(first.lng).toFixed(6) === Number(second.lng).toFixed(6) &&
    String(first.label || '') === String(second.label || '') &&
    String(first.query || '') === String(second.query || '') &&
    String(first.source || '') === String(second.source || '') &&
    String(first.precision || '') === String(second.precision || '') &&
    String(first.matchType || '') === String(second.matchType || '')
  );
};

const buildCoordinateMapLocation = ({ lat, lng, exactAddress }) => {
  const resolvedLat = Number(lat);
  const resolvedLng = Number(lng);
  const fallbackLabel = `Lat ${resolvedLat.toFixed(6)}, Lng ${resolvedLng.toFixed(6)}`;

  return {
    lat: resolvedLat,
    lng: resolvedLng,
    label: exactAddress || fallbackLabel,
    query: exactAddress || `${resolvedLat},${resolvedLng}`,
    source: 'device',
    precision: 'exact',
  };
};

const resolveMapLocationFromPayload = async (
  payload,
  { fallbackText = '', fallbackType = 'address' } = {}
) => {
  const { lat, lng, exactAddress } = extractLocationPayload(payload);

  if (lat !== null && lng !== null) {
    return buildCoordinateMapLocation({ lat, lng, exactAddress });
  }

  if (exactAddress) {
    return geocodeLocation(exactAddress, { type: 'address' });
  }

  if (!fallbackText) {
    return null;
  }

  return geocodeLocation(fallbackText, { type: fallbackType });
};

const enrichAlertMapLocation = async (alert = {}) => {
  if (!alert?.id || !String(alert?.ubicacion || '').trim() || isExactMapLocation(alert.mapa)) {
    return alert;
  }

  const resolvedMapLocation = await geocodeLocation(alert.ubicacion, { type: 'address' });

  if (!resolvedMapLocation) {
    return alert;
  }

  const enrichedAlert = {
    ...alert,
    mapa: resolvedMapLocation,
  };

  if (!areMapLocationsEquivalent(alert.mapa, resolvedMapLocation)) {
    await db
      .collection(ALERTS_COLLECTION)
      .doc(alert.id)
      .set({ mapa: resolvedMapLocation }, { merge: true })
      .catch(() => {});
  }

  return enrichedAlert;
};

const enrichAgentMapLocation = async (agent = {}) => {
  if (!agent?.codigo || isExactMapLocation(agent.mapa)) {
    return agent;
  }

  const locationText = String(agent.ubicacionExacta || agent.zona || '').trim();

  if (!locationText) {
    return agent;
  }

  const resolvedMapLocation = await geocodeLocation(locationText, {
    type: agent.ubicacionExacta ? 'address' : 'zone',
  });

  if (!resolvedMapLocation) {
    return agent;
  }

  const enrichedAgent = {
    ...agent,
    mapa: resolvedMapLocation,
    ultimaUbicacionTexto:
      agent.ubicacionExacta || resolvedMapLocation.label || resolvedMapLocation.query || agent.zona || '',
  };

  if (
    !areMapLocationsEquivalent(agent.mapa, resolvedMapLocation) ||
    String(agent.ultimaUbicacionTexto || '') !== String(enrichedAgent.ultimaUbicacionTexto || '')
  ) {
    await persistAgentRecord(agent.codigo, enrichedAgent).catch(() => {});
  }

  return enrichedAgent;
};

const persistAgentRecord = async (agentCode, agent) => {
  await Promise.all([
    db.collection(AGENTS_COLLECTION).doc(agentCode).set(agent, { merge: true }),
    db.collection(AGENTS_MIRROR_COLLECTION).doc(agentCode).set(agent, { merge: true }),
  ]);
};

const buildPublicAgent = (agent = {}) => ({
  codigo: agent.codigo,
  usuario: agent.usuario,
  nombre: agent.nombre,
  email: agent.email,
  zona: agent.zona,
  telefono: agent.telefono,
  estado: agent.estado,
  mapa: agent.mapa || null,
  uid: agent.uid,
  ubicacionExacta: agent.ubicacionExacta || '',
  ultimaUbicacionTexto:
    agent.ultimaUbicacionTexto || agent.ubicacionExacta || agent.mapa?.label || agent.zona || '',
  ultimaConexionAt: agent.ultimaConexionAt || null,
  createdAt: agent.createdAt || null,
  updatedAt: agent.updatedAt || null,
});

const buildAgentPresencePatch = async (
  agent,
  payload,
  { fallbackText = '', fallbackType = 'address' } = {}
) => {
  const now = new Date().toISOString();
  const { exactAddress } = extractLocationPayload(payload);
  const resolvedMapLocation = await resolveMapLocationFromPayload(payload, {
    fallbackText,
    fallbackType,
  });

  const patch = {
    ultimaConexionAt: now,
    updatedAt: now,
  };

  if (resolvedMapLocation) {
    patch.mapa = resolvedMapLocation;
    patch.ubicacionExacta = exactAddress || agent.ubicacionExacta || '';
    patch.ultimaUbicacionTexto =
      exactAddress ||
      resolvedMapLocation.label ||
      resolvedMapLocation.query ||
      agent.ultimaUbicacionTexto ||
      agent.zona ||
      '';
  }

  return patch;
};

const findAgentDocumentByUid = async (userId) => {
  const snapshot = await db.collection(AGENTS_COLLECTION).where('uid', '==', userId).limit(1).get();

  if (snapshot.empty) {
    const error = new Error('No encontramos un agente vinculado a esta sesion.');
    error.statusCode = 404;
    throw error;
  }

  return snapshot.docs[0];
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

const buildHistoryRowFromAlert = (alert = {}) => {
  const normalizedStatus = normalizeAlertStatus(alert.estado);

  if (normalizedStatus !== 'Finalizado' && normalizedStatus !== 'Cancelado') {
    return null;
  }

  const finishedAt = String(alert.updatedAt || alert.createdAt || new Date().toISOString());
  const rating = readServiceRating(alert.calificacionServicio ?? alert.calificacion);

  return {
    id: `HIS-${alert.id || Date.now()}`,
    usuario: alert.usuario || 'Sin dato',
    tipo: alert.tipo || 'Servicio',
    fecha: finishedAt,
    duracion: buildHistoryDuration(alert.createdAt, finishedAt),
    estado: normalizedStatus === 'Finalizado' ? 'Completado' : 'Cancelado',
    alertId: alert.id || '',
    ubicacion: alert.ubicacion || '',
    agenteAsignado: alert.agenteAsignado || 'Sin asignar',
    calificacion: rating,
    createdAt: finishedAt,
    updatedAt: finishedAt,
    companyUid: normalizeCompanyUid(alert.companyUid || alert.createdBy),
  };
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
    companyUid: normalizeCompanyUid(notice.companyUid || notice.linkedCompanyId),
    source: 'mobile_notice',
    sourceNoticeId: noticeId,
  };
};

const buildCreatorDisplayName = (userData = {}) => {
  if (typeof userData?.nombre === 'string' && userData.nombre.trim()) {
    return userData.nombre.trim();
  }

  if (typeof userData?.name === 'string' && userData.name.trim()) {
    return userData.name.trim();
  }

  if (typeof userData?.email === 'string' && userData.email.trim()) {
    return userData.email.trim();
  }

  return '';
};

const loadUsersById = async (ids = []) => {
  const uniqueIds = [...new Set(ids.map((value) => String(value || '').trim()).filter(Boolean))];

  if (!uniqueIds.length) {
    return new Map();
  }

  const creatorDocs = await Promise.all(
    uniqueIds.map(async (userId) => {
      try {
        const userDoc = await db.collection(USERS_COLLECTION).doc(userId).get();
        return [userId, userDoc.exists ? userDoc.data() : null];
      } catch {
        return [userId, null];
      }
    })
  );

  return new Map(creatorDocs);
};

const noticeBelongsToCompany = (notice = {}, creatorData = null, companyUid) => {
  return (
    belongsToCompany(notice, companyUid) ||
    belongsToCompany(creatorData || {}, companyUid) ||
    normalizeCompanyUid(creatorData?.linkedCompanyId) === normalizeCompanyUid(companyUid)
  );
};

const findOwnedMobileNotice = async (noticeId, companyUid) => {
  const normalizedNoticeId = String(noticeId || '').trim();

  if (!normalizedNoticeId) {
    return null;
  }

  const noticeDoc = await db.collection(MOBILE_NOTICES_COLLECTION).doc(normalizedNoticeId).get();

  if (!noticeDoc.exists) {
    return null;
  }

  const notice = noticeDoc.data() || {};
  const usersById = await loadUsersById([notice.creadoPor]);
  const creatorData = usersById.get(String(notice.creadoPor || '').trim()) || null;

  if (!noticeBelongsToCompany(notice, creatorData, companyUid)) {
    return null;
  }

  return {
    id: noticeDoc.id,
    notice,
    creatorData,
  };
};

const listMobileSosAlerts = async (companyUid) => {
  const snapshot = await db.collection(MOBILE_NOTICES_COLLECTION).where('tipo', '==', 'sos').get();

  if (snapshot.empty) {
    return [];
  }

  const usersById = await loadUsersById(snapshot.docs.map((doc) => doc.data()?.creadoPor));

  return snapshot.docs.flatMap((doc) => {
    const notice = doc.data() || {};
    const creatorData = usersById.get(String(notice.creadoPor || '').trim()) || null;

    if (!noticeBelongsToCompany(notice, creatorData, companyUid)) {
      return [];
    }

    return [
      attachCompanyScope(
        buildMobileAlertFromNotice(doc.id, notice, buildCreatorDisplayName(creatorData)),
        companyUid
      ),
    ];
  });
};

const getOwnedDashboardAlerts = async (companyUid) => {
  const snapshot = await db.collection(ALERTS_COLLECTION).get();
  const alerts = snapshot.docs
    .map((doc) => {
      const alert = doc.data() || {};

      return {
        ...alert,
        id: alert.id || doc.id,
        __docId: doc.id,
      };
    })
    .filter((alert) => belongsToCompany(alert, companyUid));

  await Promise.all(
    alerts.map((alert) => maybeBackfillCompanyUid(ALERTS_COLLECTION, alert.__docId, alert, companyUid))
  );

  return alerts.map(({ __docId, ...alert }) => attachCompanyScope(alert, companyUid));
};

const getOwnedAgentRecords = async (companyUid) => {
  const snapshot = await db.collection(AGENTS_COLLECTION).get();
  const agents = snapshot.docs
    .map((doc) => {
      const agent = doc.data() || {};

      return {
        ...agent,
        codigo: agent.codigo || doc.id,
        __docId: doc.id,
      };
    })
    .filter((agent) => belongsToCompany(agent, companyUid));

  await Promise.all(
    agents.map((agent) => maybeBackfillCompanyUid(AGENTS_COLLECTION, agent.__docId, agent, companyUid))
  );

  return agents.map(({ __docId, ...agent }) => attachCompanyScope(agent, companyUid));
};

const getOwnedAlertIdSet = async (companyUid) => {
  const [dashboardAlerts, mobileAlerts] = await Promise.all([
    getOwnedDashboardAlerts(companyUid),
    listMobileSosAlerts(companyUid),
  ]);

  return new Set(
    [...dashboardAlerts, ...mobileAlerts]
      .map((alert) => String(alert.id || '').trim())
      .filter(Boolean)
  );
};

const resolveOwnedAlertRecord = async (alertId, companyUid, payloadAlert = {}) => {
  const normalizedAlertId = String(alertId || '').trim();

  if (!normalizedAlertId) {
    const error = new Error('Debes seleccionar una alerta.');
    error.statusCode = 400;
    throw error;
  }

  const alertRef = db.collection(ALERTS_COLLECTION).doc(normalizedAlertId);
  const alertDoc = await alertRef.get();

  if (alertDoc.exists) {
    const storedAlert = {
      ...(alertDoc.data() || {}),
      id: (alertDoc.data() || {}).id || alertDoc.id,
    };

    assertCompanyOwnership(storedAlert, companyUid, 'alerta');
    await maybeBackfillCompanyUid(ALERTS_COLLECTION, alertDoc.id, storedAlert, companyUid);

    return {
      ref: alertRef,
      alert: attachCompanyScope(storedAlert, companyUid),
      existed: true,
    };
  }

  const ownedNotice = await findOwnedMobileNotice(
    payloadAlert?.sourceNoticeId || normalizedAlertId,
    companyUid
  );

  if (!ownedNotice) {
    const error = new Error('La alerta seleccionada no existe o no pertenece a tu empresa.');
    error.statusCode = 404;
    throw error;
  }

  const baseAlert = buildMobileAlertFromNotice(
    ownedNotice.id,
    ownedNotice.notice,
    buildCreatorDisplayName(ownedNotice.creatorData)
  );

  return {
    ref: alertRef,
    alert: attachCompanyScope(
      {
        ...baseAlert,
        ...(payloadAlert && typeof payloadAlert === 'object' ? payloadAlert : {}),
        id: normalizedAlertId,
        source: 'mobile_notice',
        sourceNoticeId: ownedNotice.id,
      },
      companyUid
    ),
    existed: false,
  };
};

const releaseAgentFromAlert = async (alert = {}, companyUid) => {
  if (!alert?.agenteAsignado || alert.agenteAsignado === 'Sin asignar') {
    return;
  }

  const normalizedAgentCode = normalizeAgentCode(alert.agenteCodigo);
  let agentDocs = [];

  if (normalizedAgentCode) {
    const agentDoc = await db.collection(AGENTS_COLLECTION).doc(normalizedAgentCode).get();

    if (agentDoc.exists && belongsToCompany(agentDoc.data() || {}, companyUid)) {
      agentDocs = [agentDoc];
    }
  }

  if (!agentDocs.length) {
    const snapshot = await db
      .collection(AGENTS_COLLECTION)
      .where('nombre', '==', alert.agenteAsignado)
      .get();

    agentDocs = snapshot.docs.filter((doc) => belongsToCompany(doc.data() || {}, companyUid));
  }

  if (!agentDocs.length) {
    return;
  }

  await Promise.all(
    agentDocs.map((doc) =>
      persistAgentRecord(
        doc.id,
        attachCompanyScope(
          {
            ...(doc.data() || {}),
            estado: 'Disponible',
            updatedAt: new Date().toISOString(),
          },
          companyUid
        )
      )
    )
  );
};

const assertNotificationOwnership = async (notification = {}, companyUid) => {
  if (belongsToCompany(notification, companyUid)) {
    return;
  }

  const relatedAlertId = String(notification.relatedAlertId || '').trim();

  if (!relatedAlertId) {
    throw buildOwnershipError('notificacion');
  }

  await resolveOwnedAlertRecord(relatedAlertId, companyUid);
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

  const now = new Date().toISOString();
  const alert = attachCompanyScope({
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
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
  }, userId);

  const notification = attachCompanyScope({
    id: notificationId,
    titulo: `Nueva alerta de ${tipo.toLowerCase()}`,
    descripcion: `${profile.nombre} registro una alerta en ${ubicacion}`,
    tiempo: buildRelativeLabel(),
    tipo: prioridad === 'Alta' ? 'danger' : 'info',
    leida: false,
    relatedAlertId: alertId,
    createdAt: now,
    updatedAt: now,
  }, userId, { defaultCreatedBy: userId });

  await Promise.all([
    db.collection(ALERTS_COLLECTION).doc(alertId).set(alert),
    db.collection(NOTIFICATIONS_COLLECTION).doc(notificationId).set(notification),
  ]);

  return { alert, notification };
};

const listAlerts = async (companyUid) => {
  const [dashboardAlerts, mobileAlerts] = await Promise.all([
    getOwnedDashboardAlerts(companyUid),
    listMobileSosAlerts(companyUid),
  ]);

  const alertsById = new Map(mobileAlerts.map((alert) => [alert.id, alert]));

  const enrichedDashboardAlerts = await Promise.all(
    dashboardAlerts.map((alert) => enrichAlertMapLocation(attachCompanyScope(alert, companyUid)))
  );

  enrichedDashboardAlerts.forEach((alert) => {
    alertsById.set(alert.id, alert);
  });

  return sortByRecent(Array.from(alertsById.values()));
};

const listAgents = async (companyUid) => {
  const agents = await Promise.all(
    (await getOwnedAgentRecords(companyUid)).map(async (agent) =>
      enrichAgentMapLocation(attachCompanyScope(agent, companyUid))
    )
  );

  return sortByRecent(agents.map((agent) => buildPublicAgent(agent)));
};

const listNotifications = async (companyUid) => {
  const [snapshot, ownedAlertIds] = await Promise.all([
    db.collection(NOTIFICATIONS_COLLECTION).get(),
    getOwnedAlertIdSet(companyUid),
  ]);

  const notifications = snapshot.docs
    .map((doc) => {
      const notification = doc.data() || {};

      return {
        ...notification,
        id: notification.id || doc.id,
        __docId: doc.id,
      };
    })
    .filter(
      (notification) =>
        belongsToCompany(notification, companyUid) ||
        ownedAlertIds.has(String(notification.relatedAlertId || '').trim())
    );

  await Promise.all(
    notifications.map((notification) =>
      maybeBackfillCompanyUid(NOTIFICATIONS_COLLECTION, notification.__docId, notification, companyUid)
    )
  );

  return sortByRecent(
    notifications.map(({ __docId, ...notification }) => attachCompanyScope(notification, companyUid))
  );
};

const listHistory = async (companyUid) => {
  const [historySnapshot, companyAlerts] = await Promise.all([
    db.collection(HISTORY_COLLECTION).get(),
    getOwnedDashboardAlerts(companyUid),
  ]);
  const companyAlertIds = new Set(
    companyAlerts.map((alert) => String(alert.id || '').trim()).filter(Boolean)
  );

  const historyRows = historySnapshot.docs.map((doc) => {
    const row = doc.data() || {};
    const rating = readServiceRating(row.calificacion);

    return {
      id: row.id || doc.id,
      ...row,
      calificacion: rating,
      __docId: doc.id,
    };
  });

  const ownedHistoryRows = historyRows.filter(
    (row) =>
      belongsToCompany(row, companyUid) || companyAlertIds.has(String(row.alertId || '').trim())
  );

  await Promise.all(
    ownedHistoryRows.map((row) =>
      maybeBackfillCompanyUid(HISTORY_COLLECTION, row.__docId, row, companyUid)
    )
  );

  const storedAlertIds = new Set(
    ownedHistoryRows
      .map((row) => row.alertId)
      .filter((value) => typeof value === 'string' && value.trim())
  );

  const derivedRows = companyAlerts
    .map((alert) => buildHistoryRowFromAlert(attachCompanyScope(alert, companyUid)))
    .filter(Boolean)
    .filter((row) => !storedAlertIds.has(row.alertId));

  return sortByRecent([
    ...ownedHistoryRows.map(({ __docId, ...row }) => attachCompanyScope(row, companyUid)),
    ...derivedRows,
  ]);
};

const getDashboardSnapshot = async (companyUid) => {
  const [alerts, agents, notifications, history] = await Promise.all([
    listAlerts(companyUid),
    listAgents(companyUid),
    listNotifications(companyUid),
    listHistory(companyUid),
  ]);

  return {
    alerts,
    agents,
    notifications,
    history,
  };
};

const createAgent = async (userId, payload) => {
  const nombre = String(payload.nombre || '').trim();
  const usuario = normalizeAgentUsername(payload.usuario);
  const password = String(payload.password || '').trim();
  const zona = String(payload.zona || '').trim();
  const ubicacionExacta = String(payload.ubicacionExacta || '').trim();
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
  const mapa = await geocodeLocation(ubicacionExacta || zona, {
    type: ubicacionExacta ? 'address' : 'zone',
  });

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
      ubicacionExacta,
      telefono,
      estado: 'Disponible',
      mapa,
      ultimaUbicacionTexto: ubicacionExacta || mapa?.label || zona,
      ultimaConexionAt: null,
      uid: userRecord.uid,
      companyUid: userId,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
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
      companyUid: userId,
      createdAt: now,
      createdBy: userId,
    };

    await Promise.all([
      db.collection(AGENTS_COLLECTION).doc(agentCodigo).set(agent),
      db.collection(AGENTS_MIRROR_COLLECTION).doc(agentCodigo).set(agent),
      db.collection(USERS_COLLECTION).doc(userRecord.uid).set(mobileProfile, { merge: true }),
      db.collection(NOTIFICATIONS_COLLECTION).doc(`AGENT-NOT-${agentCodigo}`).set(
        attachCompanyScope(
          {
            id: `AGENT-NOT-${agentCodigo}`,
            titulo: 'Agente registrado',
            descripcion: `${nombre} fue registrado como agente para la zona ${zona}.`,
            tiempo: buildRelativeLabel(),
            tipo: 'success',
            leida: false,
            relatedAgentCode: agentCodigo,
            createdAt: now,
            updatedAt: now,
          },
          userId,
          { defaultCreatedBy: userId }
        ),
        { merge: true }
      ),
      db.collection(HISTORY_COLLECTION).doc(`AGENT-HIST-${agentCodigo}`).set(
        attachCompanyScope(
          {
            id: `AGENT-HIST-${agentCodigo}`,
            usuario: nombre,
            tipo: 'Agente registrado',
            fecha: buildDateLabelFromValue(now),
            duracion: 'Registro operativo',
            estado: 'Completado',
            agentCode: agentCodigo,
            createdAt: now,
            updatedAt: now,
          },
          userId,
          { defaultCreatedBy: userId }
        ),
        { merge: true }
      ),
    ]);

    return buildPublicAgent(agent);
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

  const updatedAgent = {
    ...agent,
    ...(await buildAgentPresencePatch(agent, payload)),
  };

  await persistAgentRecord(agent.codigo, updatedAgent);

  return {
    email: updatedAgent.email,
    agent: buildPublicAgent(updatedAgent),
  };
};

const updateAuthenticatedAgentLocation = async (userId, payload) => {
  if (!userId) {
    const error = new Error('No encontramos una sesion valida para el agente.');
    error.statusCode = 401;
    throw error;
  }

  const agentDoc = await findAgentDocumentByUid(userId);
  const agent = agentDoc.data() || {};
  const fallbackText = String(payload.ubicacionExacta || agent.ubicacionExacta || agent.zona || '').trim();
  const fallbackType = payload.ubicacionExacta ? 'address' : 'zone';
  const patch = await buildAgentPresencePatch(agent, payload, {
    fallbackText,
    fallbackType,
  });
  const updatedAgent = {
    ...agent,
    ...patch,
  };

  await persistAgentRecord(agent.codigo, updatedAgent);

  return buildPublicAgent(updatedAgent);
};

const deleteAgent = async (codigo, companyUid) => {
  const normalizedCodigo = normalizeAgentCode(codigo);
  const agentRef = db.collection(AGENTS_COLLECTION).doc(normalizedCodigo);
  const agentDoc = await agentRef.get();

  if (!agentDoc.exists) {
    const error = new Error('Agente no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  const agent = agentDoc.data();
  assertCompanyOwnership(agent, companyUid, 'agente');

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

const assignAgentToAlert = async (alertId, agentCode, companyUid, payload = {}) => {
  if (!alertId || !agentCode) {
    const error = new Error('Debes seleccionar una alerta y un agente.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedAgentCode = normalizeAgentCode(agentCode);
  const [{ ref: alertRef, alert }, agentDoc] = await Promise.all([
    resolveOwnedAlertRecord(alertId, companyUid, payload.alert),
    db.collection(AGENTS_COLLECTION).doc(normalizedAgentCode).get(),
  ]);

  if (!agentDoc.exists) {
    const error = new Error('El agente seleccionado no existe.');
    error.statusCode = 404;
    throw error;
  }

  const agent = {
    ...(agentDoc.data() || {}),
    codigo: (agentDoc.data() || {}).codigo || normalizedAgentCode,
  };
  assertCompanyOwnership(agent, companyUid, 'agente');
  await maybeBackfillCompanyUid(AGENTS_COLLECTION, agentDoc.id, agent, companyUid);

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

  const now = new Date().toISOString();
  const updatedAlert = attachCompanyScope({
    ...alert,
    agenteAsignado: agent.nombre,
    agenteCodigo: normalizedAgentCode,
    estado: 'Asignado',
    updatedAt: now,
  }, companyUid);

  const updatedAgent = attachCompanyScope({
    ...agent,
    estado: 'En servicio',
    updatedAt: now,
  }, companyUid);

  const notificationId = `NOT-${Date.now()}`;
  const notification = attachCompanyScope({
    id: notificationId,
    titulo: 'Agente asignado',
    descripcion: `${agent.nombre} fue asignado a la alerta ${alertId}`,
    tiempo: buildRelativeLabel(),
    tipo: 'info',
    leida: false,
    relatedAlertId: alertId,
    createdAt: now,
    updatedAt: now,
  }, companyUid, { defaultCreatedBy: companyUid });

  await Promise.all([
    alertRef.set(updatedAlert, { merge: true }),
    persistAgentRecord(normalizedAgentCode, updatedAgent),
    db.collection(NOTIFICATIONS_COLLECTION).doc(notificationId).set(notification),
  ]);

  return { alert: updatedAlert, agent: buildPublicAgent(updatedAgent) };
};

const finalizeAlert = async (alertId, companyUid, payload = {}) => {
  if (!alertId) {
    const error = new Error('Debes seleccionar una alerta.');
    error.statusCode = 400;
    throw error;
  }

  const { ref: alertRef, alert } = await resolveOwnedAlertRecord(alertId, companyUid, payload.alert);

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

  const serviceRating = normalizeServiceRating(
    payload.calificacion ??
      payload.rating ??
      payload.alert?.calificacionServicio ??
      payload.alert?.calificacion
  );

  const now = new Date().toISOString();
  const updatedAlert = attachCompanyScope({
    ...alert,
    estado: 'Finalizado',
    updatedAt: now,
    ...(serviceRating !== null ? { calificacionServicio: serviceRating } : {}),
  }, companyUid);
  const finishedAt = updatedAlert.updatedAt;

  const tasks = [alertRef.set(updatedAlert, { merge: true })];
  tasks.push(releaseAgentFromAlert(updatedAlert, companyUid));

  const notificationId = `NOT-${Date.now()}`;
  tasks.push(
    db.collection(NOTIFICATIONS_COLLECTION).doc(notificationId).set(
      attachCompanyScope({
      id: notificationId,
      titulo: 'Servicio finalizado',
      descripcion: `La alerta ${alertId} fue marcada como finalizada`,
      tiempo: buildRelativeLabel(),
      tipo: 'success',
      leida: false,
      relatedAlertId: alertId,
      createdAt: now,
      updatedAt: now,
    }, companyUid, { defaultCreatedBy: companyUid })
    )
  );

  const historyRecord = attachCompanyScope({
    id: `HIS-${Date.now()}`,
    usuario: alert.usuario,
    tipo: alert.tipo,
    fecha: finishedAt,
    duracion: buildHistoryDuration(alert.createdAt, finishedAt),
    estado: 'Completado',
    alertId,
    ubicacion: alert.ubicacion,
    agenteAsignado: alert.agenteAsignado,
    calificacion: serviceRating,
    createdAt: finishedAt,
    updatedAt: finishedAt,
  }, companyUid, { defaultCreatedBy: companyUid });
  tasks.push(db.collection(HISTORY_COLLECTION).doc(historyRecord.id).set(historyRecord));

  await Promise.all(tasks);

  return { alert: updatedAlert };
};

const cancelAlert = async (alertId, companyUid, payload = {}) => {
  if (!alertId) {
    const error = new Error('Debes seleccionar una alerta.');
    error.statusCode = 400;
    throw error;
  }

  const { ref: alertRef, alert } = await resolveOwnedAlertRecord(alertId, companyUid, payload.alert);

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

  const now = new Date().toISOString();
  const updatedAlert = attachCompanyScope({
    ...alert,
    estado: 'Cancelado',
    updatedAt: now,
  }, companyUid);
  const finishedAt = updatedAlert.updatedAt;

  const tasks = [alertRef.set(updatedAlert, { merge: true })];
  tasks.push(releaseAgentFromAlert(updatedAlert, companyUid));

  const notificationId = `NOT-${Date.now()}`;
  tasks.push(
    db.collection(NOTIFICATIONS_COLLECTION).doc(notificationId).set(
      attachCompanyScope({
      id: notificationId,
      titulo: 'Servicio cancelado',
      descripcion: `La alerta ${alertId} fue marcada como cancelada`,
      tiempo: buildRelativeLabel(),
      tipo: 'danger',
      leida: false,
      relatedAlertId: alertId,
      createdAt: now,
      updatedAt: now,
    }, companyUid, { defaultCreatedBy: companyUid })
    )
  );

  const historyRecord = attachCompanyScope({
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
  }, companyUid, { defaultCreatedBy: companyUid });
  tasks.push(db.collection(HISTORY_COLLECTION).doc(historyRecord.id).set(historyRecord));

  await Promise.all(tasks);

  return { alert: updatedAlert };
};

const updateAgentStatus = async (agentCode, companyUid) => {
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
  assertCompanyOwnership(agent, companyUid, 'agente');
  const updatedAgent = attachCompanyScope({
    ...agent,
    estado: agent.estado === 'Disponible' ? 'En servicio' : 'Disponible',
    updatedAt: new Date().toISOString(),
  }, companyUid);

  await persistAgentRecord(normalizeAgentCode(agentCode), updatedAgent);

  return buildPublicAgent(updatedAgent);
};

const markNotificationAsRead = async (notificationId, companyUid) => {
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

  await assertNotificationOwnership(notificationDoc.data() || {}, companyUid);

  await notificationRef.set(
    attachCompanyScope({
      ...notificationDoc.data(),
      leida: true,
      updatedAt: new Date().toISOString(),
    }, companyUid, { defaultCreatedBy: companyUid }),
    { merge: true }
  );
};

const markAllNotificationsAsRead = async (companyUid) => {
  const notifications = await listNotifications(companyUid);

  if (!notifications.length) {
    return;
  }

  const tasks = notifications.map((notification) =>
    db.collection(NOTIFICATIONS_COLLECTION).doc(notification.id).set(
      attachCompanyScope({
        ...notification,
        leida: true,
        updatedAt: new Date().toISOString(),
      }, companyUid, { defaultCreatedBy: companyUid }),
      { merge: true }
    )
  );

  await Promise.all(tasks);
};

module.exports = {
  listAlerts,
  listAgents,
  listNotifications,
  listHistory,
  getDashboardSnapshot,
  createAlert,
  assignAgentToAlert,
  finalizeAlert,
  cancelAlert,
  resolveAgentAccess,
  updateAuthenticatedAgentLocation,
  updateAgentStatus,
  createAgent,
  deleteAgent,
  markNotificationAsRead,
  markAllNotificationsAsRead,
};
