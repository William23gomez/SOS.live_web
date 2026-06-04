import { Component, OnInit } from '@angular/core';

import { DashboardStateService } from '../../core/dashboard-state.service';

@Component({
  selector: 'app-dashboard-overview',
  standalone: false,
  templateUrl: './dashboard-overview.html',
})
export class DashboardOverviewPage implements OnInit {
  constructor(public readonly vm: DashboardStateService) {}

  ngOnInit() {
    this.vm.initialize();
    this.vm.setActiveSection('overview');
  }
}
