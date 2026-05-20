import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth.service';

type AccessMode = 'empresa' | 'admin';

@Component({
  selector: 'app-register',
  standalone: false,
  templateUrl: './register.html',
  styleUrl: './register.css',
})
export class Register {
  private readonly securePasswordPattern = /^(?=.*[A-Za-z])(?=.*\d).{6,}$/;
  accessMode: AccessMode = 'empresa';
  isPasswordVisible = false;

  formData = {
    nombre: '',
    email: '',
    telefono: '',
    nit: '',
    password: '',
    terms: false,
  };

  isSubmitting = false;
  isCheckingAvailability = false;
  feedbackMessage = '';
  feedbackType: 'success' | 'error' = 'success';
  registrationCompleted = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly authService: AuthService,
    private readonly router: Router
  ) {
    const requestedMode = this.route.snapshot.queryParamMap.get('mode');

    if (requestedMode === 'admin' || requestedMode === 'empresa') {
      this.accessMode = requestedMode;
    }
  }

  get submitLabel() {
    if (this.isCheckingAvailability) {
      return 'Validando datos...';
    }

    if (this.isSubmitting) {
      return 'Creando cuenta...';
    }

    return 'Registrarse';
  }

  setAccessMode(mode: AccessMode) {
    this.accessMode = mode;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.showFeedback('', 'success');
  }

  onlyNumbers(field: 'telefono' | 'nit') {
    const sanitizedValue = this.formData[field].replace(/[^0-9]/g, '');
    const hadInvalidCharacters = sanitizedValue !== this.formData[field];

    this.formData[field] = sanitizedValue;

    if (hadInvalidCharacters) {
      const label = field === 'telefono' ? 'El tel\u00e9fono' : 'El NIT';
      this.showFeedback(`${label} solo puede contener n\u00fameros.`, 'error');
    }
  }

  async onSubmit() {
    if (this.accessMode === 'admin') {
      this.showFeedback('Las cuentas administrativas no se registran desde este formulario.', 'error');
      return;
    }

    if (this.isSubmitting) {
      return;
    }

    const nombre = this.formData.nombre.trim();
    const email = this.formData.email.trim().toLowerCase();
    const telefono = this.formData.telefono.trim();
    const nit = this.formData.nit.trim();
    const password = this.formData.password;
    const { terms } = this.formData;

    if (!nombre || !email || !telefono || !nit || !password) {
      this.showFeedback('Completa todos los campos para crear la cuenta.', 'error');
      return;
    }

    if (!terms) {
      this.showFeedback('Debes aceptar los t\u00e9rminos y condiciones para continuar.', 'error');
      return;
    }

    if (!/^\d+$/.test(telefono)) {
      this.showFeedback('El tel\u00e9fono solo puede contener n\u00fameros.', 'error');
      return;
    }

    if (!/^\d+$/.test(nit)) {
      this.showFeedback('El NIT solo puede contener n\u00fameros.', 'error');
      return;
    }

    if (!this.securePasswordPattern.test(password)) {
      this.showFeedback(
        'La contrase\u00f1a debe tener m\u00ednimo 6 caracteres e incluir letras y n\u00fameros.',
        'error'
      );
      return;
    }

    this.isSubmitting = true;
    this.isCheckingAvailability = true;
    this.registrationCompleted = false;
    this.showFeedback('', 'success');

    try {
      await this.authService.verificarDisponibilidadRegistro({
        nombre,
        email,
        telefono,
        nit,
      });

      this.isCheckingAvailability = false;
      const result = await this.authService.registrarUsuario({
        nombre,
        email,
        telefono,
        nit,
        password,
      });

      this.registrationCompleted = true;
      this.redirigirAlLoginConResultado(email, result);
    } catch (error) {
      this.showFeedback(this.authService.traducirErrorFirebase(error), 'error');
    } finally {
      this.isSubmitting = false;
      this.isCheckingAvailability = false;
    }
  }

  goToLogin() {
    void this.router.navigate(['/login'], {
      queryParams: {
        mode: this.accessMode,
      },
    });
  }

  goToAdminLogin() {
    void this.router.navigate(['/login'], {
      queryParams: {
        mode: 'admin',
      },
    });
  }

  togglePasswordVisibility() {
    this.isPasswordVisible = !this.isPasswordVisible;
  }

  private showFeedback(message: string, type: 'success' | 'error') {
    this.feedbackMessage = message;
    this.feedbackType = type;
  }

  private redirigirAlLoginConResultado(
    email: string,
    result: { emailVerificationSent: boolean; emailVerificationError?: string }
  ) {
    if (result.emailVerificationSent) {
      this.authService.rememberPendingEmailVerification(email);
    } else {
      this.authService.clearPendingEmailVerificationEmail();
    }

    const notice = result.emailVerificationSent ? 'verification-sent' : 'verification-issue';

    void this.router.navigate(['/login'], {
      queryParams: {
        mode: 'empresa',
        notice,
        email,
        reason: result.emailVerificationError || undefined,
      },
    });
  }
}
