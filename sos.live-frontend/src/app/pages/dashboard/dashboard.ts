import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { onAuthStateChanged, Unsubscribe, User } from 'firebase/auth';

import { AuthService } from '../../core/auth.service';
import { auth } from '../../core/firebase.config';

@Component({
  selector: 'app-dashboard',
  standalone: false,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit, OnDestroy {
  formData = {
    nombre: '',
    email: '',
    telefono: '',
    nit: '',
  };

  currentUser: User | null = null;
  isLoading = true;
  isSubmitting = false;
  isDeleting = false;
  isResendingVerification = false;
  feedbackMessage = '';
  feedbackType: 'success' | 'error' = 'success';

  private unsubscribeAuth?: Unsubscribe;

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router
  ) {}

  ngOnInit() {
    this.unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
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
      this.isLoading = false;

      await this.cargarPerfil();
    });
  }

  ngOnDestroy() {
    this.unsubscribeAuth?.();
  }

  get isEmailVerified() {
    return !!this.currentUser?.emailVerified;
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
      });

      this.formData = {
        nombre: result.user.nombre,
        email: result.user.email,
        telefono: result.user.telefono,
        nit: result.user.nit,
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
}
