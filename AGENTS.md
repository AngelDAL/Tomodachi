# AGENTS.md — Guía para agentes de IA que trabajen en Tomodachi POS

Este documento define cómo trabajar en este repositorio. Léelo completo antes
de modificar código. Está pensado para cualquier agente (Codex, Claude Code,
Hermes, Cursor, etc.).

## Qué es este proyecto

Tomodachi POS es un sistema de Punto de Venta web, open source (Apache 2.0),
self-hosted. Stack: **PHP 8.x puro (sin frameworks) + MySQL/MariaDB + HTML/CSS/JS
vanilla**. API REST consumida con fetch.

Esta branch es `community-edition` (CE): **todas las funciones desbloqueadas,
sin cobros, apta para que cualquiera la instale con Docker**.

## Reglas de oro (NO las rompas)

1. **Aislamiento multi-tienda es sagrado.** Todo endpoint debe operar sobre la
   tienda de la sesión (`$_SESSION['store_id']` / `$auth->getCurrentUser()['store_id']`).
   Nunca confíes en `store_id` que venga del request sin validarlo contra la sesión.
   Si un usuario pide otra tienda → `403`.
2. **Prepared statements SIEMPRE.** La capa `Database.class.php` (PDO) ya los
   usa. Nunca concatenes SQL con input del usuario.
3. **No rompas el frontend.** El JS llama a estos endpoints con rutas relativas
   (`../api/...`). Si cambias una respuesta, revisa `public/js/*.js`.
4. **No subas secretos.** `config/database.php`, `config/mail.php`,
   `api/ai/config.php` están en `.gitignore` — nunca los commitees.
5. **Cambia la contraseña por defecto** (`admin/admin123`) en cualquier
   despliegue de producción.

## Estructura

```
api/           Endpoints REST (uno por archivo, organizados por módulo)
includes/      Clases compartidas: Auth, Database, Mail, Response, Validator
config/        constants.php (constantes + APP_MODE), database.php, mail.php
database/      schema.sql (esquema completo + seed inicial) y migrations/
public/        Frontend: HTML por vista + public/js/*.js + assets
docs/          API.md (referencia completa de endpoints), TEST_REPORT.md
docker/        Dockerfile, docker-compose.yml, entrypoint.sh
```

## Convenciones de código

- PHP sin frameworks, clases en `includes/`, endpoints delgados en `api/`.
- Cada endpoint: require de config/constants + clases, valida método HTTP,
  auth, datos, ejecuta, responde con `Response::success/error`.
- Respuestas JSON: `{"success": bool, "data": ..., "message": ..., "errors": ...}`.
- Constantes en `config/constants.php` (roles, estados, planes).
- Validación con `Validator.class.php`; sanitiza strings con
  `Validator::sanitizeString`.
- SQL: tablas en español/inglés mixto, prefijo consistente (`store_id`,
  `product_id`, `sale_id`...).

## Flujo de trabajo recomendado

1. Lee `docs/API.md` antes de tocar endpoints.
2. Reproduce el bug o feature con Docker:
   ```bash
   docker compose up -d --build   # o PORT=XXXX docker compose up -d
   ```
   App en `http://localhost:8080`, credenciales `admin/admin123`.
3. Cambia el código, prueba con curl (login → cookie → endpoint).
4. Si tocas SQL: modifica `database/schema.sql` (fuente de verdad) y añade
   migración numerada en `database/migrations/` solo si es necesario para BDs
   existentes.
5. Documenta endpoints nuevos en `docs/API.md`.
6. Commitea con mensaje descriptivo; esta branch se mergea vía PR.

## Seguridad — checklist al añadir un endpoint

- [ ] ¿Requiere login? (`$auth->isLoggedIn()` o `isset($_SESSION['user_id'])`)
- [ ] ¿Opera sobre la tienda de la sesión? (validar `store_id` contra sesión)
- [ ] ¿Roles correctos? (`hasRole([...])`)
- [ ] ¿Prepared statements? (nunca concatenar)
- [ ] ¿Validación de inputs? (`Validator`, tipos, rangos)
- [ ] ¿Documentado en `docs/API.md`?

## Lo que NO se hace en CE

- **Funciones de IA propietarias** (`api/ai/*`): deshabilitadas (403 en
  OPEN_SOURCE). No las reactives ni dependas de ellas.
- **Comandos de voz** (VoiceCommander): eliminados del alcance CE.
- La filosofía: los agentes integran vía **API documentada + API tokens**
  (`api/api_tokens/*`, header `Authorization: Bearer td_...`). Un agente con
  scope `custom` puede personalizar el tema (`api/stores/theme.php`), con
  `read` leer datos, con `write` modificar. Los tokens se gestionan desde
  el panel Integraciones o los endpoints CRUD; cada uno pertenece a una
  tienda y puede expirar o revocarse.

## Datos de prueba

`schema.sql` incluye seed inicial: tienda 1 "Tienda Principal", usuario
`admin/admin123`, 4 categorías, 6 productos. `SEED_DEMO=true` (default) añade
datos demo adicionales al primer arranque (ver docker/entrypoint.sh).
