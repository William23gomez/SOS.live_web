import { Component, Input } from '@angular/core';

import { AdminCompany } from '../../core/admin.service';

@Component({
  selector: 'app-admin-companies',
  standalone: false,
  templateUrl: './admin-companies.html',
  styleUrl: './admin-companies.css',
})
export class AdminCompaniesComponent {
  @Input() companies: AdminCompany[] = [];
  @Input() isLoading = false;

  get approvedCompaniesCount() {
    return this.companies.filter((company) => company.estado === 'Aprobada').length;
  }

  get pendingCompaniesCount() {
    return this.companies.filter((company) => company.estado !== 'Aprobada').length;
  }
}
