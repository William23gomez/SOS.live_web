import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';
import { AuthService } from './auth.service';
import { DashboardAgent, DashboardAlert, DashboardNotification } from './dashboard-data.service';

interface CreateAlertResponse {
  message: string;
  alert: DashboardAlert;
  notification: DashboardNotification;
}

interface AssignAgentResponse {
  message: string;
  alert: DashboardAlert;
  agent: DashboardAgent;
}

interface AlertMutationResponse {
  message: string;
  alert: DashboardAlert;
}

interface AlertsResponse {
  alerts: DashboardAlert[];
}

interface AgentsResponse {
  agents: DashboardAgent[];
}

interface NotificationsResponse {
  notifications: DashboardNotification[];
}

interface AgentMutationResponse {
  message: string;
  agent: DashboardAgent;
}

@Injectable({ providedIn: 'root' })
export class OperationsService {
  private readonly apiUrl = `${API_BASE_URL}/operations`;
  private readonly requestTimeoutMs = 15000;

  constructor(
    private readonly http: HttpClient,
    private readonly authService: AuthService
  ) {}

  private async withTimeout<T>(promise: Promise<T>, message: string) {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(message)), this.requestTimeoutMs);
      }),
    ]);
  }

  private async getAuthHeaders() {
    const currentUser = await this.authService.waitForCurrentUser();

    if (!currentUser) {
      throw new Error('No hay una sesion activa.');
    }

    const idToken = await currentUser.getIdToken();

    return new HttpHeaders({
      Authorization: `Bearer ${idToken}`,
    });
  }

  async createAlert(payload: {
    tipo: string;
    ubicacion: string;
    prioridad: string;
    descripcion: string;
  }) {
    const headers = await this.getAuthHeaders();

    return this.withTimeout(
      firstValueFrom(
        this.http.post<CreateAlertResponse>(`${this.apiUrl}/alerts`, payload, { headers })
      ),
      'La creacion de la alerta tardo demasiado. Verifica la conexion e intenta de nuevo.'
    );
  }

  async createAgent(payload: {
    nombre: string;
    usuario: string;
    password: string;
    zona: string;
    ubicacionExacta?: string;
    telefono: string;
    codigo: string;
  }) {
    const headers = await this.getAuthHeaders();

    return this.withTimeout(
      firstValueFrom(
        this.http.post<AgentMutationResponse>(`${this.apiUrl}/agents`, payload, { headers })
      ),
      'La creacion del agente tardo demasiado. Verifica la conexion e intenta de nuevo.'
    );
  }

  async assignAgent(
    alertId: string,
    agentCode: string,
    payload?: {
      alert?: Record<string, unknown>;
      agent?: Record<string, unknown>;
    }
  ) {
    const headers = await this.getAuthHeaders();

    return firstValueFrom(
      this.http.put<AssignAgentResponse>(
        `${this.apiUrl}/alerts/${alertId}/assign`,
        {
          agentCode,
          ...payload,
        },
        { headers }
      )
    );
  }

  async finalizeAlert(
    alertId: string,
    payload?: {
      alert?: Record<string, unknown>;
    }
  ) {
    const headers = await this.getAuthHeaders();

    return firstValueFrom(
      this.http.patch<AlertMutationResponse>(
        `${this.apiUrl}/alerts/${alertId}/finalize`,
        payload || {},
        { headers }
      )
    );
  }

  async cancelAlert(
    alertId: string,
    payload?: {
      alert?: Record<string, unknown>;
    }
  ) {
    const headers = await this.getAuthHeaders();

    return firstValueFrom(
      this.http.patch<AlertMutationResponse>(
        `${this.apiUrl}/alerts/${alertId}/cancel`,
        payload || {},
        { headers }
      )
    );
  }

  async toggleAgentStatus(codigo: string) {
    const headers = await this.getAuthHeaders();

    return firstValueFrom(
      this.http.patch<AgentMutationResponse>(`${this.apiUrl}/agents/${codigo}/status`, {}, { headers })
    );
  }

  async deleteAgent(codigo: string) {
    const headers = await this.getAuthHeaders();

    return firstValueFrom(
      this.http.delete<{ message: string }>(`${this.apiUrl}/agents/${codigo}`, { headers })
    );
  }

  async markNotificationAsRead(notificationId: string) {
    const headers = await this.getAuthHeaders();

    return firstValueFrom(
      this.http.patch<{ message: string }>(
        `${this.apiUrl}/notifications/${notificationId}/read`,
        {},
        { headers }
      )
    );
  }

  async markAllNotificationsAsRead() {
    const headers = await this.getAuthHeaders();

    return firstValueFrom(
      this.http.patch<{ message: string }>(`${this.apiUrl}/notifications/read-all`, {}, { headers })
    );
  }

  async getAlerts() {
    const headers = await this.getAuthHeaders();

    return this.withTimeout(
      firstValueFrom(this.http.get<AlertsResponse>(`${this.apiUrl}/alerts`, { headers })),
      'La consulta de alertas tardo demasiado. Intenta de nuevo.'
    );
  }

  async getAgents() {
    const headers = await this.getAuthHeaders();

    return this.withTimeout(
      firstValueFrom(this.http.get<AgentsResponse>(`${this.apiUrl}/agents`, { headers })),
      'La consulta de agentes tardo demasiado. Intenta de nuevo.'
    );
  }

  async getNotifications() {
    const headers = await this.getAuthHeaders();

    return this.withTimeout(
      firstValueFrom(
        this.http.get<NotificationsResponse>(`${this.apiUrl}/notifications`, { headers })
      ),
      'La consulta de notificaciones tardo demasiado. Intenta de nuevo.'
    );
  }

  translateError(error: unknown) {
    if (error instanceof HttpErrorResponse) {
      return error.error?.message || 'No fue posible completar la operacion.';
    }

    if (typeof error === 'object' && error && 'message' in error) {
      return String(error.message);
    }

    return 'Ocurrio un error inesperado.';
  }
}
