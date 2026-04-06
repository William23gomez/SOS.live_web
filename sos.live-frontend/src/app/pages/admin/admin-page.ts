import { Component } from '@angular/core';
import { Router } from '@angular/router';

import {
  AdminCompany,
  AdminOverview,
  AdminPayment,
  AdminService,
} from '../../core/admin.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-admin-page',
  standalone: false,
  templateUrl: './admin-page.html',
  styleUrl: './admin-page.css',
})
export class AdminPageComponent {
  activeSection: 'overview' | 'companies' | 'payments' | 'reports' = 'companies';
  companies: AdminCompany[] = [];
  payments: AdminPayment[] = [];
  overview: AdminOverview = {
    companiesCount: 0,
    adminCount: 0,
    alertsCount: 0,
    totalRevenue: '$0',
    pendingPayments: '$0',
  };
  isLoading = false;
  feedbackMessage = '';
  feedbackType: 'success' | 'error' = 'success';

  constructor(
    private readonly adminService: AdminService,
    private readonly authService: AuthService,
    private readonly router: Router
  ) {
    void this.loadAdminData();
  }

  get adminName() {
    return this.authService.getCachedProfile()?.nombre || 'Administrador SOS.LIVE';
  }

  setActiveSection(section: 'overview' | 'companies' | 'payments' | 'reports') {
    this.activeSection = section;
  }

  async loadAdminData() {
    this.isLoading = true;
    this.setFeedback('', 'success');

    try {
      const [overviewResponse, companiesResponse, paymentsResponse] = await Promise.all([
        this.adminService.getOverview(),
        this.adminService.listCompanies(),
        this.adminService.listPayments(),
      ]);

      this.overview = overviewResponse.overview;
      this.companies = companiesResponse.companies;
      this.payments = paymentsResponse.payments;
    } catch (error) {
      this.setFeedback(this.adminService.translateAdminError(error), 'error');
    } finally {
      this.isLoading = false;
    }
  }

  async cerrarSesion() {
    await this.authService.cerrarSesion();
    void this.router.navigate(['/login']);
  }

  private setFeedback(message: string, type: 'success' | 'error') {
    this.feedbackMessage = message;
    this.feedbackType = type;
  }
}
