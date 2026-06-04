import { Component, ViewEncapsulation } from '@angular/core';

import { DashboardStateService } from '../../core/dashboard-state.service';

@Component({
  selector: 'app-enterprise-shell',
  standalone: false,
  templateUrl: './enterprise-shell.html',
  styleUrl: './enterprise-shell.css',
  encapsulation: ViewEncapsulation.None,
})
export class EnterpriseShellComponent {
  constructor(public readonly vm: DashboardStateService) {}
}
