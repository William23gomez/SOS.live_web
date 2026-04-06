const operationsService = require('../services/operations.service');

const listAlerts = async (req, res, next) => {
  try {
    const alerts = await operationsService.listAlerts();

    res.status(200).json({
      alerts,
    });
  } catch (error) {
    next(error);
  }
};

const listAgents = async (req, res, next) => {
  try {
    const agents = await operationsService.listAgents();

    res.status(200).json({
      agents,
    });
  } catch (error) {
    next(error);
  }
};

const listNotifications = async (req, res, next) => {
  try {
    const notifications = await operationsService.listNotifications();

    res.status(200).json({
      notifications,
    });
  } catch (error) {
    next(error);
  }
};

const createAlert = async (req, res, next) => {
  try {
    const result = await operationsService.createAlert(req.user.id, req.body);

    res.status(201).json({
      message: 'Alerta creada correctamente.',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

const assignAgentToAlert = async (req, res, next) => {
  try {
    const result = await operationsService.assignAgentToAlert(
      req.params.alertId,
      req.body.agentCode,
      req.body
    );

    res.status(200).json({
      message: 'Agente asignado correctamente.',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

const finalizeAlert = async (req, res, next) => {
  try {
    const result = await operationsService.finalizeAlert(req.params.alertId, req.body);

    res.status(200).json({
      message: 'Servicio finalizado correctamente.',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

const cancelAlert = async (req, res, next) => {
  try {
    const result = await operationsService.cancelAlert(req.params.alertId, req.body);

    res.status(200).json({
      message: 'Servicio cancelado correctamente.',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

const updateAgentStatus = async (req, res, next) => {
  try {
    const agent = await operationsService.updateAgentStatus(req.params.codigo);

    res.status(200).json({
      message: 'Estado del agente actualizado.',
      agent,
    });
  } catch (error) {
    next(error);
  }
};

const createAgent = async (req, res, next) => {
  try {
    const agent = await operationsService.createAgent(req.user.id, req.body);

    res.status(201).json({
      message: 'Agente creado correctamente.',
      agent,
    });
  } catch (error) {
    next(error);
  }
};

const deleteAgent = async (req, res, next) => {
  try {
    await operationsService.deleteAgent(req.params.codigo);

    res.status(200).json({
      message: 'Agente eliminado correctamente.',
    });
  } catch (error) {
    next(error);
  }
};

const markNotificationAsRead = async (req, res, next) => {
  try {
    await operationsService.markNotificationAsRead(req.params.notificationId);

    res.status(200).json({
      message: 'Notificacion marcada como leida.',
    });
  } catch (error) {
    next(error);
  }
};

const markAllNotificationsAsRead = async (req, res, next) => {
  try {
    await operationsService.markAllNotificationsAsRead();

    res.status(200).json({
      message: 'Todas las notificaciones fueron marcadas como leidas.',
    });
  } catch (error) {
    next(error);
  }
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
