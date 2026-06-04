import { Component, OnInit } from '@angular/core';

import { DashboardStateService } from '../../core/dashboard-state.service';

@Component({
  selector: 'app-history-page',
  standalone: false,
  templateUrl: './history-page.html',
})
export class HistoryPageComponent implements OnInit {
  constructor(public readonly vm: DashboardStateService) {}

  ngOnInit() {
    this.vm.initialize();
    this.vm.setActiveSection('history');
  }
}
