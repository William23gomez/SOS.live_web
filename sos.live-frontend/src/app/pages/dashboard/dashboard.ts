import { ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavigationEnd, Router } from '@angular/router';
import { onAuthStateChanged, Unsubscribe, User } from 'firebase/auth';
import { Subscription } from 'rxjs';
import * as L from 'leaflet';

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
import {
  getMapQueryLabel,
  resolveAgentMapLocation,
  resolveAlertMapLocation,
  resolveCompanyMapLocation,
} from '../../core/operational-map.util';
import { OperationsService } from '../../core/operations.service';
import { PaymentsService, PaymentMethodPreference } from '../../core/payments.service';
import { auth } from '../../core/firebase.config';

type DashboardSection =
  | 'overview'
  | 'alerts'
  | 'agents'
  | 'history'
  | 'company'
  | 'billing'
  | 'notifications';

const SECTION_ROUTE_MAP: Record<DashboardSection, string> = {
  overview: '/dashboard',
  alerts: '/alertas',
  agents: '/agentes',
  history: '/historial',
  company: '/perfil-empresa',
  billing: '/pagos',
  notifications: '/notificaciones',
};

const DEFAULT_MAP_CENTER: L.LatLngTuple = [4.6097, -74.0817];
const DEFAULT_MAP_ZOOM = 11;
const SINGLE_MARKER_FOCUS_ZOOM = 18;
const MULTI_MARKER_MAX_FIT_ZOOM = 17;

type OperationalMapMarker = {
  kind: 'alerta' | 'agente' | 'sede';
  label: string;
  location: { lat: number; lng: number };
  alertId: string | null;
};

@Component({
  selector: 'app-dashboard',
  standalone: false,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit, OnDestroy {
  @ViewChild('operationalMapContainer')
  set operationalMapContainerRef(element: ElementRef<HTMLDivElement> | undefined) {
    this.operationalMapHost = element?.nativeElement;

    if (this.operationalMapHost) {
      setTimeout(() => {
        this.initializeOperationalMap();
      }, 0);
      return;
    }

    this.destroyOperationalMap();
  }

  activeSection: DashboardSection = 'overview';

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
    usuario: '',
    password: '',
    codigo: '',
    zona: '',
    ubicacionExacta: '',
    telefono: '',
  };
  paymentForm = {
    amount: 5000,
    concept: 'Prueba de pago SOS.LIVE',
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
  isCreatingPayment = false;
  isSimulatingPayment = false;
  isConfirmingPayment = false;
  feedbackMessage = '';
  feedbackType: 'success' | 'error' = 'success';

  private unsubscribeAuth?: Unsubscribe;
  private liveInterval?: ReturnType<typeof setInterval>;
  private operationsSyncInterval?: ReturnType<typeof setInterval>;
  private dashboardUnsubscribes: Unsubscribe[] = [];
  private navigationSubscription?: Subscription;
  private operationalMap?: L.Map;
  private operationalMapLayer?: L.LayerGroup;
  private operationalMapHost?: HTMLDivElement;
  private lastOperationalMapSignature = '';
  private operationalMapViewportPinned = false;
  private isApplyingOperationalViewport = false;

  constructor(
    private readonly zone: NgZone,
    private readonly cdr: ChangeDetectorRef,
    private readonly authService: AuthService,
    private readonly dashboardDataService: DashboardDataService,
    private readonly operationsService: OperationsService,
    private readonly paymentsService: PaymentsService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit() {
    this.startRealtimeFeed();
    this.syncActiveSectionFromUrl(this.router.url);
    this.navigationSubscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.syncActiveSectionFromUrl(event.urlAfterRedirects || event.url);
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
        await this.confirmReturnedPaymentIfNeeded();
        this.showPaymentRequiredNoticeIfNeeded();
        await this.syncOperationalData();
        this.isLoading = false;
        this.startOperationsSync();
      });
    });
  }

  ngOnDestroy() {
    this.unsubscribeAuth?.();
    this.navigationSubscription?.unsubscribe();
    this.dashboardUnsubscribes.forEach((unsubscribe) => unsubscribe());
    this.destroyOperationalMap();
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

  setActiveSection(section: DashboardSection) {
    this.activeSection = section;
  }

  navigateToSection(section: DashboardSection) {
    const targetRoute = SECTION_ROUTE_MAP[section];

    if (this.router.url === targetRoute) {
      this.activeSection = section;
      return;
    }

    void this.router.navigate([targetRoute]);
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

  get operationalAlerts() {
    return this.recentAlerts.filter((alert) => this.isAlertVisibleOnMap(alert));
  }

  get operationalAlertsCount() {
    return this.operationalAlerts.length;
  }

  get activeOperationalAlert() {
    if (this.isAlertVisibleOnMap(this.selectedAlert)) {
      return this.selectedAlert;
    }

    return this.operationalAlerts[0] || null;
  }

  get mapQuery() {
    if (this.activeSection === 'agents') {
      const activeAgent = this.selectedAgent || this.agents[0];
      return getMapQueryLabel(
        resolveAgentMapLocation(activeAgent),
        (activeAgent ? this.getAgentLocationLabel(activeAgent) : '') ||
          this.companyData.direccion ||
          'Bogota Colombia'
      );
    }

    if (this.activeSection === 'company') {
      return getMapQueryLabel(
        resolveCompanyMapLocation(this.companyData),
        this.companyData.direccion || 'Bogota Colombia'
      );
    }

    return getMapQueryLabel(
      resolveAlertMapLocation(this.activeOperationalAlert),
      this.activeOperationalAlert?.ubicacion ||
        this.selectedAgent?.zona ||
        this.agents[0]?.zona ||
        this.companyData.direccion ||
        'Bogota Colombia'
    );
  }

  get mapContextLabel() {
    return this.mapQuery || 'Bogotá, Colombia';
  }

  get activeMapLocation() {
    if (this.activeSection === 'agents') {
      return resolveAgentMapLocation(this.selectedAgent || this.agents[0]);
    }

    if (this.activeSection === 'company') {
      return resolveCompanyMapLocation(this.companyData);
    }

    return resolveAlertMapLocation(this.activeOperationalAlert);
  }

  get activeMapCoordinatesLabel() {
    const location = this.activeMapLocation;

    if (!this.hasMapCoordinates(location)) {
      return '';
    }

    const lat = Number(location?.lat);
    const lng = Number(location?.lng);

    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }

  get externalMapUrl() {
    const location = this.activeMapLocation;

    if (this.hasMapCoordinates(location)) {
      const lat = Number(location?.lat);
      const lng = Number(location?.lng);
      return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    }

    const query = encodeURIComponent(this.mapQuery);
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  }

  get availableAgents() {
    const search = this.agentSearch.trim().toLowerCase();

    return this.agents.filter((agent) => {
      const matchesSearch =
        !search ||
        [agent.nombre, agent.codigo, agent.usuario || '', agent.zona, agent.estado].some((value) =>
          value.toLowerCase().includes(search)
        );

      return matchesSearch;
    });
  }

  get selectedAgent() {
    return this.agents.find((agent) => agent.codigo === this.selectedAgentCode) || null;
  }

  get assignableAgents() {
    return this.agents.filter((agent) => {
      if (agent.estado === 'Disponible') {
        return true;
      }

      return !!this.selectedAlert && this.selectedAlert.agenteAsignado === agent.nombre;
    });
  }

  get canAssignSelectedAlert() {
    return !!this.selectedAlert && !this.isSelectedAlertClosed;
  }

  get canFinalizeSelectedAlert() {
    return !!this.selectedAlert && !this.isSelectedAlertClosed;
  }

  get canCancelSelectedAlert() {
    return !!this.selectedAlert && !this.isSelectedAlertClosed;
  }

  get isSelectedAlertClosed() {
    return (
      this.selectedAlertServiceStatus === 'Finalizado' ||
      this.selectedAlertServiceStatus === 'Cancelado'
    );
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
    this.syncSelectedAgentSelection();
    this.resetOperationalMapViewport();
    this.refreshOperationalMap(true);
  }

  focusAlertFromMap(alertId: string | null) {
    if (!alertId) {
      this.navigateToSection('overview');
      return;
    }

    this.selectedAlertId = alertId;
    this.navigateToSection('alerts');
  }

  async assignSelectedAgent() {
    const alert = this.selectedAlert;
    const agent = this.selectedAgent;

    if (
      alert &&
      (this.normalizeAlertStatus(alert.estado) === 'Finalizado' ||
        this.normalizeAlertStatus(alert.estado) === 'Cancelado')
    ) {
      this.showFeedback('La alerta seleccionada ya no admite asignacion de agentes.', 'error');
      return;
    }

    if (!alert || !agent) {
      this.showFeedback('Selecciona una alerta y un agente para continuar.', 'error');
      return;
    }

    if (agent.estado !== 'Disponible' && alert.agenteAsignado !== agent.nombre) {
      this.showFeedback('El agente seleccionado no esta disponible para una nueva asignacion.', 'error');
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

    if (this.normalizeAlertStatus(alert.estado) === 'Cancelado') {
      this.showFeedback('No puedes finalizar una alerta cancelada.', 'error');
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

      this.navigateToSection('alerts');
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
        this.navigateToSection('alerts');
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
    const { nombre, usuario, password, codigo, zona, ubicacionExacta, telefono } = this.newAgentForm;

    if (!nombre || !usuario || !password || !codigo || !zona || !telefono) {
      this.showFeedback('Completa todos los campos del agente.', 'error');
      return;
    }

    if (!/^[a-zA-Z0-9._-]{4,}$/.test(usuario.trim())) {
      this.showFeedback(
        'El usuario del agente debe tener minimo 4 caracteres y solo puede usar letras, numeros, punto, guion o guion bajo.',
        'error'
      );
      return;
    }

    if (!/^\d+$/.test(telefono)) {
      this.showFeedback('El telefono del agente solo puede contener numeros.', 'error');
      return;
    }

    if (password.length < 6) {
      this.showFeedback('La contraseña debe tener al menos 6 caracteres.', 'error');
      return;
    }

    this.isCreatingAgent = true;
    this.showFeedback('', 'success');

    try {
      const payload = {
        nombre,
        usuario,
        password,
        codigo,
        zona,
        ubicacionExacta,
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
        usuario: '',
        password: '',
        codigo: '',
        zona: '',
        ubicacionExacta: '',
        telefono: '',
      };
      this.showFeedback(
        'Agente creado correctamente. Comparte con el agente su codigo, usuario y contraseña.',
        'success'
      );
    } catch (error) {
      const syncedAgent = await this.waitForAgentAppearance(codigo);

      if (syncedAgent) {
        this.applyAgents(this.mergeAgent(syncedAgent));
        this.selectedAgentCode = syncedAgent.codigo;
        this.newAgentForm = {
          nombre: '',
          usuario: '',
          password: '',
          codigo: '',
          zona: '',
          ubicacionExacta: '',
          telefono: '',
        };
        this.showFeedback(
          'Agente creado correctamente. Comparte con el agente su codigo, usuario y contraseña.',
          'success'
        );
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

  normalizePaymentAmount() {
    const amount = Number(this.paymentForm.amount);
    this.paymentForm.amount = Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
  }

  async startPayment(method: PaymentMethodPreference) {
    this.normalizePaymentAmount();

    if (!this.paymentForm.amount || this.paymentForm.amount < 1000) {
      this.showFeedback('Ingresa un monto minimo de $1.000 COP para probar el pago.', 'error');
      return;
    }

    this.isCreatingPayment = true;
    this.showFeedback('', 'success');

    try {
      const result = await this.paymentsService.createCheckout({
        amount: this.paymentForm.amount,
        concept: this.paymentForm.concept || 'Pago SOS.LIVE',
        method,
      });

      window.location.assign(result.checkoutUrl);
    } catch (error) {
      this.showFeedback(this.paymentsService.translatePaymentError(error), 'error');
    } finally {
      this.isCreatingPayment = false;
    }
  }

  async simulatePayment(method: PaymentMethodPreference = 'checkout') {
    this.normalizePaymentAmount();

    if (!this.paymentForm.amount || this.paymentForm.amount < 1000) {
      this.showFeedback('Ingresa un monto minimo de $1.000 COP para simular el pago.', 'error');
      return;
    }

    this.isSimulatingPayment = true;
    this.showFeedback('', 'success');

    try {
      const result = await this.paymentsService.simulatePayment({
        amount: this.paymentForm.amount,
        concept: this.paymentForm.concept || 'Pago SOS.LIVE',
        method,
      });
      const reference = String(result.payment['reference'] || result.reference || '');

      this.showFeedback(
        `Pago simulado aprobado y registrado en admin${reference ? `: ${reference}` : ''}.`,
        'success'
      );

      const redirectTarget = this.route.snapshot.queryParamMap.get('redirect');

      if (redirectTarget && redirectTarget !== '/pagos') {
        setTimeout(() => {
          void this.router.navigate([redirectTarget], { replaceUrl: true });
        }, 700);
      }
    } catch (error) {
      this.showFeedback(this.paymentsService.translatePaymentError(error), 'error');
    } finally {
      this.isSimulatingPayment = false;
    }
  }

  private async confirmReturnedPaymentIfNeeded() {
    const transactionId =
      this.route.snapshot.queryParamMap.get('payment_id') ||
      this.route.snapshot.queryParamMap.get('collection_id') ||
      this.route.snapshot.queryParamMap.get('id');

    if (!transactionId || this.isConfirmingPayment) {
      return;
    }

    this.isConfirmingPayment = true;
    this.showFeedback('Confirmando el estado real del pago con Mercado Pago...', 'success');

    try {
      const result = await this.paymentsService.confirmTransaction(transactionId);
      const status = String(result.payment['estado'] || '');

      this.showFeedback(
        status === 'Completado'
          ? 'Pago aprobado y registrado en el panel admin.'
          : `Pago actualizado con estado: ${status || 'Pendiente'}.`,
        status === 'Completado' ? 'success' : 'error'
      );
      void this.router.navigate(['/pagos'], { replaceUrl: true });
    } catch (error) {
      this.showFeedback(this.paymentsService.translatePaymentError(error), 'error');
    } finally {
      this.isConfirmingPayment = false;
    }
  }

  private showPaymentRequiredNoticeIfNeeded() {
    const paymentRequired = this.route.snapshot.queryParamMap.get('required') === 'payment';

    if (this.activeSection === 'billing' && paymentRequired && !this.feedbackMessage) {
      this.showFeedback(
        'Para usar el panel de usuario debes registrar primero un pago. Puedes simularlo mientras activas Mercado Pago.',
        'error'
      );
    }
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
          this.refreshOperationalMap();
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

    this.syncSelectedAgentSelection();
    this.refreshOperationalMap();

    this.cdr.detectChanges();
  }

  private applyAgents(items: DashboardAgent[]) {
    this.agents = items;

    if (!this.agents.some((agent) => agent.codigo === this.selectedAgentCode)) {
      this.selectedAgentCode = this.agents[0]?.codigo || '';
    }

    this.syncSelectedAgentSelection();
    this.refreshOperationalMap();

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

  private syncSelectedAgentSelection() {
    if (!this.selectedAlert) {
      if (!this.agents.some((agent) => agent.codigo === this.selectedAgentCode)) {
        this.selectedAgentCode = this.agents[0]?.codigo || '';
      }
      return;
    }

    const assignedAgent = this.agents.find(
      (agent) => agent.nombre === this.selectedAlert?.agenteAsignado
    );

    if (assignedAgent) {
      this.selectedAgentCode = assignedAgent.codigo;
      return;
    }

    const assignableCodes = new Set(this.assignableAgents.map((agent) => agent.codigo));

    if (!assignableCodes.has(this.selectedAgentCode)) {
      this.selectedAgentCode = this.assignableAgents[0]?.codigo || '';
    }
  }

  private syncActiveSectionFromUrl(url: string) {
    const normalizedUrl = (url || '').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/dashboard';
    const matchedSection = (Object.entries(SECTION_ROUTE_MAP).find(
      ([, route]) => route === normalizedUrl
    )?.[0] || 'overview') as DashboardSection;

    this.activeSection = matchedSection;
    this.refreshOperationalMap(true);
  }

  getAgentLocationLabel(agent: DashboardAgent) {
    return (
      agent.ubicacionExacta ||
      agent.ultimaUbicacionTexto ||
      agent.mapa?.label ||
      agent.mapa?.query ||
      agent.zona
    );
  }

  getAgentLastSeenLabel(agent: DashboardAgent) {
    if (!agent.ultimaConexionAt) {
      return 'Sin registro de acceso reciente';
    }

    const parsedDate = new Date(agent.ultimaConexionAt);

    if (Number.isNaN(parsedDate.getTime())) {
      return 'Sin registro de acceso reciente';
    }

    return parsedDate.toLocaleString('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  }

  private initializeOperationalMap() {
    if (!this.operationalMapHost) {
      return;
    }

    if (this.operationalMap) {
      setTimeout(() => this.operationalMap?.invalidateSize(), 0);
      this.refreshOperationalMap();
      return;
    }

    this.operationalMap = L.map(this.operationalMapHost, {
      zoomControl: true,
      attributionControl: true,
      minZoom: 5,
      maxZoom: 22,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      dragging: true,
      touchZoom: true,
      boxZoom: true,
    }).setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);

    this.operationalMap.on('movestart zoomstart', () => {
      if (!this.isApplyingOperationalViewport) {
        this.operationalMapViewportPinned = true;
      }
    });

    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      {
        attribution:
          'Tiles &copy; Esri, HERE, Garmin, USGS, OpenStreetMap contributors, and the GIS User Community',
        maxZoom: 22,
      }
    ).addTo(this.operationalMap);

    this.operationalMapLayer = L.layerGroup().addTo(this.operationalMap);
    this.refreshOperationalMap(true);
  }

  private destroyOperationalMap() {
    this.operationalMapLayer?.clearLayers();
    this.operationalMapLayer = undefined;
    this.operationalMap?.remove();
    this.operationalMap = undefined;
    this.lastOperationalMapSignature = '';
  }

  private refreshOperationalMap(forceRefresh = false) {
    if (!this.operationalMap || !this.operationalMapLayer) {
      return;
    }

    const markers = this.buildOperationalMapMarkers();
    const signature = JSON.stringify(
      markers.map((marker) => ({
        kind: marker.kind,
        lat: marker.location.lat,
        lng: marker.location.lng,
        label: marker.label,
        alertId: marker.alertId,
      }))
    );

    if (!forceRefresh && signature === this.lastOperationalMapSignature) {
      return;
    }

    this.lastOperationalMapSignature = signature;
    this.operationalMapLayer.clearLayers();

    if (!markers.length) {
      this.applyOperationalViewport(() => {
        this.operationalMap?.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, {
          animate: false,
        });
      });
      setTimeout(() => this.operationalMap?.invalidateSize(), 0);
      return;
    }

    const bounds = L.latLngBounds([]);

    markers.forEach((marker, index) => {
      const markerRef = L.marker([marker.location.lat, marker.location.lng], {
        icon: this.buildLeafletMarkerIcon(marker.kind),
      });

      markerRef.bindPopup(marker.label, {
        closeButton: false,
        autoPan: true,
      });

      if (marker.alertId) {
        markerRef.on('click', () => {
          this.zone.run(() => {
            this.focusAlertFromMap(marker.alertId);
          });
        });
      }

      markerRef.addTo(this.operationalMapLayer!);
      bounds.extend(markerRef.getLatLng());

      if (index === 0 && (forceRefresh || !this.operationalMapViewportPinned)) {
        markerRef.openPopup();
      }
    });

    if (forceRefresh || !this.operationalMapViewportPinned) {
      this.applyOperationalViewport(() => {
        if (markers.length === 1) {
          this.operationalMap?.setView(bounds.getCenter(), SINGLE_MARKER_FOCUS_ZOOM, {
            animate: false,
          });
          return;
        }

        this.operationalMap?.fitBounds(bounds.pad(0.12), {
          maxZoom: MULTI_MARKER_MAX_FIT_ZOOM,
          animate: false,
        });
      });
    }

    setTimeout(() => this.operationalMap?.invalidateSize(), 0);
  }

  private buildLeafletMarkerIcon(kind: OperationalMapMarker['kind']) {
    const iconClass =
      kind === 'alerta'
        ? 'custom-map-marker-alert'
        : kind === 'agente'
          ? 'custom-map-marker-agent'
          : 'custom-map-marker-company';
    const iconName =
      kind === 'alerta'
        ? 'bi-exclamation-diamond-fill'
        : kind === 'agente'
          ? 'bi-broadcast-pin'
          : 'bi-building-fill';

    return L.divIcon({
      className: 'custom-map-marker-shell',
      html: `<span class="custom-map-marker ${iconClass}"><i class="bi ${iconName}"></i></span>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
      popupAnchor: [0, -18],
    });
  }

  private buildOperationalMapMarkers(): OperationalMapMarker[] {
    const prioritizedAlerts = this.activeOperationalAlert
      ? [
          this.activeOperationalAlert,
          ...this.operationalAlerts.filter((alert) => alert.id !== this.activeOperationalAlert?.id),
        ]
      : this.operationalAlerts;
    const prioritizedAgents = this.selectedAgent
      ? [this.selectedAgent, ...this.agents.filter((agent) => agent.codigo !== this.selectedAgent?.codigo)]
      : this.agents;

    const alertMarkers: OperationalMapMarker[] = [];
    prioritizedAlerts.forEach((alert) => {
      const location = resolveAlertMapLocation(alert);

      if (!this.hasMapCoordinates(location)) {
        return;
      }

      alertMarkers.push({
        kind: 'alerta',
        label: `${alert.tipo} - ${alert.ubicacion}`,
        location: {
          lat: Number(location?.lat),
          lng: Number(location?.lng),
        },
        alertId: alert.id,
      });
    });

    const agentMarkers: OperationalMapMarker[] = [];
    prioritizedAgents.forEach((agent) => {
      const location = resolveAgentMapLocation(agent);

      if (!this.hasMapCoordinates(location)) {
        return;
      }

      agentMarkers.push({
        kind: 'agente',
        label: `${agent.nombre} - ${this.getAgentLocationLabel(agent)}`,
        location: {
          lat: Number(location?.lat),
          lng: Number(location?.lng),
        },
        alertId: null,
      });
    });

    if (alertMarkers.length || agentMarkers.length) {
      return [...alertMarkers.slice(0, 6), ...agentMarkers.slice(0, 6)];
    }

    const companyLocation = resolveCompanyMapLocation(this.companyData);

    if (!this.hasMapCoordinates(companyLocation) || !this.companyData.direccion) {
      return [];
    }

    return [
      {
        kind: 'sede',
        label: `Sede - ${this.companyData.direccion}`,
        location: {
          lat: Number(companyLocation?.lat),
          lng: Number(companyLocation?.lng),
        },
        alertId: null,
      },
    ];
  }

  private hasMapCoordinates(location: { lat?: number; lng?: number } | null | undefined) {
    return Number.isFinite(Number(location?.lat)) && Number.isFinite(Number(location?.lng));
  }

  private isAlertVisibleOnMap(alert?: DashboardAlert | null) {
    if (!alert) {
      return false;
    }

    const normalizedStatus = this.normalizeAlertStatus(alert.estado);
    return normalizedStatus !== 'Finalizado' && normalizedStatus !== 'Cancelado';
  }

  private resetOperationalMapViewport() {
    this.operationalMapViewportPinned = false;
  }

  private applyOperationalViewport(applyView: () => void) {
    this.isApplyingOperationalViewport = true;
    applyView();
    this.isApplyingOperationalViewport = false;
  }
}
