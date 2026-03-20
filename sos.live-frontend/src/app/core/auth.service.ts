import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateEmail,
  User,
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

const EMAIL_VERIFICATION_TIMEOUT_MS = 5000;
const PROFILE_REQUEST_TIMEOUT_MS = 7000;
const PROFILE_CACHE_KEY = 'profileCache';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = 'http://localhost:3000/api/auth';

  constructor(private readonly http: HttpClient) {}

  private async sendVerificationEmailWithTimeout() {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      return false;
    }

    try {
      await Promise.race([
        sendEmailVerification(currentUser),
        new Promise((resolve) => setTimeout(resolve, EMAIL_VERIFICATION_TIMEOUT_MS)),
      ]);

      return true;
    } catch {
      return false;
    }
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

  async registrarUsuario({
    nombre,
    email,
    telefono,
    nit,
    password,
  }: RegisterPayload): Promise<RegisterFlowResult> {
    try {
      const credentials = await createUserWithEmailAndPassword(auth, email, password);

      const idToken = await credentials.user.getIdToken();

      await firstValueFrom(
        this.http.post<RegisterResponse>(`${this.apiUrl}/register`, {
          idToken,
          nombre,
          telefono,
          nit,
        })
      );

      const emailVerificationSent = await this.sendVerificationEmailWithTimeout();
      void signOut(auth).catch(() => {});

      return {
        emailVerificationSent,
      };
    } catch (error) {
      if (auth.currentUser) {
        void signOut(auth).catch(() => {});
      }

      throw error;
    }
  }

  async loginUsuario({ email, password }: LoginPayload) {
    const credentials = await signInWithEmailAndPassword(auth, email, password);

    await reload(credentials.user);

    if (!credentials.user.emailVerified) {
      const error = new Error('Debes verificar tu correo antes de iniciar sesion.');
      (error as Error & { code?: string }).code = 'auth/email-not-verified';
      await signOut(auth);
      throw error;
    }

    const idToken = await credentials.user.getIdToken();
    localStorage.setItem('authToken', idToken);

    const response = await firstValueFrom(
      this.http.post<AuthResponse>(`${this.apiUrl}/verify-session`, {
        idToken,
      })
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
  }: {
    nombre: string;
    email: string;
    telefono: string;
    nit: string;
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
        { nombre, telefono, nit },
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
    if (code === 'auth/invalid-credential') return 'Correo o contrasena incorrectos.';
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
