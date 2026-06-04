import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { onAuthStateChanged, reload, Unsubscribe, User } from 'firebase/auth';

import { AuthService } from './auth.service';
import {
  DashboardAgent,
  DashboardAlert,
  DashboardBillingRow,
  DashboardCompanyProfile,
  DashboardDataService,
  DashboardHistoryRow,
  DashboardNotification,
} from './dashboard-data.service';
import { OperationsService } from './operations.service';
import { auth } from './firebase.config';

type DashboardSection =
  | 'overview'
  | 'alerts'
  | 'agents'
  | 'history'
  | 'company'
  | 'billing'
  | 'notifications';

@Injectable({ providedIn: 'root' })
export class DashboardStateService {
  activeSection: DashboardSection = 'overview';

  formData = {
    nombre: '',
    email: '',
    telefono: '',
    nit: '',
  };

  agentFormData = {
    nombre: '',
    usuario: '',
    password: '',
    codigo: '',
    zona: '',
    telefono: '',
  };

  recentAlerts: DashboardAlert[] = [];
  agents: DashboardAgent[] = [];
  historyRows: DashboardHistoryRow[] = [];
  notifications: DashboardNotification[] = [];
  billingRows: DashboardBillingRow[] = [];

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
  feedbackMessage = '';
  feedbackType: 'success' | 'error' = 'success';

  private unsubscribeAuth?: Unsubscribe;
  private liveInterval?: ReturnType<typeof setInterval>;
  private dashboardUnsubscribes: Unsubscribe[] = [];
  private initialized = false;

  constructor(
    private readonly authService: AuthService,
    private readonly dashboardDataService: DashboardDataService,
    private readonly operationsService: OperationsService,
    private readonly router: Router
  ) {}

  initialize() {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.startRealtimeFeed();
    this.bindAuth();
  }

  setActiveSection(section: DashboardSection) {
    this.activeSection = section;
  }

  get isEmailVerified() {
    return !!this.currentUser?.emailVerified;
  }

  get displayName() {
    return this.formData.nombre || this.currentUser?.displayName || 'Usuario SOS.LIVE';
  }

  get userInitials() {
    return this.displayName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((segment) => segment.charAt(0).toUpperCase())
      .join('');
  }

  get summaryCards() {
    const activeAlerts = this.recentAlerts.filter((alert) => alert.estado !== 'Asignada').length;
    const availableAgents = this.agents.filter((agent) => agent.estado === 'Disponible').length;
    const assignedAlerts = this.recentAlerts.filter((alert) => alert.estado === 'Asignada').length;
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

  get filteredAlertsLabel() {
    return `${this.filteredAlerts.length} alertas monitoreadas`;
  }

  get filteredAlerts() {
    const search = this.alertSearch.trim().toLowerCase();

    return this.recentAlerts.filter((alert) => {
      const matchesPriority =
        this.alertPriorityFilter === 'Todas' || alert.prioridad === this.alertPriorityFilter;
      const matchesStatus =
        this.alertStatusFilter === 'Todas' || alert.estado === this.alertStatusFilter;
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

  selectAlert(alertId: string) {
    this.selectedAlertId = alertId;
  }

  focusAlertFromMap(alertId: string | null) {
    if (!alertId) {
      this.setActiveSection('overview');
      void this.router.navigate(['/dashboard']);
      return;
    }

    this.selectedAlertId = alertId;
    this.setActiveSection('alerts');
    void this.router.navigate(['/alertas']);
  }

  async assignSelectedAgent() {
    const alert = this.selectedAlert;
    const agent = this.selectedAgent;

    if (!alert || !agent) {
      this.showFeedback('Selecciona una alerta y un agente para continuar.', 'error');
      return;
    }

    const updatedAlert: DashboardAlert = {
      ...alert,
      agenteAsignado: agent.nombre,
      estado: 'Asignada',
    };
    const updatedAgent: DashboardAgent = {
      ...agent,
      estado: 'En servicio',
    };

    try {
      await Promise.all([
        this.dashboardDataService.saveAlert(updatedAlert),
        this.dashboardDataService.saveAgent(updatedAgent),
      ]);
      this.showFeedback(
        `${agent.nombre} fue asignado a la alerta ${alert.id} correctamente.`,
        'success'
      );
    } catch (error) {
      this.showFeedback(this.authService.traducirErrorFirebase(error), 'error');
    }
  }

  async toggleAgentStatus(agentCode: string) {
    const agent = this.agents.find((item) => item.codigo === agentCode);

    if (!agent) {
      return;
    }

    const updatedAgent: DashboardAgent = {
      ...agent,
      estado: agent.estado === 'Disponible' ? 'En servicio' : 'Disponible',
    };

    try {
      await this.dashboardDataService.saveAgent(updatedAgent);
      this.showFeedback(
        `${agent.nombre} ahora figura como ${updatedAgent.estado.toLowerCase()}.`,
        'success'
      );
    } catch (error) {
      this.showFeedback(this.authService.traducirErrorFirebase(error), 'error');
    }
  }

  async createAgent(payload: {
    nombre: string;
    usuario: string;
    password: string;
    zona: string;
    telefono: string;
    codigo: string;
  }) {
    this.isSubmitting = true;
    this.showFeedback('', 'success');

    try {
      const result = await this.operationsService.createAgent(payload);
      this.agents.push(result.agent);
      this.showFeedback('Agente creado correctamente.', 'success');
    } catch (error) {
      this.showFeedback(this.authService.traducirErrorFirebase(error), 'error');
    } finally {
      this.isSubmitting = false;
    }
  }

  async markNotificationAsRead(notificationId: string) {
    const notification = this.notifications.find((item) => item.id === notificationId);

    if (!notification) {
      return;
    }

    try {
      await this.dashboardDataService.saveNotification({
        ...notification,
        leida: true,
      });
    } catch (error) {
      this.showFeedback(this.authService.traducirErrorFirebase(error), 'error');
    }
  }

  async markAllNotificationsAsRead() {
    try {
      await this.dashboardDataService.saveAllNotifications(
        this.notifications.map((item) => ({
          ...item,
          leida: true,
        }))
      );
      this.showFeedback('Todas las notificaciones quedaron marcadas como leidas.', 'success');
    } catch (error) {
      this.showFeedback(this.authService.traducirErrorFirebase(error), 'error');
    }
  }

  onlyNumbers(field: 'telefono' | 'nit') {
    this.formData[field] = this.formData[field].replace(/[^0-9]/g, '');
  }

  async guardarCambios() {
    const { nombre, email, telefono, nit } = this.formData;

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
        direccion: this.companyData.direccion || '',
        plan: this.companyData.plan || '',
      });

      this.formData = {
        nombre: result.user.nombre,
        email: result.user.email,
        telefono: result.user.telefono,
        nit: result.user.nit,
      };

      this.companyData = {
        ...this.companyData,
        nombre: result.user.nombre,
        correo: result.user.email,
        telefono: result.user.telefono,
        nitEmpresa: result.user.nit,
      };

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

  private bindAuth() {
    this.unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        this.dashboardUnsubscribes.forEach((unsubscribe) => unsubscribe());
        this.dashboardUnsubscribes = [];
        this.isLoading = false;
        void this.router.navigate(['/login']);
        return;
      }

      this.currentUser = user;
      this.bindRealtimeDashboard(user.uid);
      const cachedProfile = this.authService.getCachedProfile();

      this.formData = {
        nombre: cachedProfile?.nombre || user.displayName || '',
        email: cachedProfile?.email || user.email || '',
        telefono: cachedProfile?.telefono || '',
        nit: cachedProfile?.nit || '',
      };
      this.isLoading = false;

      await this.cargarPerfil();
    });
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

  private bindRealtimeDashboard(companyUid: string) {
    this.dashboardUnsubscribes.forEach((unsubscribe) => unsubscribe());

    this.dashboardUnsubscribes = [
      this.dashboardDataService.watchAlerts(companyUid, (items) => {
        this.recentAlerts = items;
        if (!items.some((alert) => alert.id === this.selectedAlertId) && items[0]) {
          this.selectedAlertId = items[0].id;
        }
      }),
      this.dashboardDataService.watchAgents(companyUid, (items) => {
        this.agents = items;
        if (!items.some((agent) => agent.codigo === this.selectedAgentCode) && items[0]) {
          this.selectedAgentCode = items[0].codigo;
        }
      }),
      this.dashboardDataService.watchHistory(companyUid, (items) => {
        this.historyRows = items;
      }),
      this.dashboardDataService.watchNotifications(companyUid, (items) => {
        this.notifications = items;
      }),
      this.dashboardDataService.watchBilling(companyUid, (items) => {
        this.billingRows = items;
      }),
      this.dashboardDataService.watchCompany(companyUid, (item) => {
        this.companyData = item;
      }),
    ];
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
}
