import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { Location } from '@angular/common';
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
import {
  PaymentsService,
  PaymentMethodPreference,
  PaymentSetupStatusResponse,
} from '../../core/payments.service';
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

  profileForm = {
    nombre: '',
    email: '',
    telefono: '',
    nit: '',
    direccion: '',
    plan: '',
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
    telefono: '',
  };
  paymentForm = {
    amount: 5000,
    concept: 'Prueba de pago SOS.LIVE',
    cardholderName: '',
    cardNumber: '',
    cardExpiry: '',
    cardCvv: '',
    cardDocument: '',
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
  isLoadingPaymentSetup = false;
  feedbackMessage = '';
  feedbackType: 'success' | 'error' = 'success';
  paymentSetupStatus?: PaymentSetupStatusResponse;
  private profileFormDirty = false;

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
    private readonly location: Location,
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
    this.syncActiveSectionFromUrl(window.location.pathname || this.router.url);
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
        this.syncProfileForm(true);

        this.bindRealtimeDashboard(user.uid);
        await Promise.all([this.cargarPerfil(), this.loadPaymentSetupStatus()]);
        void this.confirmReturnedPaymentIfNeeded();
        this.showPaymentRequiredNoticeIfNeeded();
        await this.syncOperationalData();
        this.isLoading = false;
        this.startOperationsSync();
      });
    });
  }

  @HostListener('window:popstate')
  onBrowserPopState() {
    this.syncActiveSectionFromUrl(window.location.pathname || this.router.url);
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

  get shouldShowLoadingCard() {
    return (
      this.isLoading &&
      !this.recentAlerts.length &&
      !this.agents.length &&
      !this.notifications.length &&
      !this.historyRows.length &&
      !this.billingRows.length
    );
  }

  get averageServiceRating() {
    const ratedRows = this.historyRows.filter(
      (row) => row.calificacion !== null && row.calificacion !== undefined
    );

    if (!ratedRows.length) {
      return null;
    }

    const average =
      ratedRows.reduce((total, row) => total + Number(row.calificacion || 0), 0) / ratedRows.length;

    return Number(average.toFixed(1));
  }

  get summaryCards() {
    const activeAlerts = this.recentAlerts.filter(
      (alert) => {
        const status = this.normalizeAlertStatus(alert.estado);
        return status !== 'Finalizado' && status !== 'Cancelado';
      }
    ).length;
    const availableAgents = this.agents.filter((agent) => agent.estado === 'Disponible').length;
    const assignedAlerts = this.recentAlerts.filter(
      (alert) => this.normalizeAlertStatus(alert.estado) === 'Asignado'
    ).length;
    const closedServices = this.historyRows.filter((row) => row.estado === 'Completado').length;
    const cancelledServices = this.historyRows.filter((row) => row.estado === 'Cancelado').length;
    const ratingImpact =
      this.averageServiceRating === null ? 0 : Math.round((this.averageServiceRating - 3) * 12);
    const baseSecurityIndex =
      76 -
      activeAlerts * 7 -
      this.unreadNotificationsCount * 2 +
      closedServices * 2 -
      cancelledServices * 3;
    const securityIndex = Math.max(0, Math.min(100, baseSecurityIndex + ratingImpact));

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
        value:
          this.recentAlerts.length > 0 || this.historyRows.length > 0
            ? `${securityIndex}%`
            : 'N/D',
        detail:
          this.averageServiceRating === null
            ? 'Se ajusta con alertas, cierres y eventos reales'
            : `Incluye la calificacion real del servicio movil (${this.averageServiceRating}/5)`,
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
    const currentPath =
      (window.location.pathname || this.router.url || '')
        .split('?')[0]
        .split('#')[0]
        .replace(/\/+$/, '') || '/dashboard';

    this.activeSection = section;
    this.resetOperationalMapViewport();
    this.refreshOperationalMap(true);

    if (currentPath !== targetRoute) {
      this.location.go(targetRoute);
    }
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

    const serviceRating = this.resolveServiceRatingForFinalization(alert);

    if (serviceRating === false) {
      return;
    }

    try {
      const result = await this.operationsService.finalizeAlert(alert.id, {
        alert: { ...alert },
        ...(typeof serviceRating === 'number' ? { calificacion: serviceRating } : {}),
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
    const { nombre, usuario, password, codigo, zona, telefono } = this.newAgentForm;

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
    this.formData[field] = String(this.formData[field] || '').replace(/[^0-9]/g, '');
  }

  onlyNumbersProfile(field: 'telefono' | 'nit') {
    this.profileForm[field] = String(this.profileForm[field] || '').replace(/[^0-9]/g, '');
    this.profileFormDirty = true;
  }

  markProfileFormDirty() {
    this.profileFormDirty = true;
  }

  onlyNumbersAgent() {
    this.newAgentForm.telefono = this.newAgentForm.telefono.replace(/[^0-9]/g, '');
  }

  normalizePaymentAmount() {
    const amount = Number(this.paymentForm.amount);
    this.paymentForm.amount = Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
  }

  formatSimulatedCardholderName() {
    this.paymentForm.cardholderName = this.paymentForm.cardholderName
      .replace(/[^a-zA-ZÀ-ÿÑñ\s]/g, '')
      .replace(/\s{2,}/g, ' ')
      .slice(0, 70);
  }

  formatSimulatedCardNumber() {
    const digits = this.paymentForm.cardNumber.replace(/\D/g, '').slice(0, 19);
    this.paymentForm.cardNumber = digits;
  }

  formatSimulatedCardExpiry() {
    const digits = this.paymentForm.cardExpiry.replace(/\D/g, '').slice(0, 4);
    this.paymentForm.cardExpiry =
      digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
  }

  formatSimulatedCardCvv() {
    this.paymentForm.cardCvv = this.paymentForm.cardCvv.replace(/\D/g, '').slice(0, 3);
  }

  formatSimulatedCardDocument() {
    this.paymentForm.cardDocument = this.paymentForm.cardDocument.replace(/\D/g, '').slice(0, 12);
  }

  async startPayment(method: PaymentMethodPreference) {
    if (this.isLoadingPaymentSetup) {
      this.showFeedback('Estamos validando la pasarela Mercado Pago. Intenta de nuevo en unos segundos.', 'error');
      return;
    }

    if (this.paymentSetupStatus && !this.paymentSetupStatus.realPaymentsEnabled) {
      this.showFeedback(this.paymentSetupStatus.message, 'error');
      return;
    }

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

      this.openMercadoPagoCheckout(result);
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

    const cardValidationMessage = this.getSimulatedCardValidationMessage();

    if (cardValidationMessage) {
      this.showFeedback(cardValidationMessage, 'error');
      return;
    }

    this.isSimulatingPayment = true;
    this.showFeedback('', 'success');

    try {
      const result = await this.paymentsService.simulatePayment({
        amount: this.paymentForm.amount,
        concept: this.paymentForm.concept || 'Pago SOS.LIVE',
        method: method === 'pse' ? 'pse' : 'card',
        simulationCard: this.buildSimulatedCardPayload(),
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

  private getSimulatedCardValidationMessage() {
    const cardNumber = this.getSimulatedCardDigits();
    const holderName = this.paymentForm.cardholderName.trim();
    const document = this.paymentForm.cardDocument.trim();
    const cvv = this.paymentForm.cardCvv.trim();

    if (!holderName || !/^[a-zA-ZÀ-ÿÑñ\s]+$/.test(holderName)) {
      return 'Ingresa el nombre del titular de la tarjeta para simular el pago.';
    }

    if (cardNumber.length < 13 || cardNumber.length > 19 || !this.isValidCardNumber(cardNumber)) {
      return 'Ingresa un numero de tarjeta valido para la simulacion.';
    }

    if (!this.isValidCardExpiry(this.paymentForm.cardExpiry)) {
      return 'Ingresa una fecha de vencimiento valida en formato MM/AA.';
    }

    if (!/^\d{3}$/.test(cvv)) {
      return 'El CVV debe tener exactamente 3 numeros.';
    }

    if (!/^\d{5,12}$/.test(document)) {
      return 'El documento debe contener solo numeros.';
    }

    return '';
  }

  private buildSimulatedCardPayload() {
    const cardNumber = this.getSimulatedCardDigits();

    return {
      cardholderName: this.paymentForm.cardholderName.trim(),
      cardLast4: cardNumber.slice(-4),
      cardBrand: this.resolveCardBrand(cardNumber),
      cardExpiry: this.paymentForm.cardExpiry.trim(),
      cardDocument: this.paymentForm.cardDocument.trim(),
    };
  }

  private getSimulatedCardDigits() {
    return this.paymentForm.cardNumber.replace(/\D/g, '');
  }

  private isValidCardNumber(cardNumber: string) {
    let sum = 0;
    let shouldDouble = false;

    for (let index = cardNumber.length - 1; index >= 0; index -= 1) {
      let digit = Number(cardNumber.charAt(index));

      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      shouldDouble = !shouldDouble;
    }

    return sum % 10 === 0;
  }

  private isValidCardExpiry(value: string) {
    const match = /^(\d{2})\/(\d{2})$/.exec(value.trim());

    if (!match) {
      return false;
    }

    const month = Number(match[1]);
    const year = 2000 + Number(match[2]);

    if (month < 1 || month > 12) {
      return false;
    }

    const expiryDate = new Date(year, month, 0, 23, 59, 59);
    return expiryDate.getTime() >= Date.now();
  }

  private resolveCardBrand(cardNumber: string) {
    if (cardNumber.startsWith('4')) {
      return 'Visa';
    }

    if (/^5[1-5]/.test(cardNumber) || /^2[2-7]/.test(cardNumber)) {
      return 'Mastercard';
    }

    if (/^3[47]/.test(cardNumber)) {
      return 'American Express';
    }

    return 'Tarjeta';
  }

  private async confirmReturnedPaymentIfNeeded() {
    const transactionId =
      this.route.snapshot.queryParamMap.get('referenceCode') ||
      this.route.snapshot.queryParamMap.get('reference_sale') ||
      this.route.snapshot.queryParamMap.get('reference') ||
      this.route.snapshot.queryParamMap.get('payment_id') ||
      this.route.snapshot.queryParamMap.get('collection_id') ||
      this.route.snapshot.queryParamMap.get('id');

    if (!transactionId || this.isConfirmingPayment) {
      return;
    }

    this.isConfirmingPayment = true;
    this.showFeedback('Confirmando el estado real del pago con Mercado Pago...', 'success');

    try {
      const queryPayload: Record<string, string> = {};
      this.route.snapshot.queryParamMap.keys.forEach((key) => {
        queryPayload[key] = this.route.snapshot.queryParamMap.get(key) || '';
      });
      const result = await this.paymentsService.confirmTransaction(transactionId, queryPayload);
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
        this.paymentSetupStatus?.realPaymentsEnabled
          ? 'Para usar el panel de usuario debes registrar primero un pago con Mercado Pago.'
          : 'Para usar el panel de usuario debes registrar primero un pago. El cobro por Mercado Pago seguira bloqueado hasta configurar las credenciales en el backend.',
        'error'
      );
    }
  }

  private openMercadoPagoCheckout(result: {
    checkoutUrl?: string;
    checkoutForm?: {
      action: string;
      method: string;
      fields: Record<string, string>;
    } | null;
  }) {
    if (result.checkoutUrl) {
      window.location.href = result.checkoutUrl;
      return;
    }

    if (!result.checkoutForm) {
      this.showFeedback('Mercado Pago no retorno una URL de checkout.', 'error');
      return;
    }

    this.submitCheckoutForm(result.checkoutForm);
  }

  private submitCheckoutForm(checkoutForm: {
    action: string;
    method: string;
    fields: Record<string, string>;
  }) {
    const form = document.createElement('form');
    form.method = checkoutForm.method || 'POST';
    form.action = checkoutForm.action;
    form.style.display = 'none';

    Object.entries(checkoutForm.fields || {}).forEach(([name, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = String(value ?? '');
      form.appendChild(input);
    });

    document.body.appendChild(form);
    form.submit();
  }

  private async loadPaymentSetupStatus() {
    this.isLoadingPaymentSetup = true;

    try {
      this.paymentSetupStatus = await this.paymentsService.getSetupStatus();
    } catch {
      this.paymentSetupStatus = undefined;
    } finally {
      this.isLoadingPaymentSetup = false;
    }
  }

  async guardarCambios() {
    const nombre = this.profileForm.nombre.trim();
    const email = this.profileForm.email.trim();
    const telefono = this.profileForm.telefono.trim();
    const nit = this.profileForm.nit.trim();
    const direccion = this.profileForm.direccion.trim();
    const plan = this.profileForm.plan.trim();

    if (!nombre || !email || !telefono || !nit || !direccion || !plan) {
      this.showFeedback('Completa todos los campos del perfil de empresa antes de guardar.', 'error');
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
      this.syncProfileForm(true);

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
        nombre: response.user.nombre || this.companyData.nombre || '',
        correo: response.user.email || this.currentUser?.email || this.companyData.correo || '',
        telefono: response.user.telefono || this.companyData.telefono || '',
        direccion: response.user.direccion || this.companyData.direccion || '',
        nitEmpresa: response.user.nit || this.companyData.nitEmpresa || '',
        plan: response.user.plan || this.companyData.plan || 'Plan base',
        estado: response.user.estado || this.companyData.estado || 'Activa',
      };
      this.syncProfileForm();
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

  private async syncOperationalData(options: { includeBilling?: boolean } = {}) {
    const includeBilling = options.includeBilling !== false;

    try {
      const [snapshotResponse, billingResponse] = await Promise.all([
        this.operationsService.getDashboardSnapshot(),
        includeBilling
          ? this.paymentsService.getBillingHistory()
          : Promise.resolve({ payments: this.billingRows }),
      ]);

      this.zone.run(() => {
        this.applyAlerts(snapshotResponse.alerts);
        this.applyAgents(snapshotResponse.agents);
        this.applyNotifications(snapshotResponse.notifications);
        this.historyRows = snapshotResponse.history;
        this.billingRows = this.filterBillingRowsForActiveCompany(billingResponse.payments);
        this.cdr.detectChanges();
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
        await this.syncOperationalData({ includeBilling: false });
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
        await this.syncOperationalData({ includeBilling: false });
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

  private bindRealtimeDashboard(companyUid: string) {
    this.teardownDashboardSubscriptions();

    this.dashboardUnsubscribes = [
      this.dashboardDataService.watchAlerts(companyUid, (items) => {
        this.zone.run(() => {
          this.applyAlerts(items);
        });
      }),
      this.dashboardDataService.watchAgents(companyUid, (items) => {
        this.zone.run(() => {
          this.applyAgents(items);
        });
      }),
      this.dashboardDataService.watchNotifications(companyUid, (items) => {
        this.zone.run(() => {
          this.applyNotifications(items);
        });
      }),
      this.dashboardDataService.watchHistory(companyUid, (items) => {
        this.zone.run(() => {
          this.historyRows = items;
        });
      }),
      this.dashboardDataService.watchBilling(companyUid, (items) => {
        this.zone.run(() => {
          this.billingRows = this.filterBillingRowsForActiveCompany(items, companyUid);
        });
      }),
      this.dashboardDataService.watchCompany(companyUid, (item) => {
        this.zone.run(() => {
          this.companyData = {
            ...this.companyData,
            ...item,
            nombre: item.nombre || this.companyData.nombre || this.formData.nombre || '',
            correo: item.correo || this.companyData.correo || this.formData.email || '',
            telefono: item.telefono || this.companyData.telefono || this.formData.telefono || '',
            nitEmpresa: item.nitEmpresa || this.companyData.nitEmpresa || this.formData.nit || '',
          };
          this.syncProfileForm();
          this.refreshOperationalMap();
        });
      }),
    ];
  }

  private teardownDashboardSubscriptions() {
    this.dashboardUnsubscribes.forEach((unsubscribe) => unsubscribe());
    this.dashboardUnsubscribes = [];
  }

  private filterBillingRowsForActiveCompany(
    rows: DashboardBillingRow[] = [],
    companyUid = this.resolveActiveCompanyUid()
  ) {
    const normalizedCompanyUid = String(companyUid || '').trim();

    if (!normalizedCompanyUid) {
      return [];
    }

    return rows.filter((row) => String(row.companyUid || '').trim() === normalizedCompanyUid);
  }

  private resolveActiveCompanyUid() {
    return String(this.authService.getCachedProfile()?.uid || this.currentUser?.uid || '').trim();
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
    }, 20000);
  }

  private syncProfileForm(force = false) {
    if (this.profileFormDirty && !force) {
      return;
    }

    this.profileForm = {
      nombre: this.formData.nombre || this.companyData.nombre || '',
      email: this.formData.email || this.companyData.correo || '',
      telefono: String(this.formData.telefono || this.companyData.telefono || ''),
      nit: this.formData.nit || this.companyData.nitEmpresa || '',
      direccion: this.companyData.direccion || '',
      plan: this.companyData.plan || '',
    };
    this.profileFormDirty = false;
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

  private resolveServiceRatingForFinalization(alert: DashboardAlert) {
    const isMobileService =
      alert.tipo === 'SOS movil' || alert.source === 'mobile_notice' || !!alert.sourceNoticeId;

    if (!isMobileService) {
      return undefined;
    }

    const userInput = window.prompt(
      'Califica el servicio movil de 1 a 5 antes de finalizarlo.',
      String(alert.calificacionServicio || 5)
    );

    if (userInput === null) {
      this.showFeedback('Debes confirmar la calificacion para finalizar el servicio movil.', 'error');
      return false;
    }

    const rating = Number(userInput);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      this.showFeedback('La calificacion del servicio movil debe estar entre 1 y 5.', 'error');
      return false;
    }

    return rating;
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
