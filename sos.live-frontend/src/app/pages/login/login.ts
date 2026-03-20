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
  feedbackMessage = '';
  feedbackType: 'success' | 'error' = 'success';

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router
  ) {}

  async onSubmit() {
    const { email, password } = this.formData;

    if (!email || !password) {
      this.showFeedback('Completa correo y contrasena para iniciar sesion.', 'error');
      return;
    }

    this.isSubmitting = true;
    this.showFeedback('', 'success');

    try {
      await this.authService.loginUsuario({ email, password });
      this.showFeedback('Inicio de sesion exitoso. Redirigiendo...', 'success');

      setTimeout(() => {
        void this.router.navigate(['/dashboard']);
      }, 1000);
    } catch (error) {
      this.showFeedback(this.authService.traducirErrorFirebase(error), 'error');
    } finally {
      this.isSubmitting = false;
    }
  }

  private showFeedback(message: string, type: 'success' | 'error') {
    this.feedbackMessage = message;
    this.feedbackType = type;
  }
}
