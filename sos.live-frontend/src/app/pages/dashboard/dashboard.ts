import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { onAuthStateChanged, Unsubscribe, User } from 'firebase/auth';

import { AuthService } from '../../core/auth.service';
import {
  DashboardAgent,
  DashboardAlert,
  DashboardBillingRow,
  DashboardCompanyProfile,
  DashboardDataService,
  DashboardHistoryRow,
  DashboardNotification,
} from '../../core/dashboard-data.service';
import { OperationsService } from '../../core/operations.service';
import { auth } from '../../core/firebase.config';

@Component({
  selector: 'app-dashboard',
  standalone: false,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit, OnDestroy {
  private readonly alertPinPositions = [
    { top: '18%', left: '23%' },
    { top: '56%', left: '54%' },
    { top: '34%', left: '74%' },
  ];
  private readonly agentPinPositions = [
    { top: '29%', left: '69%' },
    { top: '64%', left: '77%' },
    { top: '72%', left: '34%' },
  ];

  activeSection:
    | 'overview'
    | 'alerts'
    | 'agents'
    | 'history'
    | 'company'
    | 'billing'
    | 'notifications' = 'overview';

  formData = {
    nombre: '',
    email: '',
    telefono: '',
    nit: '',
  };

  recentAlerts: DashboardAlert[] = [];
  agents: DashboardAgent[] = [];
  historyRows: DashboardHistoryRow[] = [];
  notifications: DashboardNotification[] = [];
  billingRows: DashboardBillingRow[] = [];

  newAlertForm = {
    tipo: 'Panico',
    ubicacion: '',
    prioridad: 'Alta',
    descripcion: '',
  };

  newAgentForm = {
    nombre: '',
    codigo: '',
    zona: '',
    telefono: '',
  };

  companyData: DashboardCompanyProfile = {
    nombre: '',
    correo: '',
    telefono: '',
    direccion: '',
    nitEmpresa: '',
    plan: '',
    estado: '',
  };

  realtimeClock = '';
  livePulse = 0;
  selectedAlertId = '';
  selectedAgentCode = '';
  selectedHistoryStatus = 'Todos';
  selectedBillingStatus = 'Todos';
  alertPriorityFilter = 'Todas';
  alertStatusFilter = 'Todas';
  alertSearch = '';
  agentSearch = '';

  currentUser: User | null = null;
  isLoading = true;
  isSubmitting = false;
  isDeleting = false;
  isResendingVerification = false;
  isCreatingAlert = false;
  isCreatingAgent = false;
  feedbackMessage = '';
  feedbackType: 'success' | 'error' = 'success';

  private unsubscribeAuth?: Unsubscribe;
  private liveInterval?: ReturnType<typeof setInterval>;
  private operationsSyncInterval?: ReturnType<typeof setInterval>;
  private dashboardUnsubscribes: Unsubscribe[] = [];

  constructor(
    private readonly zone: NgZone,
    private readonly cdr: ChangeDetectorRef,
    private readonly sanitizer: DomSanitizer,
    private readonly authService: AuthService,
    private readonly dashboardDataService: DashboardDataService,
    private readonly operationsService: OperationsService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit() {
    this.startRealtimeFeed();
    this.route.data.subscribe((data) => {
      const section = data['section'];

      if (section) {
        this.activeSection = section;
      }
    });

    this.unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      this.zone.run(async () => {
        if (!user) {
          this.teardownDashboardSubscriptions();
          this.isLoading = false;
          void this.router.navigate(['/login']);
          return;
        }

        this.currentUser = user;
        const cachedProfile = this.authService.getCachedProfile();

        this.formData = {
          nombre: cachedProfile?.nombre || user.displayName || '',
          email: cachedProfile?.email || user.email || '',
          telefono: cachedProfile?.telefono || '',
          nit: cachedProfile?.nit || '',
        };

        this.bindRealtimeDashboard();
        await this.cargarPerfil();
        await this.syncOperationalData();
        this.isLoading = false;
        this.startOperationsSync();
      });
    });
  }

  ngOnDestroy() {
    this.unsubscribeAuth?.();
    this.dashboardUnsubscribes.forEach((unsubscribe) => unsubscribe());
    if (this.liveInterval) {
      clearInterval(this.liveInterval);
    }
    if (this.operationsSyncInterval) {
      clearInterval(this.operationsSyncInterval);
    }
  }

  get isEmailVerified() {
    return !!this.currentUser?.emailVerified;
  }

  get displayName() {
    return this.formData.nombre || this.currentUser?.displayName || 'Usuario SOS.LIVE';
  }

  get summaryCards() {
    const activeAlerts = this.recentAlerts.filter(
      (alert) => this.normalizeAlertStatus(alert.estado) !== 'Finalizado'
    ).length;
    const availableAgents = this.agents.filter((agent) => agent.estado === 'Disponible').length;
    const assignedAlerts = this.recentAlerts.filter(
      (alert) => this.normalizeAlertStatus(alert.estado) === 'Asignado'
    ).length;
    const securityIndex =
      this.recentAlerts.length > 0
        ? Math.max(0, Math.min(100, 100 - activeAlerts * 10 - this.unreadNotificationsCount * 2))
        : 0;

    return [
      {
        title: 'Alertas activas',
        value: String(activeAlerts),
        detail: 'Eventos monitoreados en tiempo real',
        icon: 'bi-bell-fill',
        accent: 'gold',
      },
      {
        title: 'Alertas asignadas',
        value: String(assignedAlerts),
        detail: 'Incidentes con agente vinculado',
        icon: 'bi-diagram-3-fill',
        accent: 'cyan',
      },
      {
        title: 'Agentes enlazados',
        value: String(this.agents.length),
        detail: `${availableAgents} disponibles en este momento`,
        icon: 'bi-people-fill',
        accent: 'slate',
      },
      {
        title: 'Indice de seguridad',
        value: this.recentAlerts.length > 0 ? `${securityIndex}%` : 'N/D',
        detail: 'Calculado solo con alertas y notificaciones reales',
        icon: 'bi-shield-check',
        accent: 'emerald',
      },
    ];
  }

  get userInitials() {
    return this.displayName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((segment) => segment.charAt(0).toUpperCase())
      .join('');
  }

  setActiveSection(
    section:
      | 'overview'
      | 'alerts'
      | 'agents'
      | 'history'
      | 'company'
      | 'billing'
      | 'notifications'
  ) {
    this.activeSection = section;
  }

  get filteredAlertsLabel() {
    return `${this.filteredAlerts.length} alertas monitoreadas`;
  }

  get filteredAlerts() {
    const search = this.alertSearch.trim().toLowerCase();

    return this.recentAlerts.filter((alert) => {
      const matchesPriority =
        this.alertPriorityFilter === 'Todas' || alert.prioridad === this.alertPriorityFilter;
      const matchesStatus =
        this.alertStatusFilter === 'Todas' ||
        this.normalizeAlertStatus(alert.estado) === this.alertStatusFilter;
      const matchesSearch =
        !search ||
        [alert.usuario, alert.tipo, alert.ubicacion, alert.id].some((value) =>
          value.toLowerCase().includes(search)
        );

      return matchesPriority && matchesStatus && matchesSearch;
    });
  }

  get selectedAlert() {
    return this.recentAlerts.find((alert) => alert.id === this.selectedAlertId) || null;
  }

  get selectedAlertServiceStatus() {
    return this.selectedAlert ? this.normalizeAlertStatus(this.selectedAlert.estado) : 'En proceso';
  }

  get mapQuery() {
    return (
      this.selectedAlert?.ubicacion ||
      this.recentAlerts[0]?.ubicacion ||
      this.companyData.direccion ||
      'Bogota Colombia'
    );
  }

  get realMapUrl(): SafeResourceUrl {
    const query = encodeURIComponent(this.mapQuery);

    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.google.com/maps?q=${query}&z=14&output=embed`
    );
  }

  get externalMapUrl() {
    const query = encodeURIComponent(this.mapQuery);
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  }

  get hasMapLocation() {
    return !!(this.selectedAlert?.ubicacion || this.companyData.direccion);
  }

  get mapPins() {
    const alertPins = this.recentAlerts.slice(0, 3).map((alert, index) => {
      const position = this.alertPinPositions[index % this.alertPinPositions.length];

      return {
        ...position,
        tipo: 'alerta' as const,
        icon: 'bi-exclamation-diamond-fill',
        etiqueta: `${alert.tipo} - ${alert.ubicacion}`,
        alertId: alert.id,
      };
    });

    const agentPins = this.agents.slice(0, 3).map((agent, index) => {
      const position = this.agentPinPositions[index % this.agentPinPositions.length];

      return {
        ...position,
        tipo: 'cobertura' as const,
        icon: 'bi-broadcast-pin',
        etiqueta: `${agent.nombre} - ${agent.zona}`,
        alertId: null,
      };
    });

    return [...alertPins, ...agentPins];
  }

  get availableAgents() {
    const search = this.agentSearch.trim().toLowerCase();

    return this.agents.filter((agent) => {
      const matchesSearch =
        !search ||
        [agent.nombre, agent.codigo, agent.zona, agent.estado].some((value) =>
          value.toLowerCase().includes(search)
        );

      return matchesSearch;
    });
  }

  get selectedAgent() {
    return this.agents.find((agent) => agent.codigo === this.selectedAgentCode) || null;
  }

  get filteredHistoryRows() {
    return this.historyRows.filter(
      (row) => this.selectedHistoryStatus === 'Todos' || row.estado === this.selectedHistoryStatus
    );
  }

  get filteredBillingRows() {
    return this.billingRows.filter(
      (row) => this.selectedBillingStatus === 'Todos' || row.estado === this.selectedBillingStatus
    );
  }

  get unreadNotificationsCount() {
    return this.notifications.filter((item) => !item.leida).length;
  }

  get monthlyBillingTotal() {
    return this.formatCurrency(
      this.billingRows
        .filter((row) => row.estado === 'Completado')
        .reduce((total, row) => total + this.parseCurrency(row.monto), 0)
    );
  }

  get billingTransactionsCount() {
    return String(this.billingRows.length);
  }

  get pendingBillingTotal() {
    return this.formatCurrency(
      this.billingRows
        .filter((row) => row.estado === 'Pendiente')
        .reduce((total, row) => total + this.parseCurrency(row.monto), 0)
    );
  }

  selectAlert(alertId: string) {
    this.selectedAlertId = alertId;
  }

  focusAlertFromMap(alertId: string | null) {
    if (!alertId) {
      this.setActiveSection('overview');
      return;
    }

    this.selectedAlertId = alertId;
    this.activeSection = 'alerts';
  }

  async assignSelectedAgent() {
    const alert = this.selectedAlert;
    const agent = this.selectedAgent;

    if (!alert || !agent) {
      this.showFeedback('Selecciona una alerta y un agente para continuar.', 'error');
      return;
    }

    try {
      const result = await this.operationsService.assignAgent(alert.id, agent.codigo, {
        alert: { ...alert },
        agent: { ...agent },
      });
      this.recentAlerts = this.recentAlerts.map((item) =>
        item.id === result.alert.id ? result.alert : item
      );
      this.agents = this.agents.map((item) =>
        item.codigo === result.agent.codigo ? result.agent : item
      );
      this.selectedAlertId = result.alert.id;
      this.selectedAgentCode = result.agent.codigo;
      this.showFeedback(
        `${agent.nombre} fue asignado a la alerta ${alert.id} correctamente.`,
        'success'
      );
    } catch (error) {
      this.showFeedback(this.operationsService.translateError(error), 'error');
    }
  }

  async finalizeSelectedAlert() {
    const alert = this.selectedAlert;

    if (!alert) {
      this.showFeedback('Selecciona una alerta para finalizar el servicio.', 'error');
      return;
    }

    if (this.normalizeAlertStatus(alert.estado) === 'Finalizado') {
      this.showFeedback('La alerta seleccionada ya estaba finalizada.', 'success');
      return;
    }

    try {
      const result = await this.operationsService.finalizeAlert(alert.id, {
        alert: { ...alert },
      });
      this.applyAlerts(
        this.recentAlerts.map((item) => (item.id === result.alert.id ? result.alert : item))
      );
      void this.syncOperationalData();
      this.showFeedback(`La alerta ${alert.id} fue finalizada correctamente.`, 'success');
    } catch (error) {
      this.showFeedback(this.operationsService.translateError(error), 'error');
    }
  }

  async cancelSelectedAlert() {
    const alert = this.selectedAlert;

    if (!alert) {
      this.showFeedback('Selecciona una alerta para cancelar el servicio.', 'error');
      return;
    }

    const normalizedStatus = this.normalizeAlertStatus(alert.estado);

    if (normalizedStatus === 'Cancelado') {
      this.showFeedback('La alerta seleccionada ya estaba cancelada.', 'success');
      return;
    }

    if (normalizedStatus === 'Finalizado') {
      this.showFeedback('No puedes cancelar una alerta que ya fue finalizada.', 'error');
      return;
    }

    try {
      const result = await this.operationsService.cancelAlert(alert.id, {
        alert: { ...alert },
      });
      this.applyAlerts(
        this.recentAlerts.map((item) => (item.id === result.alert.id ? result.alert : item))
      );
      void this.syncOperationalData();
      this.showFeedback(`La alerta ${alert.id} fue cancelada correctamente.`, 'success');
    } catch (error) {
      this.showFeedback(this.operationsService.translateError(error), 'error');
    }
  }

  async toggleAgentStatus(agentCode: string) {
    const agent = this.agents.find((item) => item.codigo === agentCode);

    if (!agent) {
      return;
    }

    try {
      const result = await this.operationsService.toggleAgentStatus(agent.codigo);
      this.agents = this.agents.map((item) =>
        item.codigo === result.agent.codigo ? result.agent : item
      );
      this.showFeedback(
        `${result.agent.nombre} actualizo su estado operativo a ${result.agent.estado}.`,
        'success'
      );
    } catch (error) {
      this.showFeedback(this.operationsService.translateError(error), 'error');
    }
  }

  async markNotificationAsRead(notificationId: string) {
    const notification = this.notifications.find((item) => item.id === notificationId);

    if (!notification) {
      return;
    }

    try {
      await this.operationsService.markNotificationAsRead(notification.id);
    } catch (error) {
      this.showFeedback(this.operationsService.translateError(error), 'error');
    }
  }

  async markAllNotificationsAsRead() {
    try {
      await this.operationsService.markAllNotificationsAsRead();
      this.showFeedback('Todas las notificaciones quedaron marcadas como leidas.', 'success');
    } catch (error) {
      this.showFeedback(this.operationsService.translateError(error), 'error');
    }
  }

  async createAlert() {
    const { tipo, ubicacion, prioridad, descripcion } = this.newAlertForm;

    if (!tipo || !ubicacion || !prioridad || !descripcion) {
      this.showFeedback('Completa todos los datos de la alerta para registrarla.', 'error');
      return;
    }

    this.isCreatingAlert = true;
    this.showFeedback('', 'success');

    try {
      const payload = {
        tipo,
        ubicacion,
        prioridad,
        descripcion,
      };
      const result = await Promise.race([
        this.operationsService.createAlert(payload),
        this.waitForAlertAppearance(ubicacion, descripcion, true),
      ]);

      if (result && 'alert' in result) {
        this.applyAlerts(this.mergeAlert(result.alert));
        this.applyNotifications(this.mergeNotification(result.notification));
        this.selectedAlertId = result.alert.id;
      } else if (result) {
        this.applyAlerts(this.mergeAlert(result));
        this.selectedAlertId = result.id;
      }

      this.activeSection = 'alerts';
      void this.syncOperationalData();

      this.newAlertForm = {
        tipo: 'Panico',
        ubicacion: '',
        prioridad: 'Alta',
        descripcion: '',
      };
      this.showFeedback('Alerta registrada correctamente y notificacion generada.', 'success');
    } catch (error) {
      const syncedAlert = await this.waitForAlertAppearance(ubicacion, descripcion);

      if (syncedAlert) {
        this.applyAlerts(this.mergeAlert(syncedAlert));
        this.selectedAlertId = syncedAlert.id;
        this.activeSection = 'alerts';
        this.newAlertForm = {
          tipo: 'Panico',
          ubicacion: '',
          prioridad: 'Alta',
          descripcion: '',
        };
        this.showFeedback('Alerta registrada correctamente y sincronizada desde la base de datos.', 'success');
      } else {
        this.showFeedback(this.operationsService.translateError(error), 'error');
      }
    } finally {
      this.isCreatingAlert = false;
    }
  }

  async createAgent() {
    const { nombre, codigo, zona, telefono } = this.newAgentForm;

    if (!nombre || !codigo || !zona || !telefono) {
      this.showFeedback('Completa nombre, codigo, zona y telefono del agente.', 'error');
      return;
    }

    if (!/^\d+$/.test(telefono)) {
      this.showFeedback('El telefono del agente solo puede contener numeros.', 'error');
      return;
    }

    this.isCreatingAgent = true;
    this.showFeedback('', 'success');

    try {
      const payload = {
        nombre,
        codigo,
        zona,
        telefono,
      };
      const result = await Promise.race([
        this.operationsService.createAgent(payload),
        this.waitForAgentAppearance(codigo, true),
      ]);

      if (result && 'agent' in result) {
        this.applyAgents(this.mergeAgent(result.agent));
        this.selectedAgentCode = result.agent.codigo;
      } else if (result) {
        this.applyAgents(this.mergeAgent(result));
        this.selectedAgentCode = result.codigo;
      }

      void this.syncOperationalData();

      this.newAgentForm = {
        nombre: '',
        codigo: '',
        zona: '',
        telefono: '',
      };
      this.showFeedback('Agente creado correctamente y guardado en Firebase.', 'success');
    } catch (error) {
      const syncedAgent = await this.waitForAgentAppearance(codigo);

      if (syncedAgent) {
        this.applyAgents(this.mergeAgent(syncedAgent));
        this.selectedAgentCode = syncedAgent.codigo;
        this.newAgentForm = {
          nombre: '',
          codigo: '',
          zona: '',
          telefono: '',
        };
        this.showFeedback('Agente creado correctamente y sincronizado desde la base de datos.', 'success');
      } else {
        this.showFeedback(this.operationsService.translateError(error), 'error');
      }
    } finally {
      this.isCreatingAgent = false;
    }
  }

  async deleteAgent(agentCode: string) {
    const agent = this.agents.find((item) => item.codigo === agentCode);

    if (!agent) {
      return;
    }

    const confirmDelete = window.confirm(`Vas a eliminar al agente ${agent.nombre}. Deseas continuar?`);

    if (!confirmDelete) {
      return;
    }

    try {
      await this.operationsService.deleteAgent(agent.codigo);
      this.agents = this.agents.filter((item) => item.codigo !== agent.codigo);

      if (this.selectedAgentCode === agent.codigo) {
        this.selectedAgentCode = this.agents[0]?.codigo || '';
      }

      this.showFeedback(`${agent.nombre} fue eliminado correctamente.`, 'success');
    } catch (error) {
      this.showFeedback(this.operationsService.translateError(error), 'error');
    }
  }

  onlyNumbers(field: 'telefono' | 'nit') {
    this.formData[field] = this.formData[field].replace(/[^0-9]/g, '');
  }

  onlyNumbersAgent() {
    this.newAgentForm.telefono = this.newAgentForm.telefono.replace(/[^0-9]/g, '');
  }

  async guardarCambios() {
    const { nombre, email, telefono, nit } = this.formData;
    const direccion = this.companyData.direccion.trim();
    const plan = this.companyData.plan.trim();

    if (!nombre || !email || !telefono || !nit) {
      this.showFeedback('Completa todos los campos.', 'error');
      return;
    }

    if (!/^\d+$/.test(telefono)) {
      this.showFeedback('El telefono solo puede contener numeros.', 'error');
      return;
    }

    if (!/^\d+$/.test(nit)) {
      this.showFeedback('El NIT solo puede contener numeros.', 'error');
      return;
    }

    this.isSubmitting = true;
    this.showFeedback('', 'success');

    try {
      const result = await this.authService.actualizarPerfil({
        nombre,
        email,
        telefono,
        nit,
        direccion,
        plan,
      });

      this.formData = {
        nombre: result.user.nombre,
        email: result.user.email,
        telefono: result.user.telefono,
        nit: result.user.nit,
      };
      this.companyData = this.buildCompanyProfileFromForm({
        direccion,
        plan,
      });

      this.showFeedback(
        result.emailVerificationSent
          ? 'Perfil actualizado. Como cambiaste el correo, Firebase envio una nueva verificacion.'
          : 'Perfil actualizado correctamente.',
        'success'
      );
    } catch (error) {
      this.showFeedback(this.authService.traducirErrorFirebase(error), 'error');
    } finally {
      this.isSubmitting = false;
    }
  }

  async reenviarVerificacion() {
    this.isResendingVerification = true;
    this.showFeedback('', 'success');

    try {
      const sent = await this.authService.reenviarVerificacionCorreo();
      this.showFeedback(
        sent
          ? 'Se envio un nuevo correo de verificacion.'
          : 'La cuenta ya esta registrada. Si el correo no llega de inmediato, revisa spam e intenta de nuevo en un momento.',
        'success'
      );
    } catch (error) {
      this.showFeedback(this.authService.traducirErrorFirebase(error), 'error');
    } finally {
      this.isResendingVerification = false;
    }
  }

  async cerrarSesion() {
    await this.authService.cerrarSesion();
    void this.router.navigate(['/login']);
  }

  async eliminarCuenta() {
    const confirmDelete = window.confirm(
      'Esta accion eliminara tu cuenta y sus datos. Deseas continuar?'
    );

    if (!confirmDelete) {
      return;
    }

    this.isDeleting = true;
    this.showFeedback('', 'success');

    try {
      await this.authService.eliminarCuenta();
      void this.router.navigate(['/home']);
    } catch (error) {
      this.showFeedback(this.authService.traducirErrorFirebase(error), 'error');
    } finally {
      this.isDeleting = false;
    }
  }

  private async cargarPerfil() {
    this.showFeedback('', 'success');

    if (this.currentUser) {
      this.formData = {
        ...this.formData,
        email: this.formData.email || this.currentUser.email || '',
        nombre: this.formData.nombre || this.currentUser.displayName || '',
      };
    }

    try {
      const response = await this.authService.obtenerPerfil();
      this.formData = {
        nombre: response.user.nombre || '',
        email: response.user.email || this.currentUser?.email || '',
        telefono: response.user.telefono || '',
        nit: response.user.nit || '',
      };
      this.companyData = {
        ...this.companyData,
        nombre: this.companyData.nombre || response.user.nombre || '',
        correo: this.companyData.correo || response.user.email || this.currentUser?.email || '',
        telefono: this.companyData.telefono || response.user.telefono || '',
        nitEmpresa: this.companyData.nitEmpresa || response.user.nit || '',
      };
    } catch (error) {
      if (this.currentUser && !this.formData.email) {
        this.formData.email = this.currentUser.email || '';
      }
      this.showFeedback(this.authService.traducirErrorFirebase(error), 'error');
    }
  }

  private showFeedback(message: string, type: 'success' | 'error') {
    this.feedbackMessage = message;
    this.feedbackType = type;
  }

  private async syncOperationalData() {
    try {
      const [alertsResponse, agentsResponse, notificationsResponse] = await Promise.all([
        this.operationsService.getAlerts(),
        this.operationsService.getAgents(),
        this.operationsService.getNotifications(),
      ]);

      this.zone.run(() => {
        this.applyAlerts(alertsResponse.alerts);
        this.applyAgents(agentsResponse.agents);
        this.applyNotifications(notificationsResponse.notifications);
      });
    } catch {
      // If backend sync fails, keep the last data rendered by the realtime listeners.
    }
  }

  private async waitForAlertAppearance(
    ubicacion: string,
    descripcion: string,
    throwOnTimeout = false
  ) {
    const timeoutAt = Date.now() + 6000;
    let shouldSync = false;

    while (Date.now() < timeoutAt) {
      const alert = this.recentAlerts.find(
        (item) => item.ubicacion === ubicacion && item.descripcion === descripcion
      );

      if (alert) {
        return alert;
      }

      if (shouldSync) {
        await this.syncOperationalData();
      }

      shouldSync = !shouldSync;
      await this.delay(500);
    }

    if (throwOnTimeout) {
      throw new Error('La alerta se guardo pero no se pudo sincronizar a tiempo.');
    }

    return null;
  }

  private async waitForAgentAppearance(codigo: string, throwOnTimeout = false) {
    const normalizedCode = codigo.trim().toUpperCase();
    const timeoutAt = Date.now() + 6000;
    let shouldSync = false;

    while (Date.now() < timeoutAt) {
      const agent = this.agents.find((item) => item.codigo === normalizedCode);

      if (agent) {
        return agent;
      }

      if (shouldSync) {
        await this.syncOperationalData();
      }

      shouldSync = !shouldSync;
      await this.delay(500);
    }

    if (throwOnTimeout) {
      throw new Error('El agente se guardo pero no se pudo sincronizar a tiempo.');
    }

    return null;
  }

  private async delay(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private parseCurrency(value: string) {
    const normalizedValue = Number(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(normalizedValue) ? normalizedValue : 0;
  }

  private formatCurrency(value: number) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
  }

  private bindRealtimeDashboard() {
    this.teardownDashboardSubscriptions();

    this.dashboardUnsubscribes = [
      this.dashboardDataService.watchAlerts((items) => {
        this.zone.run(() => {
          this.applyAlerts(items);
        });
      }),
      this.dashboardDataService.watchAgents((items) => {
        this.zone.run(() => {
          this.applyAgents(items);
        });
      }),
      this.dashboardDataService.watchNotifications((items) => {
        this.zone.run(() => {
          this.applyNotifications(items);
        });
      }),
      this.dashboardDataService.watchHistory((items) => {
        this.zone.run(() => {
          this.historyRows = items;
        });
      }),
      this.dashboardDataService.watchBilling((items) => {
        this.zone.run(() => {
          this.billingRows = items;
        });
      }),
      this.dashboardDataService.watchCompany((item) => {
        this.zone.run(() => {
          this.companyData = {
            ...this.companyData,
            ...item,
            nombre: item.nombre || this.companyData.nombre || this.formData.nombre || '',
            correo: item.correo || this.companyData.correo || this.formData.email || '',
            telefono: item.telefono || this.companyData.telefono || this.formData.telefono || '',
            nitEmpresa: item.nitEmpresa || this.companyData.nitEmpresa || this.formData.nit || '',
          };
        });
      }),
    ];
  }

  private teardownDashboardSubscriptions() {
    this.dashboardUnsubscribes.forEach((unsubscribe) => unsubscribe());
    this.dashboardUnsubscribes = [];
  }

  private startRealtimeFeed() {
    const updateRealtimeClock = () => {
      const now = new Date();
      this.realtimeClock = now.toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      this.livePulse = (this.livePulse + 1) % 1000;
    };

    updateRealtimeClock();
    this.liveInterval = setInterval(updateRealtimeClock, 1000);
  }

  private startOperationsSync() {
    if (this.operationsSyncInterval) {
      clearInterval(this.operationsSyncInterval);
    }

    this.operationsSyncInterval = setInterval(() => {
      void this.syncOperationalData();
    }, 2000);
  }

  private buildCompanyProfileFromForm(overrides?: Partial<DashboardCompanyProfile>): DashboardCompanyProfile {
    return {
      ...this.companyData,
      nombre: this.formData.nombre || this.companyData.nombre || '',
      correo: this.formData.email || this.companyData.correo || '',
      telefono: this.formData.telefono || this.companyData.telefono || '',
      direccion: this.companyData.direccion || '',
      nitEmpresa: this.formData.nit || this.companyData.nitEmpresa || '',
      plan: this.companyData.plan || 'Plan base',
      estado: this.companyData.estado || 'Activa',
      ...overrides,
    };
  }

  private applyAlerts(items: DashboardAlert[]) {
    this.recentAlerts = items;

    if (!this.recentAlerts.some((alert) => alert.id === this.selectedAlertId)) {
      this.selectedAlertId = this.recentAlerts[0]?.id || '';
    }

    this.cdr.detectChanges();
  }

  private applyAgents(items: DashboardAgent[]) {
    this.agents = items;

    if (!this.agents.some((agent) => agent.codigo === this.selectedAgentCode)) {
      this.selectedAgentCode = this.agents[0]?.codigo || '';
    }

    this.cdr.detectChanges();
  }

  private applyNotifications(items: DashboardNotification[]) {
    this.notifications = items;
    this.cdr.detectChanges();
  }

  normalizeAlertStatus(status: DashboardAlert['estado']) {
    if (status === 'Nueva') {
      return 'En proceso';
    }

    if (status === 'Asignada') {
      return 'Asignado';
    }

    return status;
  }

  getAlertStatusClass(status: DashboardAlert['estado']) {
    const normalizedStatus = this.normalizeAlertStatus(status);

    if (normalizedStatus === 'En proceso') {
      return 'badge-danger';
    }

    if (normalizedStatus === 'En camino') {
      return 'badge-info';
    }

    if (normalizedStatus === 'Asignado') {
      return 'badge-success';
    }

    if (normalizedStatus === 'Finalizado') {
      return 'badge-neutral';
    }

    if (normalizedStatus === 'Cancelado') {
      return 'badge-danger';
    }

    return '';
  }

  private mergeAlert(alert: DashboardAlert) {
    return [
      alert,
      ...this.recentAlerts.filter((item) => item.id !== alert.id),
    ];
  }

  private mergeAgent(agent: DashboardAgent) {
    return [
      agent,
      ...this.agents.filter((item) => item.codigo !== agent.codigo),
    ];
  }

  private mergeNotification(notification: DashboardNotification) {
    return [
      notification,
      ...this.notifications.filter((item) => item.id !== notification.id),
    ];
  }
}
