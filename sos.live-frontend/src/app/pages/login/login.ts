import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: false,
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  formData = {
    email: '',
    password: '',
  };

  isSubmitting = false;
  isSendingResetEmail = false;
  feedbackMessage = '';
  feedbackType: 'success' | 'error' = 'success';

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router
  ) {}

  async onSubmit() {
    if (this.isSubmitting) {
      return;
    }

    const { email, password } = this.formData;

    if (!email || !password) {
      this.showFeedback('Completa correo y contrasena para iniciar sesion.', 'error');
      window.alert('Completa correo y contrasena para iniciar sesion.');
      return;
    }

    this.isSubmitting = true;
    this.showFeedback('', 'success');

    try {
      const response = await this.authService.loginUsuario({ email, password });
      this.showFeedback('Inicio de sesion exitoso. Redirigiendo...', 'success');
      window.alert('Inicio de sesion exitoso.');

      await this.router.navigate([this.authService.getRedirectRouteForRole(response.user.rol)]);
    } catch (error) {
      const message = this.authService.traducirErrorFirebase(error);
      this.showFeedback(message, 'error');
      window.alert(message);
    } finally {
      this.isSubmitting = false;
    }
  }

  async onResetPassword(event?: Event) {
    event?.preventDefault();

    if (this.isSendingResetEmail) {
      return;
    }

    const email = this.formData.email.trim();

    if (!email) {
      this.showFeedback('Escribe tu correo y luego pulsa "Restablecela aqui".', 'error');
      return;
    }

    this.isSendingResetEmail = true;
    this.showFeedback('', 'success');

    try {
      await this.authService.restablecerContrasena(email, {
        url: `${window.location.origin}/reset-password`,
        handleCodeInApp: false,
      });

      await this.router.navigate(['/reset-password'], {
        queryParams: {
          notice: 'sent',
          email,
        },
      });
    } catch (error) {
      this.showFeedback(this.authService.traducirErrorFirebase(error), 'error');
    } finally {
      this.isSendingResetEmail = false;
    }
  }

  private showFeedback(message: string, type: 'success' | 'error') {
    this.feedbackMessage = message;
    this.feedbackType = type;
  }
}
