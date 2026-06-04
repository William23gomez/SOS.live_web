import { NgModule, provideBrowserGlobalErrorListeners } from '@angular/core';
import { HttpClientModule } from '@angular/common/http';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';

import { AppRoutingModule } from './app-routing-module';
import { App } from './app';
import { Home } from './pages/home/home.component';
import { Login } from './pages/login/login';
import { Dashboard } from './pages/dashboard/dashboard';
import { DashboardOverviewPage } from './pages/dashboard/dashboard-overview';
import { Register } from './pages/register/register';
import { ResetPassword } from './pages/reset-password/reset-password';
import { EmailVerified } from './pages/email-verified/email-verified';
import { AdminPageComponent } from './pages/admin/admin-page';
import { AdminCompaniesComponent } from './pages/admin/admin-companies';
import { AlertsPageComponent } from './pages/alerts/alerts-page';
import { AgentsPageComponent } from './pages/agents/agents-page';
import { HistoryPageComponent } from './pages/history/history-page';
import { EnterpriseShellComponent } from './shared/enterprise-shell/enterprise-shell';

@NgModule({
  declarations: [
    App,
    Home,
    Login,
    Dashboard,
    DashboardOverviewPage,
    Register,
    ResetPassword,
    EmailVerified,
    AdminPageComponent,
    AdminCompaniesComponent,
    AlertsPageComponent,
    AgentsPageComponent,
    HistoryPageComponent,
    EnterpriseShellComponent,
  ],
  imports: [BrowserModule, HttpClientModule, FormsModule, AppRoutingModule],
  providers: [provideBrowserGlobalErrorListeners()],
  bootstrap: [App],
})
export class AppModule {}
