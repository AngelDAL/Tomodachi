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

## Autenticación en endpoints (sesión O token) — OBLIGATORIO

Todo endpoint nuevo DEBE aceptar sesión de navegador Y API token
(`Authorization: Bearer`). Usa el patrón `ApiAuth` (NO solo `Auth`):

```php
require_once '../../includes/ApiAuth.class.php';

$db = new Database();
$auth = new Auth($db);
$apiAuth = new ApiAuth($db);
$actor = $apiAuth->requireActor($auth);   // 401 si no hay sesión ni token
$store_id = $actor['store_id'];           // SIEMPRE usar esto, nunca $_SESSION directo

// Método GET -> scope read; POST/PUT/DELETE -> scope write
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $apiAuth->requireScope($actor, 'read');
} else {
    if ($actor['via'] === 'session') {
        // checar rol de sesión como antes (hasRole / role)
    } else {
        $apiAuth->requireScope($actor, 'write');   // 403 si el token no tiene write
    }
}
```

- `getActor()` devuelve `['store_id', 'user_id', 'via' => 'session'|'token', 'scopes', 'role']`.
- Con token, `role` es `null` y `user_id` es el admin de la tienda
  (atribución). NO uses `$currentUser['role']` sin checar `via === 'session'`.
- GET exige `read`; escritura exige `write`; el tema exige `custom` (POST).
- Endpoints SOLO sesión (no cablear tokens): `auth/*`, `super_admin/*`,
  `users/create|update|delete|profile`, `stores/create|import_data|upload_logo|save_background`,
  `terminals/*`, `ai/*`, `sales/cart_sync.php`, `inventory/upload_image.php`.

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
  scope `custom` puede personalizar el tema (`api/stores/theme.php`, scope
  exclusivo), con `read` leer datos, con `write` modificar. Los tokens se
  gestionan desde el panel Integraciones o los endpoints CRUD; cada uno
  pertenece a una tienda y puede expirar o revocarse.

## Datos de prueba

`schema.sql` incluye seed inicial: tienda 1 "Tienda Principal", usuario
`admin/admin123`, 4 categorías, 6 productos. `SEED_DEMO=true` (default) añade
datos demo adicionales al primer arranque (ver docker/entrypoint.sh).

## Lineamientos de UI/UX — OBLIGATORIO

**NUNCA uses esto en el frontend:**
- ❌ `alert()` — bloquea el hilo y es intrusivo
- ❌ `confirm()` — bloquea el hilo y es intrusivo
- ❌ Emojis en texto (🎉 🚀 ✅ ❌ etc.) — no son profesionales

**EN SU LUGAR usa:**
- ✅ Iconos FontAwesome (`<i class="fas fa-check"></i>`)
- ✅ Sistema de notificaciones personalizado (toast/alerts del proyecto)
- ✅ Modales personalizados (`<dialog>` o componentes custom)
- ✅ `window.tomodachi?.notify()` si existe, o crea un toast simple

**Ejemplo de notificación no-bloqueante:**
```javascript
function showNotification(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `notification notification-${type}`;
    toast.innerHTML = `<i class="fas fa-${type === 'success' ? 'check' : 'exclamation-triangle'}"></i> ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// En lugar de confirm():
function confirmAction(message, callback) {
    // Usar modal personalizado o crear uno
    const modal = document.createElement('dialog');
    modal.innerHTML = `
        <div class="confirm-dialog">
            <p>${message}</p>
            <button class="btn-confirm">Confirmar</button>
            <button class="btn-cancel">Cancelar</button>
        </div>
    `;
    document.body.appendChild(modal);
    modal.showModal();
    
    modal.querySelector('.btn-confirm').onclick = () => {
        callback();
        modal.close();
        modal.remove();
    };
    modal.querySelector('.btn-cancel').onclick = () => {
        modal.close();
        modal.remove();
    };
}
```

**Botones:**
- Acción principal: "Crear", "Guardar", "Actualizar" (NO "OK", "Sí")
- Acción destructiva: "Eliminar" (con confirmación via modal)
- Cancelar: "Cancelar" (siempre disponible)

**Textos en español:**
- Usa acentos correctamente (menú, no menu)
- Ortografía profesional
- Sin emojis en labels, placeholders, ni mensajes
