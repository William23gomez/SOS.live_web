# SOS Live Backend

Base backend en Express para autenticacion con Firebase Admin y Firestore.

## Estructura

- `src/controllers`: logica de entrada y salida HTTP
- `src/services`: reglas de negocio
- `src/routes`: rutas de la API
- `src/middlewares`: autenticacion y manejo de errores
- `src/config`: variables de entorno

## Endpoints

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/verify-session`
- `GET /api/auth/profile`

## Inicio rapido

1. Crear `.env` basado en `.env.example`
2. Instalar dependencias con `npm install`
3. Ejecutar en desarrollo con `npm run dev`

## Importante

El registro crea usuarios en Firebase Auth y guarda su perfil en Firestore.
El login con correo y contrasena debe hacerse en el frontend con Firebase Auth.
Despues de iniciar sesion, el frontend debe enviar el `idToken` a `/api/auth/verify-session` o usarlo en `Authorization: Bearer <token>` para `/api/auth/profile`.
