import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';
import { AuthService } from './auth.service';
import { DashboardBillingRow } from './dashboard-data.service';

export type PaymentMethodPreference = 'card' | 'pse' | 'checkout';

export interface CreatePaymentCheckoutResponse {
  message: string;
  reference: string;
  checkoutUrl: string;
  checkoutForm: {
    action: string;
    method: string;
    fields: Record<string, string>;
  } | null;
  payment: Record<string, unknown>;
}

export interface ConfirmPaymentResponse {
  message: string;
  reference?: string;
  payment: Record<string, unknown>;
  transaction: Record<string, unknown>;
}

export interface PaymentSetupStatusResponse {
  message: string;
  paymentProvider: string;
  realPaymentsEnabled: boolean;
  simulationEnabled: boolean;
  supportedMethods: PaymentMethodPreference[];
  redirectUrl: string;
  notificationUrl: string;
  webhookSignatureValidationEnabled: boolean;
  checkoutUrl?: string;
  environment?: string;
}

export interface PaymentAccessStatusResponse {
  message: string;
  hasActivePayment: boolean;
  payment: Record<string, unknown> | null;
}

interface BillingHistoryResponse {
  payments: DashboardBillingRow[];
}

@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private readonly apiUrl = `${API_BASE_URL}/payments`;
  private readonly requestTimeoutMs = 15000;
  private readonly accessStatusCacheMs = 15000;
  private readonly setupStatusCacheMs = 15000;
  private accessStatusCache?: {
    data: PaymentAccessStatusResponse;
    createdAt: number;
  };
  private setupStatusCache?: {
    data: PaymentSetupStatusResponse;
    createdAt: number;
  };

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

  async createCheckout(payload: {
    amount: number;
    concept: string;
    method: PaymentMethodPreference;
  }) {
    const headers = await this.getAuthHeaders();

    return this.withTimeout(
      firstValueFrom(
        this.http.post<CreatePaymentCheckoutResponse>(`${this.apiUrl}/checkout`, payload, {
          headers,
        })
      ),
      'La creacion del checkout tardo demasiado. Intenta de nuevo.'
    );
  }

  async getSetupStatus() {
    if (
      this.setupStatusCache &&
      Date.now() - this.setupStatusCache.createdAt < this.setupStatusCacheMs
    ) {
      return this.setupStatusCache.data;
    }

    const headers = await this.getAuthHeaders();
    const response = await this.withTimeout(
      firstValueFrom(
        this.http.get<PaymentSetupStatusResponse>(`${this.apiUrl}/setup-status`, {
          headers,
        })
      ),
      'La validacion de la pasarela de pago tardo demasiado. Intenta de nuevo.'
    );

    this.setupStatusCache = {
      data: response,
      createdAt: Date.now(),
    };

    return response;
  }

  async getAccessStatus() {
    if (
      this.accessStatusCache &&
      Date.now() - this.accessStatusCache.createdAt < this.accessStatusCacheMs
    ) {
      return this.accessStatusCache.data;
    }

    const headers = await this.getAuthHeaders();
    const response = await this.withTimeout(
      firstValueFrom(
        this.http.get<PaymentAccessStatusResponse>(`${this.apiUrl}/access-status`, {
          headers,
        })
      ),
      'La validacion del pago tardo demasiado. Intenta de nuevo.'
    );

    this.accessStatusCache = {
      data: response,
      createdAt: Date.now(),
    };

    return response;
  }

  async getBillingHistory() {
    const headers = await this.getAuthHeaders();

    return this.withTimeout(
      firstValueFrom(
        this.http.get<BillingHistoryResponse>(`${this.apiUrl}/billing`, {
          headers,
        })
      ),
      'La consulta de pagos tardo demasiado. Intenta de nuevo.'
    );
  }

  async simulatePayment(payload: {
    amount: number;
    concept: string;
    method: PaymentMethodPreference;
    simulationCard?: {
      cardholderName: string;
      cardLast4: string;
      cardBrand: string;
      cardExpiry: string;
      cardDocument: string;
    };
  }) {
    const headers = await this.getAuthHeaders();
    const response = await this.withTimeout(
      firstValueFrom(
        this.http.post<ConfirmPaymentResponse>(`${this.apiUrl}/simulate`, payload, {
          headers,
        })
      ),
      'La simulacion del pago tardo demasiado. Intenta de nuevo.'
    );

    this.invalidateAccessStatusCache();

    return response;
  }

  async confirmTransaction(transactionId: string, payload: Record<string, string> = {}) {
    const headers = await this.getAuthHeaders();
    const response = await this.withTimeout(
      firstValueFrom(
        this.http.post<ConfirmPaymentResponse>(
          `${this.apiUrl}/mercadopago/payments/${encodeURIComponent(transactionId)}/confirm`,
          payload,
          { headers }
        )
      ),
      'La confirmacion del pago tardo demasiado. Intenta actualizar la pagina.'
    );

    this.invalidateAccessStatusCache();

    return response;
  }

  invalidateAccessStatusCache() {
    this.accessStatusCache = undefined;
  }

  translatePaymentError(error: unknown) {
    if (error instanceof HttpErrorResponse) {
      return error.error?.message || 'No fue posible procesar el pago.';
    }

    if (typeof error === 'object' && error && 'message' in error) {
      return String(error.message);
    }

    return 'Ocurrio un error inesperado al procesar el pago.';
  }
}
