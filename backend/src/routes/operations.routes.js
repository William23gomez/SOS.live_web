const express = require('express');

const operationsController = require('../controllers/operations.controller');
const authMiddleware = require('../middlewares/auth.middleware');

const router = express.Router();

router.post('/agents/resolve-access', operationsController.resolveAgentAccess);

router.use(authMiddleware);

router.get('/alerts', operationsController.listAlerts);
router.get('/agents', operationsController.listAgents);
router.get('/notifications', operationsController.listNotifications);
router.post('/alerts', operationsController.createAlert);
router.post('/agents', operationsController.createAgent);
router.patch('/agents/location', operationsController.updateAuthenticatedAgentLocation);
router.put('/alerts/:alertId/assign', operationsController.assignAgentToAlert);
router.patch('/alerts/:alertId/finalize', operationsController.finalizeAlert);
router.patch('/alerts/:alertId/cancel', operationsController.cancelAlert);
router.patch('/agents/:codigo/status', operationsController.updateAgentStatus);
router.delete('/agents/:codigo', operationsController.deleteAgent);
router.patch('/notifications/:notificationId/read', operationsController.markNotificationAsRead);
router.patch('/notifications/read-all', operationsController.markAllNotificationsAsRead);

module.exports = router;
