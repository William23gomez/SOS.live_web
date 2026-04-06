import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-register',
  standalone: false,
  templateUrl: './register.html',
  styleUrl: './register.css',
})
export class Register {
  private readonly securePasswordPattern = /^(?=.*[A-Za-z])(?=.*\d).{6,}$/;

  formData = {
    nombre: '',
    email: '',
    telefono: '',
    nit: '',
    password: '',
    terms: false,
  };

  isSubmitting = false;
  feedbackMessage = '';
  feedbackType: 'success' | 'error' = 'success';
  registrationCompleted = false;
  isSendingVerificationEmail = false;

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router
  ) {}

  onlyNumbers(field: 'telefono' | 'nit') {
    const sanitizedValue = this.formData[field].replace(/[^0-9]/g, '');
    const hadInvalidCharacters = sanitizedValue !== this.formData[field];

    this.formData[field] = sanitizedValue;

    if (hadInvalidCharacters) {
      const label = field === 'telefono' ? 'El telefono' : 'El NIT';
      this.showFeedback(`${label} solo puede contener numeros.`, 'error');
    }
  }

  async onSubmit() {
    if (this.isSubmitting) {
      return;
    }

    const { nombre, email, telefono, nit, password, terms } = this.formData;

    if (!nombre || !email || !telefono || !nit || !password) {
      this.showFeedback('Completa todos los campos para crear la cuenta.', 'error');
      return;
    }

    if (!terms) {
      this.showFeedback('Debes aceptar los terminos y condiciones para continuar.', 'error');
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

    if (!this.securePasswordPattern.test(password)) {
      this.showFeedback(
        'La contrasena debe tener minimo 6 caracteres e incluir letras y numeros.',
        'error'
      );
      return;
    }

    this.isSubmitting = true;
    this.registrationCompleted = false;
    this.showFeedback('', 'success');

    try {
      await this.authService.registrarUsuario({
        nombre,
        email,
        telefono,
        nit,
        password,
      });

      this.showFeedback(
        'Cuenta creada correctamente. Estamos enviando el correo de verificacion...',
        'success'
      );
      this.registrationCompleted = true;
      this.formData = {
        nombre: '',
        email: '',
        telefono: '',
        nit: '',
        password: '',
        terms: false,
      };
      this.isSubmitting = false;
      void this.finalizarVerificacion();
    } catch (error) {
      this.showFeedback(this.authService.traducirErrorFirebase(error), 'error');
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

  private async finalizarVerificacion() {
    this.isSendingVerificationEmail = true;

    try {
      const result = await this.authService.finalizarRegistroConVerificacion();

      this.showFeedback(
        result.emailVerificationSent
          ? 'Cuenta creada correctamente. Firebase envio el correo de verificacion; revisa tu bandeja y spam antes de iniciar sesion.'
          : `Cuenta creada correctamente, pero Firebase no pudo enviar el correo de verificacion.${result.emailVerificationError ? ` ${result.emailVerificationError}` : ''}`,
        'success'
      );
    } finally {
      this.isSendingVerificationEmail = false;
    }
  }
}
