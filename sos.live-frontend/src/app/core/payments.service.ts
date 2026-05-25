import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';
import { AuthService } from './auth.service';

export type PaymentMethodPreference = 'card' | 'pse' | 'checkout';

export interface CreatePaymentCheckoutResponse {
  message: string;
  reference: string;
  checkoutUrl: string;
  payment: Record<string, unknown>;
}

export interface ConfirmPaymentResponse {
  message: string;
  payment: Record<string, unknown>;
  transaction: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private readonly apiUrl = `${API_BASE_URL}/payments`;
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

  async confirmTransaction(transactionId: string) {
    const headers = await this.getAuthHeaders();

    return this.withTimeout(
      firstValueFrom(
        this.http.post<ConfirmPaymentResponse>(
          `${this.apiUrl}/mercadopago/payments/${encodeURIComponent(transactionId)}/confirm`,
          {},
          { headers }
        )
      ),
      'La confirmacion del pago tardo demasiado. Intenta actualizar la pagina.'
    );
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
