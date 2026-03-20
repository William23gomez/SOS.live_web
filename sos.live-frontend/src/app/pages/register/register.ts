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

    this.isSubmitting = true;
    this.registrationCompleted = false;
    this.showFeedback('', 'success');

    try {
      const result = await this.authService.registrarUsuario({
        nombre,
        email,
        telefono,
        nit,
        password,
      });

      this.showFeedback(
        result.emailVerificationSent
          ? 'Cuenta creada correctamente. Firebase envio el correo de verificacion; revisa tu bandeja y spam antes de iniciar sesion.'
          : 'Cuenta creada correctamente. El perfil ya quedo registrado; si el correo no llega de inmediato, espera un momento y revisa spam.',
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
}
