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
- Login con rate limiter anti fuerza bruta: `includes/LoginRateLimiter.class.php`
  (tabla `login_attempts`). Bloquea la IP tras N fallos consecutivos con timeout
  escalonado. Configurable vía env LOGIN_MAX_ATTEMPTS / LOGIN_LOCK_BASE_SECONDS /
  LOGIN_LOCK_MAX_SECONDS / LOGIN_LOCK_MULTIPLIER. Responde 429 con header
  `Retry-After` cuando la IP está bloqueada.
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
6. Commitea con mensaje descriptivo **directo a `community-edition`** (ver abajo).

## Reglas de operación del repositorio — NO NEGOCIABLE

- **Trabaja SOLO en la branch `community-edition`.** `main` es producción de un
  cliente externo que está en uso: **no la toques** (ni merge, ni push, ni
  rebase, ni "alinear"). Confirmación humana explícita o nada.
- **Commit directo a `community-edition`.** No crees ramas de trabajo
  (`feature/*`, `fix/*`) ni abras PRs para trabajo normal. El repo debe quedarse
  con dos ramas: `community-edition` y `main`.
- **Nunca `--force`** sobre `community-edition`.
- **No hagas `push` sin autorización humana.** El repositorio publica la imagen
  Docker en cada push a `community-edition`.
- **No reinicies, recrees ni borres contenedores**, no toques volúmenes ni bases
  de datos, y no despliegues nada: de eso se encarga el orquestador. Tú cambias
  código y lo verificas en un espacio de trabajo local.
- Si el árbol de trabajo tiene cambios que no son tuyos, **no los commitees**.

## Vocabulario (usar SIEMPRE estas palabras, en pantallas y API)

| Concepto | Palabra | Nota |
|---|---|---|
| Dónde se atiende | **Punto de servicio** | Mesa 3, Barra 1, Habitación 12. Etiqueta libre |
| La cuenta abierta | **Cuenta** | |
| Quien consume | **Persona** | No "comensal" |
| La ronda que se prepara | **Comanda** | |
| Dónde se prepara | **Estación** | Cocina, Barra, Plancha |
| Cómo sale la comanda | **Salida** | Pantalla / impresora / ninguna |
| Ajustes del platillo | **Modificadores** | |

## Tiempo y fechas — el desfase que ya rompió cosas

El contenedor de la app va en **hora de México** y MariaDB en **UTC** (6 horas de
desfase). Nunca calcules en PHP un valor temporal que después se compare contra
la base: produce "cuentas vencidas" y "minutos en cero". Usa `NOW()`,
`CURDATE()` o `TIMESTAMPDIFF` de SQL.

Única excepción, y es deliberada: el **día de negocio** del folio de comanda se
toma de PHP (`date('Y-m-d')`), porque con `CURDATE()` el folio se reiniciaría a
las 18:00 locales, en plena cena.

## Dinero — un solo camino

Todo lo que mueve dinero pasa por `api/sales/create_sale.php` y
`includes/CashRegister.class.php`. Ninguna función nueva escribe ventas, pagos ni
movimientos de caja por su cuenta. Si necesitas una operación de dinero nueva,
**extiende ese camino**, no abras otro.

## Cómo probar sin tocar producción

- `bash docker/unit_tests.sh` — reglas de JS (existencias, promociones).
- `bash docker/test_*.sh <url>` — suites por módulo contra una instancia
  DESECHABLE (`http://127.0.0.1:8091` o la que te indiquen).
- **Nunca apuntes al dominio de producción**: las suites escriben datos.
- Las pruebas se fabrican sus propios datos (`ZZ ... $RANDOM`) y no dependen de
  un catálogo sembrado: una instalación limpia nace con cero productos.
- En aserciones, compara por **id o por contenido**, nunca por conteos absolutos:
  en una instancia con corridas previas los datos se acumulan.


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

## Verificación y pruebas — OBLIGATORIO

Una implementación no está terminada hasta que pase pruebas reales.

1. Ejecuta la suite base: `bash docker/test_suite.sh http://localhost:8091`.
2. Para cada módulo nuevo o modificado, crea/actualiza una prueba compuesta que cubra:
   - Camino exitoso y errores de validación.
   - Aislamiento multi-tienda (actor propio vs recurso de otra tienda).
   - Persistencia: crear → leer → actualizar → volver a leer → limpiar.
   - Permisos: sesión, roles y scopes de token aplicables.
3. Para UI interactiva, prueba con navegador headless al menos:
   - Desktop (mouse/teclado).
   - Móvil/touch cuando el flujo lo soporte.
   - Captura visual cuando cambie un layout relevante.
4. Si alguna prueba falla, itera hasta corregirla. No declares la tarea terminada con fallos conocidos.
5. Las pruebas que creen datos deben limpiar todo con `trap` o teardown, incluso ante error.

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

### Preferencias del dueño (aprendidas a golpe de corrección) — NO NEGOCIABLE

Estas no son "buenas prácticas": son correcciones que ya se hicieron una vez y no
deben volver a aparecer.

1. **Botones, no `<select>`.** Para cualquier elección corta (método de pago, tipo
   de inventario, modo de consumo, estación) se usa un grupo de botones tipo
   toggle (`.pm-btn` / `.tp-btn` con `.active` + `data-value`) y su valor se lee y
   se escribe con helpers. Un `<select>` se ve como un formulario de 2005 y en
   tableta es incómodo.
2. **Nada de `alert()`, `confirm()` ni `prompt()`.** Ni siquiera para confirmar
   algo destructivo: se usa un modal propio del sistema, con título, explicación
   de qué va a pasar y el botón en rojo. Si ya hay un modal abierto, la
   confirmación se abre ENCIMA de ese (es una decisión, no navegación).
3. **Un clic = una acción.** Agregar un elemento al pedido no puede abrir un
   formulario: un toque agrega una pieza y otro toque agrega otra. **Nunca abras
   un modal cuando ya hay un modal abierto**, salvo la confirmación del punto 2.
4. **Lo que es por elemento se edita por elemento.** Las notas, la cantidad y las
   anotaciones de un platillo viven en SU línea/ficha, no en un campo general de
   la cuenta. El "sin cebolla" de uno no puede caerle al de al lado.
5. **Pestañas dentro de la página, no páginas nuevas.** Si algo es una subsección
   de un módulo existente (compras dentro de inventario, comandas dentro del
   salón), va como pestaña en esa página y **no** como entrada nueva en el menú
   lateral.
6. **Área táctil de 40 px mínimo y nada que dependa de `hover`** como único
   acceso: se usa en tabletas y con las manos ocupadas.
7. **En móvil, tarjetas.** No tablas colapsadas, no grillas apretadas, no campos
   sin estilar. Etiqueta + valor legibles.
8. **Colores solo con variables del tema** (`--primary-color`, `--bg-card`,
   `--border-color`, `--text-muted`, `--danger-color`...). Nada de hex sueltos:
   el claro y el oscuro ya están derivados y un color fijo rompe uno de los dos.
9. **El total y lo que se está pidiendo SIEMPRE visibles.** Nunca detrás de una
   pestaña, un acordeón o un paso extra.
10. **Sin selects ni campos sin estilo** en el POS, y los modales compactos con
    tarjetas en móvil.
11. **El catálogo de elementos es la ley visual.** Antes de crear o rediseñar una
    vista, abrir `public/design-system.html` (el catálogo vivo) y
    `public/css/design-system.css` (la fuente única de estructura: tipografía
    Sora/Inter, botones cápsula, radios `--ds-radius-*`, sombras `--ds-shadow-*`,
    texturas SVG de fondo, escala de capas z-index). **Reutiliza las clases reales
    ya documentadas ahí** (`.btn` + `.btn-solid/.btn-outline/.btn-soft/.btn-ghost`,
    `.field`/`.flabel`, `.ds-input`, `.input-wrap`, `.badge`, `.card`) en lugar de
    inventar estilos nuevos. Si algo no existe en el catálogo, se añade AL catálogo
    y a su CSS, no se improvisa en la página.
12. **Contadores de tiempo en minutos y segundos** (`mm:ss`), no solo minutos. En
    cocina el minutero es una herramienta de trabajo, no un adorno: debe verse de
    un vistazo, con la cifra en cifras tabulares para que no baile.
13. **Lo que no le sirve a quien opera, fuera de la pantalla.** En la vista de
    cocina no se muestran códigos de cuenta, ni quién la anotó, ni párrafos
    explicativos: eso va a un `title`/tooltip o no va. La pantalla de trabajo se
    diseña para leerse a un metro de distancia y con las manos ocupadas.
14. **Agrupar sin perder el detalle por pieza.** Pedir tres piezas del mismo
    platillo se ve como **una sola tarjeta con "3×"**, y cada pieza conserva su
    anotación individual ("1 sin cebolla", "1 sin pepinillos", "1 completa"). Agrupar
    es una decisión de la VISTA: no se pierde ni se mezcla la nota de cada pieza.
15. **Repintar solo lo que cambió.** Al agregar, anotar o quitar una pieza no se
    vuelve a dibujar la lista completa: se actualiza únicamente la tarjeta afectada
    (y los totales). Con cuentas grandes, repintar todo se siente como esperar.
16. **Menos botones, más intención.** Las acciones secundarias de una pantalla se
    agrupan en un menú de tres puntos (`...`), no en una fila de botones. Un
    indicador de estado no lleva párrafo al lado: es un punto de color con tooltip.

