import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { Home } from './pages/home/home.component';
import { Login } from './pages/login/login';
import { Dashboard } from './pages/dashboard/dashboard';
import { Register } from './pages/register/register';
import { ResetPassword } from './pages/reset-password/reset-password';
import { EmailVerified } from './pages/email-verified/email-verified';
import { AdminPageComponent } from './pages/admin/admin-page';
import { AdminGuard } from './core/guards/admin.guard';
import { CompanyGuard } from './core/guards/company.guard';

const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: 'home', component: Home },
  { path: 'register', component: Register },
  { path: 'login', component: Login },
  { path: 'reset-password', component: ResetPassword },
  { path: 'email-verified', component: EmailVerified },
  { path: 'dashboard', component: Dashboard, data: { section: 'overview' }, canActivate: [CompanyGuard] },
  { path: 'alertas', component: Dashboard, data: { section: 'alerts' }, canActivate: [CompanyGuard] },
  { path: 'agentes', component: Dashboard, data: { section: 'agents' }, canActivate: [CompanyGuard] },
  { path: 'historial', component: Dashboard, data: { section: 'history' }, canActivate: [CompanyGuard] },
  { path: 'perfil-empresa', component: Dashboard, data: { section: 'company' }, canActivate: [CompanyGuard] },
  { path: 'pagos', component: Dashboard, data: { section: 'billing' }, canActivate: [CompanyGuard] },
  { path: 'notificaciones', component: Dashboard, data: { section: 'notifications' }, canActivate: [CompanyGuard] },
  { path: 'admin', component: AdminPageComponent, canActivate: [AdminGuard] }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
