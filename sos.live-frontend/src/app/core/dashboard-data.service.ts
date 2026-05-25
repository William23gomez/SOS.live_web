import { Injectable } from '@angular/core';
import {
  collection,
  doc,
  onSnapshot,
  setLogLevel,
  setDoc,
  Unsubscribe,
} from 'firebase/firestore';

import { db } from './firebase.config';

export interface DashboardMapLocation {
  lat?: number;
  lng?: number;
  label?: string;
  query?: string;
  source?: 'geocoded' | 'heuristic' | 'unresolved' | 'device';
  precision?: 'exact' | 'approximate';
  score?: number;
  matchType?: string;
}

export interface DashboardAlert {
  id: string;
  usuario: string;
  tipo: string;
  ubicacion: string;
  hora: string;
  prioridad: 'Alta' | 'Media' | 'Baja';
  estado: 'Nueva' | 'En proceso' | 'En camino' | 'Asignada' | 'Asignado' | 'Finalizado' | 'Cancelado';
  agenteAsignado: string;
  descripcion: string;
  mapa?: DashboardMapLocation | null;
}

export interface DashboardAgent {
  codigo: string;
  usuario?: string;
  nombre: string;
  estado: 'Disponible' | 'En servicio';
  zona: string;
  ubicacionExacta?: string;
  ultimaUbicacionTexto?: string;
  ultimaConexionAt?: string | null;
  telefono: string;
  email?: string;
  mapa?: DashboardMapLocation | null;
}

export interface DashboardHistoryRow {
  id: string;
  usuario: string;
  tipo: string;
  fecha: string;
  duracion: string;
  estado: 'Completado' | 'Cancelado';
}

export interface DashboardNotification {
  id: string;
  titulo: string;
  descripcion: string;
  tiempo: string;
  tipo: 'danger' | 'info' | 'success';
  leida: boolean;
}

export interface DashboardBillingRow {
  id: string;
  fecha: string;
  metodo: string;
  monto: string;
  estado: 'Completado' | 'Pendiente' | 'Rechazado' | 'Anulado';
}

export interface DashboardCompanyProfile {
  nombre: string;
  correo: string;
  telefono: string;
  direccion: string;
  nitEmpresa: string;
  plan: string;
  estado: string;
}

const EMPTY_COMPANY: DashboardCompanyProfile = {
  nombre: '',
  correo: '',
  telefono: '',
  direccion: '',
  nitEmpresa: '',
  plan: '',
  estado: '',
};

setLogLevel('error');

@Injectable({ providedIn: 'root' })
export class DashboardDataService {
  watchAlerts(onData: (items: DashboardAlert[]) => void): Unsubscribe {
    return this.watchCollection('dashboard_alerts', onData);
  }

  watchAgents(onData: (items: DashboardAgent[]) => void): Unsubscribe {
    return this.watchCollection('dashboard_agents', onData);
  }

  watchHistory(onData: (items: DashboardHistoryRow[]) => void): Unsubscribe {
    return this.watchCollection('dashboard_history', onData);
  }

  watchNotifications(onData: (items: DashboardNotification[]) => void): Unsubscribe {
    return this.watchCollection('dashboard_notifications', onData);
  }

  watchBilling(onData: (items: DashboardBillingRow[]) => void): Unsubscribe {
    return this.watchCollection('dashboard_billing', onData);
  }

  watchCompany(onData: (item: DashboardCompanyProfile) => void): Unsubscribe {
    const companyDoc = doc(db, 'dashboard_meta', 'company_profile');

    return onSnapshot(
      companyDoc,
      (snapshot) => {
        if (!snapshot.exists()) {
          onData(EMPTY_COMPANY);
          return;
        }

        onData(snapshot.data() as DashboardCompanyProfile);
      }
    );
  }

  async saveAlert(item: DashboardAlert) {
    await setDoc(doc(db, 'dashboard_alerts', item.id), item, { merge: true });
  }

  async patchAlert(id: string, patch: Partial<DashboardAlert>) {
    await setDoc(doc(db, 'dashboard_alerts', id), patch, { merge: true });
  }

  async saveAgent(item: DashboardAgent) {
    await setDoc(doc(db, 'dashboard_agents', item.codigo), item, { merge: true });
  }

  async patchAgent(codigo: string, patch: Partial<DashboardAgent>) {
    await setDoc(doc(db, 'dashboard_agents', codigo), patch, { merge: true });
  }

  async saveNotification(item: DashboardNotification) {
    await setDoc(doc(db, 'dashboard_notifications', item.id), item, { merge: true });
  }

  async saveAllNotifications(items: DashboardNotification[]) {
    await Promise.all(items.map((item) => this.saveNotification(item)));
  }

  async saveCompanyProfile(item: DashboardCompanyProfile) {
    await setDoc(doc(db, 'dashboard_meta', 'company_profile'), item, { merge: true });
  }

  private watchCollection<T extends object>(
    collectionName: string,
    onData: (items: T[]) => void
  ): Unsubscribe {
    return onSnapshot(
      collection(db, collectionName),
      (snapshot) => {
        if (snapshot.empty) {
          onData([]);
          return;
        }

        const items = snapshot.docs
          .map((item) => item.data() as T)
          .sort((a, b) => {
            const first = this.extractTimestamp(a);
            const second = this.extractTimestamp(b);
            return second.localeCompare(first);
          });
        onData(items);
      }
    );
  }

  private extractTimestamp(item: object) {
    const record = item as Record<string, unknown>;
    const value = record['updatedAt'] ?? record['createdAt'] ?? record['hora'] ?? '';
    return String(value);
  }
}
