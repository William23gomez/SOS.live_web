import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import {
  ActionCodeSettings,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateEmail,
  User,
  verifyPasswordResetCode,
} from 'firebase/auth';
import { firstValueFrom } from 'rxjs';

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

interface RegisterFlowResult {
  emailVerificationSent: boolean;
  emailVerificationError?: string;
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
    rol: 'admin' | 'empresa';
    createdAt: string;
  };
  idToken?: string;
  refreshToken?: string;
  expiresIn?: string;
}

export type RegisterResponse = AuthResponse;
export interface ProfileResponse {
  user: AuthResponse['user'];
}

const EMAIL_VERIFICATION_TIMEOUT_MS = 15000;
const REGISTER_REQUEST_TIMEOUT_MS = 12000;
const PROFILE_REQUEST_TIMEOUT_MS = 7000;
const LOGIN_AUTH_TIMEOUT_MS = 12000;
const VERIFY_SESSION_TIMEOUT_MS = 12000;
const PROFILE_CACHE_KEY = 'profileCache';
const AUTH_STATE_TIMEOUT_MS = 7000;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = 'http://localhost:3000/api/auth';

  constructor(private readonly http: HttpClient) {}

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
        url: `${window.location.origin}/login`,
        handleCodeInApp: false,
      }),
      'El envio del correo de verificacion tardo demasiado.',
      EMAIL_VERIFICATION_TIMEOUT_MS
    );

    return true;
  }

  private async getAuthHeaders() {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      const error = new Error('No hay una sesion activa.');
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

  async waitForCurrentUser(timeoutMs = AUTH_STATE_TIMEOUT_MS): Promise<User | null> {
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
    }: RegisterPayload): Promise<RegisterFlowResult> {
    try {
      const credentials = await this.withTimeout(
        createUserWithEmailAndPassword(auth, email, password),
        'Firebase tardo demasiado en crear la cuenta. Intenta de nuevo.',
        LOGIN_AUTH_TIMEOUT_MS
      );

      const idToken = await this.withTimeout(
        credentials.user.getIdToken(),
        'Firebase tardo demasiado en generar el token de registro.',
        LOGIN_AUTH_TIMEOUT_MS
      );

      await this.withTimeout(
        firstValueFrom(
          this.http.post<RegisterResponse>(`${this.apiUrl}/register`, {
            idToken,
            nombre,
            telefono,
            nit,
          })
        ),
        'El registro en el servidor tardo demasiado. Intenta de nuevo.',
        REGISTER_REQUEST_TIMEOUT_MS
      );

      return {
        emailVerificationSent: false,
        emailVerificationError: '',
      };
    } catch (error) {
      if (auth.currentUser) {
        void signOut(auth).catch(() => {});
      }

      throw error;
    }
  }

  async finalizarRegistroConVerificacion(): Promise<RegisterFlowResult> {
    let emailVerificationSent = false;
    let emailVerificationError = '';

    try {
      emailVerificationSent = await this.sendVerificationEmailWithTimeout();
    } catch (error) {
      emailVerificationError = this.traducirErrorFirebase(error);
    } finally {
      void signOut(auth).catch(() => {});
    }

    return {
      emailVerificationSent,
      emailVerificationError,
    };
  }

  async loginUsuario({ email, password }: LoginPayload) {
    const credentials = await this.withTimeout(
      signInWithEmailAndPassword(auth, email, password),
      'El inicio de sesion tardo demasiado. Verifica tu conexion e intenta de nuevo.',
      LOGIN_AUTH_TIMEOUT_MS
    );

    await reload(credentials.user);

    if (!credentials.user.emailVerified) {
      const error = new Error('Debes verificar tu correo antes de iniciar sesion.');
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
      'El servidor tardo demasiado en validar la sesion. Intenta de nuevo.',
      VERIFY_SESSION_TIMEOUT_MS
    );

    this.saveProfileCache(response.user);

    return response;
  }

  async obtenerPerfil() {
    const headers = await this.getAuthHeaders();

    const response = await Promise.race([
      firstValueFrom(this.http.get<ProfileResponse>(`${this.apiUrl}/profile`, { headers })),
      new Promise<ProfileResponse>((_, reject) => {
        setTimeout(() => {
          reject(new Error('La carga del perfil tardo demasiado.'));
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
      const error = new Error('No hay una sesion activa.');
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
      const error = new Error('No hay una sesion activa.');
      (error as Error & { code?: string }).code = 'auth/no-current-user';
      throw error;
    }

    return this.sendVerificationEmailWithTimeout();
  }

  async restablecerContrasena(email: string, actionCodeSettings?: ActionCodeSettings) {
    if (!email) {
      const error = new Error('Escribe tu correo para restablecer la contrasena.');
      (error as Error & { code?: string }).code = 'auth/missing-email';
      throw error;
    }

    await this.withTimeout(
      sendPasswordResetEmail(auth, email, actionCodeSettings),
      'El envio del correo de recuperacion tardo demasiado. Intenta de nuevo.',
      LOGIN_AUTH_TIMEOUT_MS
    );
  }

  async confirmarRestablecimientoContrasena(code: string, newPassword: string) {
    if (!code) {
      const error = new Error(
        'El enlace de restablecimiento no es valido. Solicita uno nuevo desde el correo.'
      );
      (error as Error & { code?: string }).code = 'auth/missing-reset-code';
      throw error;
    }

    await this.withTimeout(
      confirmPasswordReset(auth, code, newPassword),
      'El cambio de contrasena tardo demasiado. Intenta de nuevo.',
      LOGIN_AUTH_TIMEOUT_MS
    );
  }

  async validarCodigoRestablecimiento(code: string) {
    if (!code) {
      const error = new Error(
        'El enlace de restablecimiento no es valido. Solicita uno nuevo desde el correo.'
      );
      (error as Error & { code?: string }).code = 'auth/missing-reset-code';
      throw error;
    }

    return this.withTimeout(
      verifyPasswordResetCode(auth, code),
      'La validacion del enlace tardo demasiado. Intenta abrirlo otra vez.',
      LOGIN_AUTH_TIMEOUT_MS
    );
  }

  async cerrarSesion() {
    localStorage.removeItem('authToken');
    localStorage.removeItem(PROFILE_CACHE_KEY);
    await signOut(auth);
  }

  async eliminarCuenta() {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      const error = new Error('No hay una sesion activa.');
      (error as Error & { code?: string }).code = 'auth/no-current-user';
      throw error;
    }

    const headers = await this.getAuthHeaders();
    await firstValueFrom(this.http.delete<{ message: string }>(`${this.apiUrl}/profile`, { headers }));

    localStorage.removeItem('authToken');
    localStorage.removeItem(PROFILE_CACHE_KEY);
    await deleteUser(currentUser).catch(async () => {
      await signOut(auth);
    });
  }

  traducirErrorFirebase(error: unknown) {
    if (error instanceof HttpErrorResponse) {
      return error.error?.message || 'No fue posible conectar con el servidor.';
    }

    const code =
      typeof error === 'object' && error && 'code' in error
        ? String(error.code)
        : '';

    if (code === 'auth/email-already-in-use') return 'Este correo ya esta registrado.';
    if (code === 'auth/invalid-email') return 'El correo no es valido.';
    if (code === 'auth/weak-password') return 'La contrasena debe tener al menos 6 caracteres.';
    if (code === 'auth/too-many-requests') {
      return 'Firebase bloqueo temporalmente la accion. Intenta de nuevo en unos minutos.';
    }
    if (code === 'auth/email-not-verified') {
      return 'Debes verificar tu correo antes de iniciar sesion.';
    }
    if (code === 'auth/no-current-user') {
      return 'No hay una sesion activa. Vuelve a iniciar sesion.';
    }
    if (code === 'auth/missing-email') {
      return 'Escribe tu correo para restablecer la contrasena.';
    }
    if (code === 'auth/missing-reset-code') {
      return 'El enlace de restablecimiento no es valido. Solicita uno nuevo desde el correo.';
    }
    if (code === 'auth/unauthorized-continue-uri' || code === 'auth/invalid-continue-uri') {
      return 'Firebase bloqueo el enlace del correo. Agrega localhost y 127.0.0.1 en Authentication > Settings > Authorized domains.';
    }
    if (code === 'auth/operation-not-allowed') {
      return 'Firebase no tiene habilitado el acceso con correo y contrasena.';
    }
    if (code === 'auth/network-request-failed') {
      return 'Firebase no pudo conectarse para enviar el correo. Revisa la conexion e intenta de nuevo.';
    }
    if (code === 'auth/invalid-credential') return 'Correo o contrasena incorrectos.';
    if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
      return 'El enlace para restablecer la contrasena ya no es valido o vencio.';
    }
    if (code === 'auth/user-not-found') {
      return 'No encontramos una cuenta con ese correo.';
    }
    if (code === 'auth/requires-recent-login') {
      return 'Por seguridad, vuelve a iniciar sesion y repite la accion.';
    }
    if (code === 'permission-denied' || code === 'firestore/permission-denied') {
      return 'Firestore bloqueo la escritura. Revisa las reglas.';
    }

    if (typeof error === 'object' && error && 'message' in error) {
      return String(error.message);
    }

    return 'Ocurrio un error inesperado.';
  }
}
