import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-reset-password',
  standalone: false,
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.css',
})
export class ResetPassword implements OnInit {
  private readonly securePasswordPattern = /^(?=.*[A-Za-z])(?=.*\d).{6,}$/;

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
      this.showFeedback(
        this.resetEmail
          ? `Te llegara un correo de recuperacion a ${this.resetEmail}. Revisa entrada, spam o promociones y abre ese enlace para cambiar la contrasena.`
          : 'Te llegara un correo de recuperacion. Revisa entrada, spam o promociones y abre ese enlace para cambiar la contrasena.',
        'success'
      );
      return;
    }

    if (!this.resetCode) {
      this.showFeedback(
        'Esta pantalla queda lista para cambiar la contrasena cuando abras el enlace valido que llega al correo.',
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
      this.showFeedback('Completa ambos campos para restablecer la contrasena.', 'error');
      return;
    }

    if (!this.securePasswordPattern.test(password)) {
      this.showFeedback(
        'La nueva contrasena debe tener minimo 6 caracteres e incluir letras y numeros.',
        'error'
      );
      return;
    }

    if (password !== confirmPassword) {
      this.showFeedback('Las contrasenas no coinciden.', 'error');
      return;
    }

    if (!this.resetCode) {
      this.showFeedback(
        'Primero debes abrir el enlace de recuperacion que llega al correo para poder cambiar la contrasena aqui.',
        'error'
      );
      return;
    }

    this.isSubmitting = true;
    this.showFeedback('', 'success');

    try {
      await this.authService.confirmarRestablecimientoContrasena(this.resetCode, password);
      this.showFeedback(
        'Contrasena actualizada correctamente. Ahora puedes iniciar sesion.',
        'success'
      );

      setTimeout(() => {
        void this.router.navigate(['/login']);
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

  private showFeedback(message: string, type: 'success' | 'error') {
    this.feedbackMessage = message;
    this.feedbackType = type;
  }

  private resolveResetCode() {
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
