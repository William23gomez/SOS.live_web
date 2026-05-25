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
BACKEND_PORT=3000
FRONTEND_URL=http://localhost:4200
PUBLIC_APP_URL=https://soslive-f7513.web.app
APP_FIREBASE_WEB_API_KEY=TU_WEB_API_KEY
MERCADO_PAGO_ACCESS_TOKEN=APP_USR_o_TEST_tu_access_token
MERCADO_PAGO_REDIRECT_URL=https://tu-frontend-publico.com/pagos
MERCADO_PAGO_NOTIFICATION_URL=https://tu-backend-publico.com/api/payments/mercadopago/events
```

2. Si corres local con cuenta de servicio, agrega tambien:

```env
APP_FIREBASE_PROJECT_ID=soslive-f7513
APP_FIREBASE_PRIVATE_KEY_ID=tu_private_key_id
APP_FIREBASE_PRIVATE_KEY=tu_private_key
APP_FIREBASE_CLIENT_EMAIL=tu_client_email
APP_FIREBASE_CLIENT_ID=tu_client_id
APP_FIREBASE_CLIENT_X509_CERT_URL=tu_client_x509_cert_url
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

## Pagos

- La ruta `/pagos` crea checkouts de Mercado Pago para tarjeta debito, tarjeta credito y PSE.
- Para pagos reales configura `MERCADO_PAGO_ACCESS_TOKEN` con el access token de tu cuenta vendedora.
- Mercado Pago requiere URLs publicas con HTTPS para retornos y notificaciones; usa `MERCADO_PAGO_REDIRECT_URL` y `MERCADO_PAGO_NOTIFICATION_URL` en produccion.

## Notas

- `backend/.env` y `backend/serviceAccountKey.json` no se suben al repo.
- Si el dashboard tarda, primero puede mostrar datos cacheados y luego sincronizar con backend.

## Firebase Hosting y backend publico

El proyecto ya incluye:

- `.firebaserc` con el proyecto `soslive-f7513`
- `firebase.json` con rewrite SPA hacia `index.html`
- `firebase.json` preparado para publicar `backend/` como Cloud Function `api`
- Ruta Angular `/email-verified` para procesar enlaces de verificaci\u00f3n

Para publicar frontend + backend publico:

```bash
cd backend
npm install
cd sos.live-frontend
npm run build
cd ..
firebase deploy --only functions,hosting
```
