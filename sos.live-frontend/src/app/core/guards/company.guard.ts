import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';

import { AuthService } from '../auth.service';

@Injectable({ providedIn: 'root' })
export class CompanyGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly router: Router
  ) {}

  async canActivate(): Promise<boolean | UrlTree> {
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

      return true;
    } catch {
      return this.router.parseUrl('/login');
    }
  }
}
