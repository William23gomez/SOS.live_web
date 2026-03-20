# SOS Live Web

Monorepo con frontend Angular y backend Express/Firebase.

## Estructura

- `sos.live-frontend/`: app web Angular
- `backend/`: API Express con Firebase Admin

## Requisitos

- Node.js 22+
- npm
- Firebase configurado

## Configuracion

### Backend

1. Crear `backend/.env` con:

```env
PORT=3000
FRONTEND_URL=http://localhost:4200
FIREBASE_WEB_API_KEY=TU_WEB_API_KEY
```

2. Copiar la cuenta de servicio de Firebase a:

```text
backend/serviceAccountKey.json
```

### Frontend

La configuracion de Firebase cliente esta en:

```text
sos.live-frontend/src/app/core/firebase.config.ts
```

## Instalar dependencias

### Backend

```bash
cd backend
npm install
```

### Frontend

```bash
cd sos.live-frontend
npm install
```

## Ejecutar en desarrollo

Abre dos terminales.

### Terminal 1: backend

```bash
cd backend
npm run dev
```

Backend:

```text
http://localhost:3000
http://localhost:3000/api/health
```

### Terminal 2: frontend

```bash
cd sos.live-frontend
npm start
```

Frontend:

```text
http://localhost:4200
```

## Flujo de autenticacion

- El registro crea el usuario con Firebase Auth desde el frontend.
- El backend guarda el perfil en Firestore.
- El login valida correo verificado y carga perfil desde backend.
- El dashboard permite editar perfil, reenviar verificacion, cerrar sesion y eliminar cuenta.

## Notas

- `backend/.env` y `backend/serviceAccountKey.json` no se suben al repo.
- Si el dashboard tarda, primero puede mostrar datos cacheados y luego sincronizar con backend.
