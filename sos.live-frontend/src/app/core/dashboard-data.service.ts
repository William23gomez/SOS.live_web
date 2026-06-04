import { Injectable } from '@angular/core';
import {
  collection,
  doc,
  onSnapshot,
  query,
  setLogLevel,
  setDoc,
  Unsubscribe,
  where,
} from 'firebase/firestore';

import { AuthService } from './auth.service';
import { auth, db } from './firebase.config';

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
  source?: string | null;
  sourceNoticeId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  calificacionServicio?: number | null;
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
  estado: 'Completado' | 'Cancelado' | 'Pendiente';
  alertId?: string;
  ubicacion?: string;
  agenteAsignado?: string;
  calificacion?: number | null;
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
  companyUid?: string;
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
  constructor(private readonly authService: AuthService) {}

  watchAlerts(companyUid: string, onData: (items: DashboardAlert[]) => void): Unsubscribe {
    return this.watchScopedCollection('dashboard_alerts', companyUid, ['companyUid', 'createdBy'], onData);
  }

  watchAgents(companyUid: string, onData: (items: DashboardAgent[]) => void): Unsubscribe {
    return this.watchScopedCollection('dashboard_agents', companyUid, ['companyUid', 'createdBy'], onData);
  }

  watchHistory(companyUid: string, onData: (items: DashboardHistoryRow[]) => void): Unsubscribe {
    return this.watchScopedCollection('dashboard_history', companyUid, ['companyUid'], onData);
  }

  watchNotifications(companyUid: string, onData: (items: DashboardNotification[]) => void): Unsubscribe {
    return this.watchScopedCollection('dashboard_notifications', companyUid, ['companyUid'], onData);
  }

  watchBilling(companyUid: string, onData: (items: DashboardBillingRow[]) => void): Unsubscribe {
    return this.watchScopedCollection('dashboard_billing', companyUid, ['companyUid'], onData);
  }

  watchCompany(companyUid: string, onData: (item: DashboardCompanyProfile) => void): Unsubscribe {
    const normalizedCompanyUid = this.resolveCompanyUid(companyUid);

    if (!normalizedCompanyUid) {
      onData(EMPTY_COMPANY);
      return () => undefined;
    }

    const companyDoc = doc(db, 'dashboard_company_profiles', normalizedCompanyUid);

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

  async saveAlert(item: DashboardAlert, companyUid?: string) {
    const normalizedCompanyUid = this.resolveCompanyUid(companyUid);

    await setDoc(
      doc(db, 'dashboard_alerts', item.id),
      {
        ...item,
        ...(normalizedCompanyUid ? { companyUid: normalizedCompanyUid } : {}),
      },
      { merge: true }
    );
  }

  async patchAlert(id: string, patch: Partial<DashboardAlert>, companyUid?: string) {
    const normalizedCompanyUid = this.resolveCompanyUid(companyUid);

    await setDoc(
      doc(db, 'dashboard_alerts', id),
      {
        ...patch,
        ...(normalizedCompanyUid ? { companyUid: normalizedCompanyUid } : {}),
      },
      { merge: true }
    );
  }

  async saveAgent(item: DashboardAgent, companyUid?: string) {
    const normalizedCompanyUid = this.resolveCompanyUid(companyUid);

    await setDoc(
      doc(db, 'dashboard_agents', item.codigo),
      {
        ...item,
        ...(normalizedCompanyUid ? { companyUid: normalizedCompanyUid } : {}),
      },
      { merge: true }
    );
  }

  async patchAgent(codigo: string, patch: Partial<DashboardAgent>, companyUid?: string) {
    const normalizedCompanyUid = this.resolveCompanyUid(companyUid);

    await setDoc(
      doc(db, 'dashboard_agents', codigo),
      {
        ...patch,
        ...(normalizedCompanyUid ? { companyUid: normalizedCompanyUid } : {}),
      },
      { merge: true }
    );
  }

  async saveNotification(item: DashboardNotification, companyUid?: string) {
    const normalizedCompanyUid = this.resolveCompanyUid(companyUid);

    await setDoc(
      doc(db, 'dashboard_notifications', item.id),
      {
        ...item,
        ...(normalizedCompanyUid ? { companyUid: normalizedCompanyUid } : {}),
      },
      { merge: true }
    );
  }

  async saveAllNotifications(items: DashboardNotification[], companyUid?: string) {
    await Promise.all(items.map((item) => this.saveNotification(item, companyUid)));
  }

  async saveCompanyProfile(item: DashboardCompanyProfile, companyUid?: string) {
    const normalizedCompanyUid = this.resolveCompanyUid(companyUid);

    if (!normalizedCompanyUid) {
      return;
    }

    await setDoc(
      doc(db, 'dashboard_company_profiles', normalizedCompanyUid),
      {
        ...item,
        uid: normalizedCompanyUid,
      },
      { merge: true }
    );
  }

  private watchScopedCollection<T extends object>(
    collectionName: string,
    companyUid: string,
    fields: string[],
    onData: (items: T[]) => void
  ): Unsubscribe {
    const normalizedCompanyUid = this.resolveCompanyUid(companyUid);

    if (!normalizedCompanyUid) {
      onData([]);
      return () => undefined;
    }

    const snapshotsByField = new Map<string, Map<string, T>>();

    const emitItems = () => {
      const mergedItems = new Map<string, T>();

      snapshotsByField.forEach((itemsById) => {
        itemsById.forEach((item, id) => {
          mergedItems.set(id, item);
        });
      });

      const items = Array.from(mergedItems.values()).sort((a, b) => {
        const first = this.extractTimestamp(a);
        const second = this.extractTimestamp(b);
        return second.localeCompare(first);
      });

      onData(items);
    };

    const unsubscribes = [...new Set(fields)].map((field) =>
      onSnapshot(query(collection(db, collectionName), where(field, '==', normalizedCompanyUid)), (snapshot) => {
        const scopedItems = new Map<string, T>();

        snapshot.docs.forEach((item) => {
          const data = item.data() as T & { id?: string; codigo?: string };
          const itemId = String(data.id || data.codigo || item.id);
          scopedItems.set(itemId, data as T);
        });

        snapshotsByField.set(field, scopedItems);
        emitItems();
      })
    );

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }

  private extractTimestamp(item: object) {
    const record = item as Record<string, unknown>;
    const value = record['updatedAt'] ?? record['createdAt'] ?? record['hora'] ?? '';
    return String(value);
  }

  private resolveCompanyUid(companyUid?: string) {
    const normalizedCompanyUid = String(companyUid || '').trim();

    if (normalizedCompanyUid) {
      return normalizedCompanyUid;
    }

    const cachedUid = String(this.authService.getCachedProfile()?.uid || '').trim();

    if (cachedUid) {
      return cachedUid;
    }

    return String(auth.currentUser?.uid || '').trim();
  }
}
