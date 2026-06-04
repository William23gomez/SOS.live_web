import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ActionCodeURL } from 'firebase/auth';

import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-email-verified',
  standalone: false,
  templateUrl: './email-verified.html',
  styleUrl: './email-verified.css',
})
export class EmailVerified implements OnInit, OnDestroy {
  isProcessing = false;
  isRedirecting = false;
  verificationCode = '';
  feedbackMessage = '';
  feedbackType: 'success' | 'error' = 'success';
  verificationCompleted = false;
  targetApp: 'empresa' | 'general' = 'general';
  verificationEmail = '';
  private verificationStatusWatchdog?: ReturnType<typeof setTimeout>;
  private verificationStatusInterval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly authService: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  async ngOnInit() {
    this.targetApp = this.route.snapshot.queryParamMap.get('app') === 'empresa' ? 'empresa' : 'general';
    this.verificationCode = this.resolveVerificationCode();
    this.verificationEmail = this.resolveVerificationEmail();

    const verifiedFromCurrentSession = await this.tryCompleteFromCurrentSession(
      'Correo verificado correctamente. Ya puedes iniciar sesion.'
    );

    if (verifiedFromCurrentSession) {
      return;
    }

    if (!this.verificationCode) {
      const verifiedWithoutCode = await this.tryCompleteIfAlreadyVerified();

      if (verifiedWithoutCode) {
        return;
      }

      this.showFeedback(
        'Abre esta pantalla desde el enlace real de verificacion que llega al correo.',
        'error'
      );
      return;
    }

    this.isProcessing = true;
    this.startVerificationStatusWatcher();

    try {
      const verificationResult = await this.authService.confirmarVerificacionCorreo(
        this.verificationCode,
        this.verificationEmail
      );

      if (this.verificationCompleted) {
        return;
      }

      this.verificationEmail = verificationResult.email || this.verificationEmail;
      this.markVerificationAsCompleted(
        'Verificacion correcta. El correo ya quedo habilitado para iniciar sesion.'
      );
    } catch (error) {
      if (this.verificationCompleted) {
        return;
      }

      const errorCode =
        typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

      const verifiedAfterFallback = await this.tryCompleteIfAlreadyVerified(
        errorCode === 'auth/invalid-action-code'
          ? 'Este enlace ya fue usado y el correo ya quedo verificado. Ya puedes iniciar sesion.'
          : 'Verificacion correcta. Firebase ya marco este correo como verificado y ya puedes iniciar sesion.'
      );

      if (verifiedAfterFallback) {
        return;
      }

      const verifiedFromSessionAfterFallback = await this.tryCompleteFromCurrentSession(
        'Correo verificado correctamente. Ya puedes iniciar sesion.'
      );

      if (verifiedFromSessionAfterFallback) {
        return;
      }

      if (
        this.targetApp === 'empresa' &&
        (errorCode === 'auth/invalid-action-code' || errorCode === 'auth/expired-action-code')
      ) {
        this.markVerificationAsCompleted(
          'Este enlace ya habia sido usado. Si la cuenta ya te deja iniciar sesion, el correo quedo verificado correctamente.'
        );
        return;
      }

      this.showFeedback(this.authService.traducirErrorFirebase(error), 'error');
    } finally {
      this.stopVerificationStatusWatcher();
      this.isProcessing = false;
    }
  }

  ngOnDestroy() {
    this.stopVerificationStatusWatcher();
  }

  goToLogin() {
    this.isRedirecting = true;
    this.stopVerificationStatusWatcher();

    void this.router
      .navigate(['/login'], {
        queryParams: {
          mode: 'empresa',
          notice: 'verification-complete',
          email: this.verificationEmail || undefined,
        },
      })
      .then((navigated) => {
        if (!navigated) {
          const target = this.verificationEmail
            ? `/login?mode=empresa&notice=verification-complete&email=${encodeURIComponent(this.verificationEmail)}`
            : '/login?mode=empresa&notice=verification-complete';
          window.location.assign(target);
        }
      })
      .finally(() => {
        this.isRedirecting = false;
      });
  }

  private showFeedback(message: string, type: 'success' | 'error') {
    this.feedbackMessage = message;
    this.feedbackType = type;
  }

  private markVerificationAsCompleted(message: string) {
    if (this.verificationCompleted) {
      return;
    }

    this.verificationCompleted = true;
    this.isProcessing = false;
    this.stopVerificationStatusWatcher();
    this.authService.markEmailVerificationCompleted(this.verificationEmail);
    this.showFeedback(message, 'success');

    if (this.targetApp === 'empresa') {
      setTimeout(() => {
        this.goToLogin();
      }, 1500);
    }
  }

  private startVerificationStatusWatcher() {
    this.stopVerificationStatusWatcher();

    const normalizedEmail = String(this.verificationEmail || '').trim().toLowerCase();

    if (!normalizedEmail) {
      return;
    }

    const checkVerificationStatus = async (message: string) => {
      if (this.verificationCompleted || !this.isProcessing) {
        return;
      }

      const verifiedByEmail = await this.tryCompleteIfAlreadyVerified(message);

      if (!verifiedByEmail) {
        await this.tryCompleteFromCurrentSession(message);
      }
    };

    this.verificationStatusWatchdog = setTimeout(() => {
      void checkVerificationStatus(
        'Verificacion correcta. El correo ya quedo confirmado y puedes iniciar sesion ahora mismo.'
      );
    }, 2500);

    this.verificationStatusInterval = setInterval(() => {
      void checkVerificationStatus(
        'Verificacion correcta. El correo ya quedo confirmado y puedes iniciar sesion ahora mismo.'
      );
    }, 5000);
  }

  private stopVerificationStatusWatcher() {
    if (this.verificationStatusWatchdog) {
      clearTimeout(this.verificationStatusWatchdog);
      this.verificationStatusWatchdog = undefined;
    }

    if (this.verificationStatusInterval) {
      clearInterval(this.verificationStatusInterval);
      this.verificationStatusInterval = undefined;
    }
  }

  private async tryCompleteIfAlreadyVerified(message?: string) {
    const normalizedEmail = String(this.verificationEmail || '').trim().toLowerCase();

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

      this.verificationEmail = verificationStatus.email || normalizedEmail;
      this.markVerificationAsCompleted(
        message ||
          'Verificacion correcta. El correo ya quedo confirmado y puedes iniciar sesion.'
      );
      return true;
    } catch {
      return false;
    }
  }

  private async tryCompleteFromCurrentSession(message?: string) {
    try {
      const currentUser = await this.authService.waitForCurrentUser(2500);

      if (!currentUser?.emailVerified) {
        return false;
      }

      this.verificationEmail = String(currentUser.email || this.verificationEmail || '')
        .trim()
        .toLowerCase();
      this.markVerificationAsCompleted(
        message || 'Correo verificado correctamente. Ya puedes iniciar sesion.'
      );
      return true;
    } catch {
      return false;
    }
  }

  private resolveVerificationEmail() {
    const candidates = [
      this.route.snapshot.queryParamMap.get('email'),
      this.route.snapshot.queryParamMap.get('continueUrl'),
      ActionCodeURL.parseLink(window.location.href)?.continueUrl,
      window.location.href,
      window.location.search,
      window.location.hash,
    ];

    for (const candidate of candidates) {
      const resolvedEmail = this.extractEmailFromCandidate(String(candidate || ''));

      if (resolvedEmail) {
        return resolvedEmail;
      }
    }

    return this.authService.getPendingEmailVerificationEmail();
  }

  private resolveVerificationCode() {
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

  private extractEmailFromCandidate(candidate: string): string {
    const normalizedCandidate = String(candidate || '').trim();

    if (!normalizedCandidate) {
      return '';
    }

    try {
      const parsedUrl = normalizedCandidate.startsWith('http')
        ? new URL(normalizedCandidate)
        : new URL(normalizedCandidate, window.location.origin);
      const directEmail = String(parsedUrl.searchParams.get('email') || '')
        .trim()
        .toLowerCase();

      if (directEmail) {
        return directEmail;
      }

      const nestedContinueUrl = String(parsedUrl.searchParams.get('continueUrl') || '').trim();

      if (nestedContinueUrl && nestedContinueUrl !== normalizedCandidate) {
        return this.extractEmailFromCandidate(nestedContinueUrl);
      }
    } catch {
      const queryCandidate = normalizedCandidate.replace(/^#/, '').replace(/^[^?]*\?/, '');
      const params = new URLSearchParams(queryCandidate);
      const directEmail = String(params.get('email') || '').trim().toLowerCase();

      if (directEmail) {
        return directEmail;
      }

      const nestedContinueUrl = String(params.get('continueUrl') || '').trim();

      if (nestedContinueUrl && nestedContinueUrl !== normalizedCandidate) {
        return this.extractEmailFromCandidate(nestedContinueUrl);
      }
    }

    return '';
  }
}
