import { Component, NgZone, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth.service';
import { PUBLIC_APP_URL } from '../../core/api.config';

type AccessMode = 'empresa' | 'admin';

@Component({
  selector: 'app-login',
  standalone: false,
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnInit {
  accessMode: AccessMode = 'empresa';
  isPasswordVisible = false;
  isRedirecting = false;
  private requestedNotice = '';
  private requestedEmail = '';
  private requestedReason = '';

  formData = {
    email: '',
    password: '',
  };

  isSubmitting = false;
  isSendingResetEmail = false;
  feedbackMessage = '';
  feedbackType: 'success' | 'error' = 'success';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly ngZone: NgZone
  ) {
    const queryParams = this.route.snapshot.queryParamMap;
    const requestedMode = queryParams.get('mode');
    this.requestedNotice = String(queryParams.get('notice') || '').trim();
    this.requestedEmail = String(queryParams.get('email') || '').trim().toLowerCase();
    this.requestedReason = String(queryParams.get('reason') || '').trim();

    if (requestedMode === 'admin' || requestedMode === 'empresa') {
      this.accessMode = requestedMode;
    }
  }

  async ngOnInit() {
    if (this.requestedEmail) {
      this.formData.email = this.requestedEmail;
    }

    const verificationCompletedNotice = this.authService.consumeEmailVerificationCompletedNotice();
    const completedEmail = (verificationCompletedNotice?.email || this.requestedEmail).trim();

    if (this.requestedNotice === 'verification-complete' || verificationCompletedNotice) {
      this.authService.clearPendingEmailVerificationEmail();
      await this.replaceVerificationNotice('verification-complete', completedEmail);
      this.showVerifiedFeedback(completedEmail);
      return;
    }

    const pendingEmail =
      this.requestedEmail || this.authService.getPendingEmailVerificationEmail();

    if (this.requestedNotice === 'verification-sent') {
      if (pendingEmail) {
        this.authService.rememberPendingEmailVerification(pendingEmail);
      }

      this.showFeedback(
        pendingEmail
          ? `Te enviamos un correo de verificaci\u00f3n a ${pendingEmail}. Revisa tu bandeja y spam antes de iniciar sesi\u00f3n.`
          : 'Te enviamos un correo de verificaci\u00f3n. Revisa tu bandeja y spam antes de iniciar sesi\u00f3n.',
        'success'
      );
      return;
    }

    if (this.requestedNotice === 'reset-sent') {
      this.showFeedback(
        this.requestedEmail
          ? `Te enviamos un correo de recuperacion a ${this.requestedEmail}. Usa el ultimo enlace recibido para cambiar la contrasena y luego ingresala aqui para iniciar sesion.`
          : 'Te enviamos un correo de recuperacion. Usa el ultimo enlace recibido para cambiar la contrasena y luego ingresala aqui para iniciar sesion.',
        'success'
      );
      return;
    }

    if (this.requestedNotice === 'reset-complete') {
      this.showFeedback(
        this.requestedEmail
          ? `La contrasena de ${this.requestedEmail} ya fue actualizada. Ahora puedes iniciar sesion.`
          : 'La contrasena ya fue actualizada. Ahora puedes iniciar sesion.',
        'success'
      );
      return;
    }

    if (pendingEmail && (await this.tryShowVerifiedNoticeIfReady(pendingEmail))) {
      return;
    }

    if (this.requestedNotice === 'verification-issue') {
      this.showFeedback(
        this.requestedReason
          ? `La cuenta fue creada, pero no pudimos enviar el correo de verificaci\u00f3n. ${this.requestedReason}`
          : 'La cuenta fue creada, pero no pudimos enviar el correo de verificaci\u00f3n. Intenta iniciar sesi\u00f3n m\u00e1s tarde o solicita una nueva verificaci\u00f3n.',
        'error'
      );
    }
  }

  get accessDescription() {
    return this.accessMode === 'admin'
      ? 'Este acceso queda reservado para supervisi\u00f3n, control global y gesti\u00f3n interna del sistema.'
      : 'Si no tienes una cuenta de empresa, reg\u00edstrate aqu\u00ed.';
  }

  get formTitle() {
    return this.accessMode === 'admin' ? 'Portal Administrativo' : 'Iniciar Sesi\u00f3n';
  }

  get submitLabel() {
    if (this.isSubmitting) {
      return 'Ingresando...';
    }

    return this.accessMode === 'admin' ? 'Entrar como admin' : 'Iniciar Sesi\u00f3n';
  }

  get forgotPasswordLabel() {
    return this.isSendingResetEmail ? 'Enviando...' : 'Restabl\u00e9cela aqu\u00ed';
  }

  setAccessMode(mode: AccessMode) {
    this.accessMode = mode;
    this.isPasswordVisible = false;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.showFeedback('', 'success');
  }

  async onSubmit() {
    if (this.isSubmitting) {
      return;
    }

    const { email, password } = this.formData;
    const isAdminAccess = this.accessMode === 'admin';
    const loginIdentifier = email.trim();

    if (!loginIdentifier || !password) {
      const message = isAdminAccess
        ? 'Completa usuario o correo admin y contrase\u00f1a para iniciar sesi\u00f3n.'
        : 'Completa correo y contrase\u00f1a para iniciar sesi\u00f3n.';
      this.showFeedback(message, 'error');
      return;
    }

    this.isSubmitting = true;
    this.showFeedback('', 'success');

    try {
      let loginEmail = loginIdentifier;

      if (isAdminAccess) {
        const resolvedAdmin = await this.authService.resolveAdminAccess(loginIdentifier);
        loginEmail = resolvedAdmin.admin.email;
      }

      const response = await this.authService.loginUsuario({ email: loginEmail, password });
      const expectedRole = isAdminAccess ? 'admin' : 'empresa';

      if (response.user.rol !== expectedRole) {
        await this.authService.cerrarSesion();

        const message = isAdminAccess
          ? 'Estas credenciales no pertenecen a un administrador.'
          : 'Este acceso es solo para empresas. Usa el acceso admin si corresponde.';

        this.showFeedback(message, 'error');
        return;
      }

      const targetRoute = this.authService.getRedirectRouteForRole(response.user.rol);
      this.isRedirecting = true;
      this.showFeedback('Inicio de sesi\u00f3n exitoso. Redirigiendo...', 'success');

      const navigationSucceeded = await Promise.race([
        this.router.navigate([targetRoute]),
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), 1800);
        }),
      ]);

      if (!navigationSucceeded) {
        window.location.assign(targetRoute);
      }
    } catch (error) {
      const message = await this.resolveLoginErrorMessage(error, loginIdentifier, isAdminAccess);
      this.showFeedback(message, 'error');
    } finally {
      this.isRedirecting = false;
      this.isSubmitting = false;
    }
  }

  async onResetPassword(event?: Event) {
    event?.preventDefault();

    if (this.accessMode === 'admin') {
      this.showFeedback(
        'El acceso admin se gestiona por separado. Usa tus credenciales administrativas.',
        'error'
      );
      return;
    }

    if (this.isSendingResetEmail) {
      return;
    }

    const email = this.formData.email.trim();

    if (!email) {
      this.showFeedback('Escribe tu correo y luego pulsa "Restabl\u00e9cela aqu\u00ed".', 'error');
      return;
    }

    this.isSendingResetEmail = true;
    this.showFeedback('', 'success');

    try {
      await this.authService.restablecerContrasena(email, {
        url: `${PUBLIC_APP_URL}/reset-password`,
        handleCodeInApp: false,
      });

      this.ngZone.run(() => {
        this.isSendingResetEmail = false;
        this.requestedNotice = 'reset-sent';
        this.requestedEmail = email.trim().toLowerCase();
        this.formData.email = this.requestedEmail;
        this.showFeedback(
          `Te enviamos un correo de recuperacion a ${this.requestedEmail}. Usa el ultimo enlace recibido para cambiar la contrasena y luego ingresala aqui para iniciar sesion.`,
          'success'
        );

        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {
            mode: 'empresa',
            notice: 'reset-sent',
            email: this.requestedEmail,
          },
          replaceUrl: true,
        });
      });
    } catch (error) {
      this.ngZone.run(() => {
        this.showFeedback(this.authService.traducirErrorFirebase(error), 'error');
      });
    } finally {
      this.ngZone.run(() => {
        this.isSendingResetEmail = false;
      });
    }
  }

  togglePasswordVisibility() {
    this.isPasswordVisible = !this.isPasswordVisible;
  }

  private async tryShowVerifiedNoticeIfReady(email: string) {
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail) {
      return false;
    }

    try {
      const verificationStatus = await this.authService.consultarEstadoVerificacionCorreo(
        normalizedEmail
      );

      if (!verificationStatus.emailVerified) {
        return false;
      }

      const verifiedEmail = verificationStatus.email || normalizedEmail;
      this.authService.clearPendingEmailVerificationEmail();
      await this.replaceVerificationNotice('verification-complete', verifiedEmail);
      this.showVerifiedFeedback(verifiedEmail);
      return true;
    } catch {
      return false;
    }
  }

  private async resolveLoginErrorMessage(
    error: unknown,
    loginIdentifier: string,
    isAdminAccess: boolean
  ) {
    const errorCode =
      typeof error === 'object' && error && 'code' in error
        ? String(error.code)
        : '';

    if (errorCode === 'auth/invalid-credential') {
      if (isAdminAccess) {
        return 'Usuario o contrase\u00f1a incorrectos.';
      }

      const matchingAdmin = await this.authService.resolveAdminAccessIfExists(loginIdentifier);

      if (matchingAdmin) {
        return 'Este correo pertenece a una cuenta admin. Usa el acceso admin para ingresar.';
      }

      return 'Usuario o contrase\u00f1a incorrectos.';
    }

    return this.authService.traducirErrorFirebase(error);
  }

  private showFeedback(message: string, type: 'success' | 'error') {
    this.feedbackMessage = message;
    this.feedbackType = type;
  }

  private showVerifiedFeedback(email: string) {
    this.showFeedback(
      email
        ? `El correo ${email} ya fue verificado correctamente. Ahora puedes iniciar sesi\u00f3n.`
        : 'El correo fue verificado correctamente. Ahora puedes iniciar sesi\u00f3n.',
      'success'
    );
  }

  private async replaceVerificationNotice(
    notice: 'verification-complete' | 'verification-sent',
    email?: string
  ) {
    const queryParams: Record<string, string> = {
      mode: this.accessMode,
      notice,
    };

    if (email) {
      queryParams['email'] = email;
    }

    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      replaceUrl: true,
    });
  }
}
