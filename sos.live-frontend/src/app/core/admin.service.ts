import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';
import { AuthService } from './auth.service';

export interface AdminCompany {
  uid: string;
  nombre: string;
  email: string;
  telefono: string;
  nit: string;
  estado: string;
  createdAt?: string | null;
}

export interface AdminPayment {
  id: string;
  fecha: string;
  metodo: string;
  monto: string;
  estado: string;
}

export interface AdminOverview {
  companiesCount: number;
  adminCount: number;
  alertsCount: number;
  totalRevenue: string;
  pendingPayments: string;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly apiUrl = `${API_BASE_URL}/admin`;

  constructor(
    private readonly http: HttpClient,
    private readonly authService: AuthService
  ) {}

  private async getAuthHeaders() {
    const currentUser = this.authService.getCurrentUser();

    if (!currentUser) {
      throw new Error('No hay una sesion activa.');
    }

    const idToken = await currentUser.getIdToken(true);

    return new HttpHeaders({
      Authorization: `Bearer ${idToken}`,
    });
  }

  async getOverview() {
    const headers = await this.getAuthHeaders();

    return firstValueFrom(
      this.http.get<{ overview: AdminOverview }>(`${this.apiUrl}/overview`, {
        headers,
      })
    );
  }

  async listCompanies() {
    const headers = await this.getAuthHeaders();

    return firstValueFrom(
      this.http.get<{ companies: AdminCompany[] }>(`${this.apiUrl}/companies`, {
        headers,
      })
    );
  }

  async listPayments() {
    const headers = await this.getAuthHeaders();

    return firstValueFrom(
      this.http.get<{ payments: AdminPayment[] }>(`${this.apiUrl}/payments`, {
        headers,
      })
    );
  }

  translateAdminError(error: unknown) {
    if (error instanceof HttpErrorResponse) {
      return error.error?.message || 'No fue posible conectar con el panel admin.';
    }

    if (typeof error === 'object' && error && 'message' in error) {
      return String(error.message);
    }

    return 'Ocurrio un error inesperado en el panel admin.';
  }
}
