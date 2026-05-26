import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';

import { AuthService } from '../auth.service';
import { PaymentsService } from '../payments.service';

@Injectable({ providedIn: 'root' })
export class CompanyGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly paymentsService: PaymentsService,
    private readonly router: Router
  ) {}

  async canActivate(
    _route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Promise<boolean | UrlTree> {
    const currentUser = await this.authService.waitForCurrentUser();

    if (!currentUser) {
      return this.router.parseUrl('/login');
    }

    try {
      const cachedProfile = this.authService.getCachedProfile();
      const profile =
        cachedProfile?.rol ? cachedProfile : (await this.authService.obtenerPerfil()).user;

      if (profile.rol === 'admin') {
        return this.router.parseUrl('/admin');
      }

      const targetPath = (state.url || '').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/dashboard';

      if (targetPath === '/pagos') {
        return true;
      }

      const accessStatus = await this.paymentsService.getAccessStatus();

      if (!accessStatus.hasActivePayment) {
        return this.router.createUrlTree(['/pagos'], {
          queryParams: {
            required: 'payment',
            redirect: targetPath,
          },
        });
      }

      return true;
    } catch {
      return this.router.parseUrl('/login');
    }
  }
}
