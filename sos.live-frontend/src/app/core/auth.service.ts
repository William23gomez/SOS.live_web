import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import {
  ActionCodeSettings,
  browserLocalPersistence,
  browserSessionPersistence,
  confirmPasswordReset,
  deleteUser,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateEmail,
  User,
  verifyPasswordResetCode,
} from 'firebase/auth';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL, PUBLIC_APP_URL } from './api.config';
import { auth } from './firebase.config';

export interface RegisterPayload {
  nombre: string;
  email: string;
  telefono: string;
  nit: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

interface AdminResolutionResponse {
  message: string;
  admin: {
    email: string;
    nombre: string;
  };
}

export interface AdminAccessProfile {
  email: string;
  nombre: string;
}

interface RegisterFlowResult {
  emailVerificationSent: boolean;
  emailVerificationError?: string;
}

interface RegisterAvailabilityResponse {
  available: boolean;
}

interface AuthResponse {
  message: string;
  user: {
    id: string;
    uid: string;
    nombre: string;
    email: string;
    telefono: string;
    nit: string;
    direccion?: string;
    plan?: string;
    estado?: string;
    rol: 'admin' | 'empresa';
    createdAt: string;
  };
  idToken?: string;
  refreshToken?: string;
  expiresIn?: string;
}

export type RegisterResponse = AuthResponse & RegisterFlowResult;
export interface ProfileResponse {
  user: AuthResponse['user'];
}

export interface EmailVerificationStatusResponse {
  email: string;
  emailVerified: boolean;
}

const EMAIL_VERIFICATION_TIMEOUT_MS = 15000;
const REGISTER_REQUEST_TIMEOUT_MS = 30000;
const PROFILE_REQUEST_TIMEOUT_MS = 7000;
const LOGIN_AUTH_TIMEOUT_MS = 12000;
const VERIFY_SESSION_TIMEOUT_MS = 12000;
const EMAIL_VERIFICATION_STATUS_TIMEOUT_MS = 7000;
const ADMIN_RESOLVE_TIMEOUT_MS = 7000;
const PROFILE_CACHE_KEY = 'profileCache';
const EMAIL_VERIFICATION_COMPLETED_KEY = 'emailVerificationCompletedNotice';
const PENDING_EMAIL_VERIFICATION_KEY = 'pendingEmailVerificationEmail';
const AUTH_STATE_TIMEOUT_MS = 7000;
const API_ORIGIN = API_BASE_URL.replace(/\/api$/, '');

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = `${API_BASE_URL}/auth`;
  private readonly persistenceReady: Promise<void>;

  constructor(private readonly http: HttpClient) {
    this.persistenceReady = setPersistence(auth, browserLocalPersistence)
      .catch(() => setPersistence(auth, browserSessionPersistence))
      .then(() => undefined)
      .catch(() => undefined);
  }

  private buildVerificationPageUrl(email = '') {
    const url = new URL(`${PUBLIC_APP_URL}/email-verified`);
    url.searchParams.set('app', 'empresa');

    if (email.trim()) {
      url.searchParams.set('email', email.trim().toLowerCase());
    }

    return url.toString();
  }

  private async withTimeout<T>(promise: Promise<T>, message: string, timeoutMs: number) {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  }

  private async sendVerificationEmailWithTimeout() {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      return false;
    }

    await this.withTimeout(
      sendEmailVerification(currentUser, {
        url: this.buildVerificationPageUrl(currentUser.email || ''),
        handleCodeInApp: false,
      }),
      'El env\u00edo del correo de verificaci\u00f3n tard\u00f3 demasiado.',
      EMAIL_VERIFICATION_TIMEOUT_MS
    );

    if (currentUser.email) {
      this.rememberPendingEmailVerification(currentUser.email);
    }

    return true;
  }

  private async getAuthHeaders() {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      const error = new Error('No hay una sesi\u00f3n activa.');
      (error as Error & { code?: string }).code = 'auth/no-current-user';
      throw error;
    }

    const idToken = await currentUser.getIdToken();
    localStorage.setItem('authToken', idToken);

    return new HttpHeaders({
      Authorization: `Bearer ${idToken}`,
    });
  }

  private saveProfileCache(user: AuthResponse['user']) {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(user));
  }

  markEmailVerificationCompleted(email = '') {
    this.clearPendingEmailVerificationEmail();
    localStorage.setItem(
      EMAIL_VERIFICATION_COMPLETED_KEY,
      JSON.stringify({
        email,
        at: Date.now(),
      })
    );
  }

  consumeEmailVerificationCompletedNotice(): { email: string } | null {
    const rawNotice = localStorage.getItem(EMAIL_VERIFICATION_COMPLETED_KEY);

    if (!rawNotice) {
      return null;
    }

    localStorage.removeItem(EMAIL_VERIFICATION_COMPLETED_KEY);

    try {
      const parsedNotice = JSON.parse(rawNotice) as { email?: string };
      return {
        email: String(parsedNotice.email || '').trim(),
      };
    } catch {
      return null;
    }
  }

  rememberPendingEmailVerification(email: string) {
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail) {
      this.clearPendingEmailVerificationEmail();
      return;
    }

    localStorage.setItem(PENDING_EMAIL_VERIFICATION_KEY, normalizedEmail);
  }

  getPendingEmailVerificationEmail() {
    return String(localStorage.getItem(PENDING_EMAIL_VERIFICATION_KEY) || '').trim().toLowerCase();
  }

  clearPendingEmailVerificationEmail() {
    localStorage.removeItem(PENDING_EMAIL_VERIFICATION_KEY);
  }

  async waitForCurrentUser(timeoutMs = AUTH_STATE_TIMEOUT_MS): Promise<User | null> {
    await this.persistenceReady;

    if (auth.currentUser) {
      return auth.currentUser;
    }

    return new Promise<User | null>((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(auth.currentUser);
      }, timeoutMs);

      const unsubscribe = onAuthStateChanged(auth, (user) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(user);
      });
    });
  }

  getCachedProfile(): AuthResponse['user'] | null {
    const rawProfile = localStorage.getItem(PROFILE_CACHE_KEY);

    if (!rawProfile) {
      return null;
    }

    try {
      return JSON.parse(rawProfile) as AuthResponse['user'];
    } catch {
      localStorage.removeItem(PROFILE_CACHE_KEY);
      return null;
    }
  }

  getCurrentUser(): User | null {
    return auth.currentUser;
  }

  getRedirectRouteForRole(role?: string) {
    return role === 'admin' ? '/admin' : '/dashboard';
  }

  async registrarUsuario({
    nombre,
    email,
    telefono,
    nit,
    password,
  }: RegisterPayload): Promise<RegisterResponse> {
    return this.withTimeout(
      firstValueFrom(
        this.http.post<RegisterResponse>(`${this.apiUrl}/register`, {
          nombre,
          email,
          telefono,
          nit,
          password,
        })
      ),
      'El registro en el servidor tard\u00f3 demasiado. Intenta de nuevo.',
      REGISTER_REQUEST_TIMEOUT_MS
    );
  }

  async verificarDisponibilidadRegistro({
    nombre,
    email,
    telefono,
    nit,
  }: Omit<RegisterPayload, 'password'>) {
    return this.withTimeout(
      firstValueFrom(
        this.http.post<RegisterAvailabilityResponse>(`${this.apiUrl}/register-availability`, {
          nombre,
          email,
          telefono,
          nit,
        })
      ),
      'La validacion del registro tardo demasiado. Intenta de nuevo.',
      ADMIN_RESOLVE_TIMEOUT_MS
    );
  }

  async loginUsuario({ email, password }: LoginPayload) {
    await this.persistenceReady;

    const credentials = await this.withTimeout(
      signInWithEmailAndPassword(auth, email, password),
      'El inicio de sesi\u00f3n tard\u00f3 demasiado. Verifica tu conexi\u00f3n e intenta de nuevo.',
      LOGIN_AUTH_TIMEOUT_MS
    );

    await reload(credentials.user);

    if (!credentials.user.emailVerified) {
      const error = new Error('Debes verificar tu correo antes de iniciar sesi\u00f3n.');
      (error as Error & { code?: string }).code = 'auth/email-not-verified';
      await signOut(auth);
      throw error;
    }

    const idToken = await credentials.user.getIdToken();
    localStorage.setItem('authToken', idToken);

    const response = await this.withTimeout(
      firstValueFrom(
        this.http.post<AuthResponse>(`${this.apiUrl}/verify-session`, {
          idToken,
        })
      ),
      'El servidor tard\u00f3 demasiado en validar la sesi\u00f3n. Intenta de nuevo.',
      VERIFY_SESSION_TIMEOUT_MS
    );

    this.clearPendingEmailVerificationEmail();
    this.saveProfileCache(response.user);

    return response;
  }

  async resolveAdminAccess(identifier: string) {
    const normalizedIdentifier = identifier.trim();

    if (!normalizedIdentifier) {
      const error = new Error('Escribe el usuario o correo del administrador.');
      (error as Error & { code?: string }).code = 'auth/missing-admin-identifier';
      throw error;
    }

    return this.withTimeout(
      firstValueFrom(
        this.http.post<AdminResolutionResponse>(`${this.apiUrl}/admin/resolve`, {
          identifier: normalizedIdentifier,
        })
      ),
      'La validaci\u00f3n del acceso admin tard\u00f3 demasiado. Intenta de nuevo.',
      ADMIN_RESOLVE_TIMEOUT_MS
    );
  }

  async resolveAdminAccessIfExists(identifier: string): Promise<AdminAccessProfile | null> {
    try {
      const response = await this.resolveAdminAccess(identifier);
      return response.admin;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 403) {
        return null;
      }

      throw error;
    }
  }

  async obtenerPerfil() {
    const headers = await this.getAuthHeaders();

    const response = await Promise.race([
      firstValueFrom(this.http.get<ProfileResponse>(`${this.apiUrl}/profile`, { headers })),
      new Promise<ProfileResponse>((_, reject) => {
        setTimeout(() => {
          reject(new Error('La carga del perfil tard\u00f3 demasiado.'));
        }, PROFILE_REQUEST_TIMEOUT_MS);
      }),
    ]);

    this.saveProfileCache(response.user);

    return response;
  }

  async actualizarPerfil({
    nombre,
    email,
    telefono,
    nit,
    direccion,
    plan,
  }: {
    nombre: string;
    email: string;
    telefono: string;
    nit: string;
    direccion: string;
    plan: string;
  }) {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      const error = new Error('No hay una sesi\u00f3n activa.');
      (error as Error & { code?: string }).code = 'auth/no-current-user';
      throw error;
    }

    let emailVerificationSent = false;

    if (email !== currentUser.email) {
      await updateEmail(currentUser, email);
      emailVerificationSent = await this.sendVerificationEmailWithTimeout();
    }

    const headers = await this.getAuthHeaders();
    const response = await firstValueFrom(
      this.http.put<{ message: string; user: AuthResponse['user'] }>(
        `${this.apiUrl}/profile`,
        { nombre, telefono, nit, direccion, plan },
        { headers }
      )
    );

    this.saveProfileCache(response.user);

    return {
      ...response,
      emailVerificationSent,
    };
  }

  async reenviarVerificacionCorreo() {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      const error = new Error('No hay una sesi\u00f3n activa.');
      (error as Error & { code?: string }).code = 'auth/no-current-user';
      throw error;
    }

    return this.sendVerificationEmailWithTimeout();
  }

  async consultarEstadoVerificacionCorreo(email: string) {
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail) {
      const error = new Error('El correo es obligatorio para consultar la verificación.');
      (error as Error & { code?: string }).code = 'auth/missing-email';
      throw error;
    }

    return this.withTimeout(
      firstValueFrom(
        this.http.post<EmailVerificationStatusResponse>(`${this.apiUrl}/verification-status`, {
          email: normalizedEmail,
        })
      ),
      'La consulta del estado de verificaci\u00f3n tard\u00f3 demasiado. Intenta de nuevo.',
      EMAIL_VERIFICATION_STATUS_TIMEOUT_MS
    );
  }

  async restablecerContrasena(email: string, actionCodeSettings?: ActionCodeSettings) {
    if (!email) {
      const error = new Error('Escribe tu correo para restablecer la contrase\u00f1a.');
      (error as Error & { code?: string }).code = 'auth/missing-email';
      throw error;
    }

    await this.withTimeout(
      sendPasswordResetEmail(auth, email, actionCodeSettings),
      'El env\u00edo del correo de recuperaci\u00f3n tard\u00f3 demasiado. Intenta de nuevo.',
      LOGIN_AUTH_TIMEOUT_MS
    );
  }

  async confirmarRestablecimientoContrasena(code: string, newPassword: string) {
    if (!code) {
      const error = new Error(
        'El enlace de restablecimiento no es v\u00e1lido. Solicita uno nuevo desde el correo.'
      );
      (error as Error & { code?: string }).code = 'auth/missing-reset-code';
      throw error;
    }

    await this.withTimeout(
      confirmPasswordReset(auth, code, newPassword),
      'El cambio de contrase\u00f1a tard\u00f3 demasiado. Intenta de nuevo.',
      LOGIN_AUTH_TIMEOUT_MS
    );
  }

  async validarCodigoRestablecimiento(code: string) {
    if (!code) {
      const error = new Error(
        'El enlace de restablecimiento no es v\u00e1lido. Solicita uno nuevo desde el correo.'
      );
      (error as Error & { code?: string }).code = 'auth/missing-reset-code';
      throw error;
    }

    return this.withTimeout(
      verifyPasswordResetCode(auth, code),
      'La validaci\u00f3n del enlace tard\u00f3 demasiado. Intenta abrirlo otra vez.',
      LOGIN_AUTH_TIMEOUT_MS
    );
  }

  async confirmarVerificacionCorreo(code: string, email = '') {
    if (!code) {
      const error = new Error(
        'El enlace de verificaci\u00f3n no es v\u00e1lido. Solicita uno nuevo desde el inicio de sesi\u00f3n.'
      );
      (error as Error & { code?: string }).code = 'auth/invalid-action-code';
      throw error;
    }

    const response = await this.withTimeout(
      firstValueFrom(
        this.http.post<EmailVerificationStatusResponse>(`${this.apiUrl}/verify-email-code`, {
          code,
          email: String(email || '').trim().toLowerCase() || undefined,
        })
      ),
      'La verificaci\u00f3n del correo tard\u00f3 demasiado. Intenta de nuevo.',
      VERIFY_SESSION_TIMEOUT_MS
    );

    if (auth.currentUser) {
      await reload(auth.currentUser).catch(() => {});
    }

    return response;
  }

  async cerrarSesion() {
    localStorage.removeItem('authToken');
    localStorage.removeItem(PROFILE_CACHE_KEY);
    await signOut(auth);
  }

  async eliminarCuenta() {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      const error = new Error('No hay una sesi\u00f3n activa.');
      (error as Error & { code?: string }).code = 'auth/no-current-user';
      throw error;
    }

    const headers = await this.getAuthHeaders();
    await firstValueFrom(
      this.http.delete<{ message: string }>(`${this.apiUrl}/profile`, { headers })
    );

    localStorage.removeItem('authToken');
    localStorage.removeItem(PROFILE_CACHE_KEY);
    await deleteUser(currentUser).catch(async () => {
      await signOut(auth);
    });
  }

  traducirErrorFirebase(error: unknown) {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return `No fue posible conectar con el servidor. Verifica que el backend este corriendo en ${API_ORIGIN}.`;
      }

      return error.error?.message || 'No fue posible conectar con el servidor.';
    }

    const code =
      typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

    if (code === 'auth/email-already-in-use') return 'Este correo ya est\u00e1 registrado.';
    if (code === 'auth/invalid-email') return 'El correo no es v\u00e1lido.';
    if (code === 'auth/weak-password') return 'La contrase\u00f1a debe tener al menos 6 caracteres.';
    if (code === 'auth/too-many-requests') {
      return 'Firebase bloque\u00f3 temporalmente la acci\u00f3n. Intenta de nuevo en unos minutos.';
    }
    if (code === 'auth/email-not-verified') {
      return 'Debes verificar tu correo antes de iniciar sesi\u00f3n.';
    }
    if (code === 'auth/no-current-user') {
      return 'No hay una sesi\u00f3n activa. Vuelve a iniciar sesi\u00f3n.';
    }
    if (code === 'auth/missing-email') {
      return 'Escribe tu correo para restablecer la contrase\u00f1a.';
    }
    if (code === 'auth/missing-reset-code') {
      return 'El enlace de restablecimiento no es v\u00e1lido. Solicita uno nuevo desde el correo.';
    }
    if (code === 'auth/missing-admin-identifier') {
      return 'Escribe el usuario o correo del administrador.';
    }
    if (code === 'auth/unauthorized-continue-uri' || code === 'auth/invalid-continue-uri') {
      return 'Firebase bloque\u00f3 el enlace del correo. Agrega soslive-f7513.web.app, soslive-f7513.firebaseapp.com, localhost y 127.0.0.1 en Authentication > Settings > Authorized domains.';
    }
    if (code === 'auth/operation-not-allowed') {
      return 'Firebase no tiene habilitado el acceso con correo y contrase\u00f1a.';
    }
    if (code === 'auth/network-request-failed') {
      return 'Firebase no pudo conectarse para enviar el correo. Revisa la conexi\u00f3n e intenta de nuevo.';
    }
    if (code === 'auth/invalid-credential') return 'Correo o contrase\u00f1a incorrectos.';
    if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
      return 'El enlace ya no es v\u00e1lido o venci\u00f3. Solicita uno nuevo.';
    }
    if (code === 'auth/user-not-found') {
      return 'No encontramos una cuenta con ese correo.';
    }
    if (code === 'auth/requires-recent-login') {
      return 'Por seguridad, vuelve a iniciar sesi\u00f3n y repite la acci\u00f3n.';
    }
    if (code === 'permission-denied' || code === 'firestore/permission-denied') {
      return 'Firestore bloque\u00f3 la escritura. Revisa las reglas.';
    }

    if (typeof error === 'object' && error && 'message' in error) {
      return String(error.message);
    }

    return 'Ocurri\u00f3 un error inesperado.';
  }
}
