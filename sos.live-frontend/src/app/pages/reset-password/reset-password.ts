import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ActionCodeURL } from 'firebase/auth';

import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-reset-password',
  standalone: false,
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.css',
})
export class ResetPassword implements OnInit {
  private readonly securePasswordPattern = /^(?=.*[A-Za-z])(?=.*\d).{6,}$/;
  isPasswordVisible = false;
  isConfirmPasswordVisible = false;

  formData = {
    password: '',
    confirmPassword: '',
  };

  isSubmitting = false;
  feedbackMessage = '';
  feedbackType: 'success' | 'error' = 'success';
  resetCode = '';
  resetEmail = '';

  constructor(
    private readonly authService: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit() {
    this.resetCode = this.resolveResetCode();
    this.resetEmail = this.route.snapshot.queryParamMap.get('email') || '';

    if (this.route.snapshot.queryParamMap.get('notice') === 'sent') {
      const queryParams: Record<string, string> = {
        mode: 'empresa',
        notice: 'reset-sent',
      };

      if (this.resetEmail.trim()) {
        queryParams['email'] = this.resetEmail.trim().toLowerCase();
      }

      void this.router.navigate(['/login'], {
        queryParams,
        replaceUrl: true,
      });
      return;
    }

    if (!this.resetCode) {
      this.showFeedback(
        'Esta pantalla queda lista para cambiar la contrase\u00f1a cuando abras el enlace v\u00e1lido que llega al correo.',
        'success'
      );
    }
  }

  get canSubmitReset() {
    return !!this.resetCode && !this.isSubmitting;
  }

  async onSubmit() {
    const { password, confirmPassword } = this.formData;

    if (!password || !confirmPassword) {
      this.showFeedback('Completa ambos campos para restablecer la contrase\u00f1a.', 'error');
      return;
    }

    if (!this.securePasswordPattern.test(password)) {
      this.showFeedback(
        'La nueva contrase\u00f1a debe tener m\u00ednimo 6 caracteres e incluir letras y n\u00fameros.',
        'error'
      );
      return;
    }

    if (password !== confirmPassword) {
      this.showFeedback('Las contrase\u00f1as no coinciden.', 'error');
      return;
    }

    if (!this.resetCode) {
      this.showFeedback(
        'Primero debes abrir el enlace de recuperaci\u00f3n que llega al correo para poder cambiar la contrase\u00f1a aqu\u00ed.',
        'error'
      );
      return;
    }

    this.isSubmitting = true;
    this.showFeedback('', 'success');

    try {
      await this.authService.confirmarRestablecimientoContrasena(this.resetCode, password);
      this.showFeedback(
        'Contrase\u00f1a actualizada correctamente. Ahora puedes iniciar sesi\u00f3n.',
        'success'
      );

      setTimeout(() => {
        const queryParams: Record<string, string> = {
          mode: 'empresa',
          notice: 'reset-complete',
        };

        if (this.resetEmail.trim()) {
          queryParams['email'] = this.resetEmail.trim().toLowerCase();
        }

        void this.router.navigate(['/login'], {
          queryParams,
        });
      }, 1200);
    } catch (error) {
      this.showFeedback(this.authService.traducirErrorFirebase(error), 'error');
    } finally {
      this.isSubmitting = false;
    }
  }

  goToLogin() {
    void this.router.navigate(['/login']);
  }

  togglePasswordVisibility() {
    this.isPasswordVisible = !this.isPasswordVisible;
  }

  toggleConfirmPasswordVisibility() {
    this.isConfirmPasswordVisible = !this.isConfirmPasswordVisible;
  }

  private showFeedback(message: string, type: 'success' | 'error') {
    this.feedbackMessage = message;
    this.feedbackType = type;
  }

  private resolveResetCode() {
    const parsedActionLink = ActionCodeURL.parseLink(window.location.href);

    if (parsedActionLink?.code) {
      return parsedActionLink.code;
    }

    const directCode = this.route.snapshot.queryParamMap.get('oobCode');

    if (directCode) {
      return directCode;
    }

    const hash = window.location.hash.replace(/^#/, '');

    if (!hash) {
      return '';
    }

    const hashParams = new URLSearchParams(hash);
    return hashParams.get('oobCode') || '';
  }
}
