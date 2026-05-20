import { Component, OnInit } from '@angular/core';

import { DashboardStateService } from '../../core/dashboard-state.service';

@Component({
  selector: 'app-agents-page',
  standalone: false,
  templateUrl: './agents-page.html',
})
export class AgentsPageComponent implements OnInit {
  constructor(public readonly vm: DashboardStateService) {}

  ngOnInit() {
    this.vm.initialize();
    this.vm.setActiveSection('agents');
  }

  async registerAgent() {
    await this.vm.createAgent(this.vm.agentFormData);
    this.vm.agentFormData = {
      nombre: '',
      usuario: '',
      password: '',
      codigo: '',
      zona: '',
      telefono: '',
    };
  }
}
