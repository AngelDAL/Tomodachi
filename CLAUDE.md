# CLAUDE.md — Guía rápida para Claude Code (y agentes similares)

Proyecto: **Tomodachi POS — Community Edition**. POS web self-hosted.
PHP 8 puro + MySQL/MariaDB + JS vanilla. Sin frameworks. Apache 2.0.

## Comandos

```bash
# Levantar el stack (puerto por defecto 8080, o PORT=8091 docker compose up -d)
docker compose up -d --build

# Pruebas manuales
curl -c /tmp/cj -X POST http://localhost:8080/api/auth/login.php \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
curl -b /tmp/cj http://localhost:8080/api/reports/dashboard_stats.php
```

## Antes de tocar código

1. Lee `AGENTS.md` (reglas de oro) y `docs/API.md` (referencia endpoints).
2. La regla #1 es el aislamiento multi-tienda: nunca confíes en `store_id`
   del request sin validarlo contra la sesión → 403 si no coincide.
3. Prepared statements siempre (PDO en `includes/Database.class.php`).
4. No rompas el frontend: `public/js/*.js` usa rutas relativas `../api/...`.

## Arquitectura en 30 segundos

- `api/<modulo>/<accion>.php` → endpoint REST delgado (valida método, auth,
  datos, ejecuta, responde JSON).
- `includes/` → Auth, Database, Mail, Response, Validator.
- `config/constants.php` → constantes + `APP_MODE` (OPEN_SOURCE default).
- `database/schema.sql` → fuente de verdad del esquema + seed inicial.
- `docker/entrypoint.sh` → genera `config/database.php` desde env, importa
  schema si BD vacía, aplica `SEED_DEMO` (default true).

## Alcance CE (NO tocar/desarrollar)

- `api/ai/*` → deshabilitado (403 en OPEN_SOURCE). No reactivar.
- Comandos de voz / VoiceCommander → eliminado del alcance.
- No subir secretos: `config/database.php`, `config/mail.php`,
  `api/ai/config.php` están en `.gitignore`.

## Integraciones con agentes (API tokens)

- Los agentes se autentican con `Authorization: Bearer td_...`
  (clase `includes/ApiAuth.class.php`, middleware `getActor()`).
- Scopes: `read` (leer), `write` (modificar), `custom` (personalizar tema).
- CRUD: `api/api_tokens/{create,read,revoke}.php` (solo admin, por sesión).
- Personalizar tema: `POST /api/stores/theme.php` con scope `custom`
  (exclusivo: un token solo-write NO puede tocar el tema).
- Panel web: `public/integrations.html` (en el sidebar).

## Flujo

Reproduce con Docker → cambia → prueba con curl (login + cookie) →
documenta en `docs/API.md` si añades endpoints → commit con mensaje claro.
