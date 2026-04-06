import { Component, OnInit } from '@angular/core';

import { DashboardStateService } from '../../core/dashboard-state.service';

@Component({
  selector: 'app-alerts-page',
  standalone: false,
  templateUrl: './alerts-page.html',
})
export class AlertsPageComponent implements OnInit {
  constructor(public readonly vm: DashboardStateService) {}

  ngOnInit() {
    this.vm.initialize();
    this.vm.setActiveSection('alerts');
  }
}
