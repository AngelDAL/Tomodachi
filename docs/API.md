# Tomodachi POS — API Reference v1.0 (Community Edition)

> Fecha de auditoría: 2026-08-20 · Rama: `community-edition` · Stack: PHP 8.2 + MariaDB sin frameworks.
> Base URL: `https://tomodachi.tabtap.dev` (o tu host). Ruta de ejemplo: `/api/inventory/products.php`.

Este documento es la **referencia operativa** de la API para integrar aplicaciones
y para que un agente de IA controle el sistema. Cubre los **91 endpoints funcionales**
de la Community Edition. Los endpoints de `api/ai/*` (5) están **deshabilitados** en esta
edición (responden 403) y se documentan aparte.

---

## 1. Cómo empezar (para agentes e integraciones)

1. **Login** para obtener cookie de sesión:
   ```bash
   curl -c /tmp/cj -X POST ${BASE}/api/auth/login.php \
     -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"admin123"}'
   ```
2. Usa la cookie (`-b /tmp/cj`) o un **API token** (`Authorization: Bearer <token>`).
   Los tokens se crean desde `api/api_tokens/create.php` o el panel Integraciones.
3. Respuesta estándar:
   ```json
   {"success": true, "message": "...", "data": {...}, "error": null}
   ```
   Errores: `success:false`, `error` con detalle. Códigos: 200 OK · 201 · 400 validación ·
   401 no auth · 403 sin permisos · 404 no existe · 405 método · 409 conflicto · 422 validación ·
   429 rate-limit · 500 servidor.
4. **Aislamiento multi-tienda:** el backend SIEMPRE usa el `store_id` de la sesión/token.
   Si pasas un `store_id` ajeno → 403. Un agente nunca debe confiar en `store_id` del request.

## 2. Autenticación

- **Sesión de navegador**: `POST /api/auth/login.php` → cookie `tomodachi_session` (httponly).
- **API token (para agentes/IA)**: header `Authorization: Bearer <token>` (clase `ApiAuth`).
  Cada token pertenece a UNA tienda y tiene scopes. Se muestra UNA sola vez al crearlo.
- **Scopes por método**: `GET`→`read` · `POST/PUT/DELETE`→`write` · `custom` (solo tema).
- Endpoints **solo sesión** (no admiten token): `auth/*`, `users/create|update|delete|profile`,
  `stores/create|import_data|upload_logo|save_background`, `terminals/*`, `super_admin/*`,
  `ai/*`, `sales/cart_sync.php`, `inventory/upload_image.php`.
- **Rate limiter de login**: `login.php` bloquea la IP por 60s (escalando ×5, tope 2h) tras
  5 fallos consecutivos → `429` con header `Retry-After`. Configurable por env `LOGIN_*`.

## 3. Formato regional / config

La tienda puede configurar moneda, fechas y números (Perfil → Empresa → Formato Regional).
Los inputs de fecha SIEMPRE usan ISO en la API, independientemente del formato de display.

---

## 4. Endpoints por módulo

### 4.1 Autenticación

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `api/auth/login.php` | Iniciar sesión | público (rate-limited) |
| POST | `api/auth/logout.php` | Cerrar sesión | público |
| GET | `api/auth/verify_session.php` | Verificar sesión activa | público |
| GET | `api/auth/permissions.php` | Plan/perfiles (APP_MODE) | público |
| POST | `api/auth/register.php` | Registrar tienda nueva | público (si habilitado) |
| POST | `api/auth/forgot_password.php` | Solicitar reset | público |
| POST | `api/auth/reset_password.php` | Aplicar reset (token) | público |

- `login`: `{username, password, remember?}` → devuelve `data.user`.
- `register`: `{store_name, store_phone?, full_name, username, email, password, user_phone?}`.

### 4.2 API Tokens / Integraciones

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `api/api_tokens/create.php` | Crear token (key UNA vez) | sesión admin |
| GET | `api/api_tokens/read.php` | Listar tokens (sin key) | sesión admin |
| POST | `api/api_tokens/revoke.php` | Revocar token | sesión admin |

- `create`: `{name, scopes:[read\|write\|custom], expires_in_days?}` → `data.token` (guárdalo).
- `revoke`: `{token_id}`.

### 4.3 Cajas (Cash Register)

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `api/cash_register/open_register.php` | Abrir caja | sesión/token write |
| POST | `api/cash_register/close_register.php` | Cerrar caja (arqueo) | sesión/token write |
| GET | `api/cash_register/current_register.php` | Caja abierta actual | sesión/token read |
| GET | `api/cash_register/get_movements.php` | Movimientos de caja | sesión/token read |
| POST | `api/cash_register/cash_movements.php` | Entrada/salida de efectivo | sesión/token write |

- `open`: `{store_id, initial_amount, terminal_id?}`.
- `close`: `{register_id, counted_amount, notes?, denominations?}` (denominations = arqueo).
- `cash_movements`: `{register_id?|store_id?, movement_type: entry|withdrawal, amount, description?}`.

### 4.4 Clientes / Fiado

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| GET/POST/PUT/DELETE | `api/customers/customers.php` | CRUD de clientes | sesión/token |
| POST | `api/customers/payments.php` | Abonar al apartado | sesión/token write |

- `customers`: GET query `id?|search?|status?|balance?`; POST `{full_name, phone, email?, address?, credit_limit?, notes?}`.
  Devuelve saldo, límite y últimas ventas/abonos. Venta tipo `credit` incrementa `balance`.
- `payments`: `{customer_id, amount, payment_method?: cash|card|transfer, notes?}` → reduce balance y registra caja si es efectivo.

### 4.5 Inventario

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| GET/POST/PUT/DELETE | `api/inventory/products.php` | CRUD productos | sesión/token |
| GET/POST/PUT/DELETE | `api/inventory/categories.php` | CRUD categorías | sesión/token |
| POST | `api/inventory/stock.php` | Ajustar stock | sesión/token write |
| GET | `api/inventory/scanner.php` | Buscar por código/barras | sesión/token read |
| POST | `api/inventory/upload_image.php` | Subir imagen producto | solo sesión |

- `products`: GET query `store_id?|search?`; POST `{product_name, price, cost?, category_id?, barcode?, qr_code?, stock?, min_stock?, is_bulk?, bulk_unit?, description?}`.
- `stock`: `{product_id, movement_type: entry|exit|adjustment, quantity, notes?}`.
- `scanner`: query `code|barcode, store_id?`.
- `upload_image`: `{product_id, image_base64}` (data URL) o multipart.

### 4.6 Promociones

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `api/promotions/create.php` | Crear promoción | sesión/token write |
| GET | `api/promotions/read.php` | Listar promociones | sesión/token read |
| POST | `api/promotions/update.php` | Actualizar promoción | sesión/token write |
| POST | `api/promotions/delete.php` | Eliminar promoción | sesión/token write |

- `create`/`update`: `{name, type: simple_discount|bulk_discount|bundle|bill_discount, discount_type: percentage|fixed_amount|fixed_price, discount_value, start_date, end_date, description?, min_purchase_amount?, min_quantity?, bundle_price?, targets?}`.

### 4.7 Reportes

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| GET | `api/reports/dashboard_stats.php` | Estadísticas del dashboard | sesión/token read |
| GET | `api/reports/get_chart_data.php` | Datos de gráficas | sesión/token read |
| GET | `api/reports/close_z.php` | Cierre Z / auditoría diaria | sesión/token read |

- `dashboard_stats`: query `type?|start_date?|end_date?` → ventas, ganancia, transacciones, valor inventario, top productos.
- `close_z`: query `date?|register_id?` → ventas por método, cancelaciones, devoluciones, movimientos de caja, efectivo esperado.

### 4.8 Ventas

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `api/sales/create_sale.php` | Crear venta | sesión/token write |
| GET | `api/sales/get_sales.php` | Listar ventas | sesión/token read |
| GET | `api/sales/sale_details.php` | Detalle de venta | sesión/token read |
| POST | `api/sales/cancel_sale.php` | Cancelar venta | admin/manager write |
| POST | `api/sales/refund_sale.php` | Devolución parcial | admin/manager write |
| POST/GET/DELETE | `api/sales/cart_sync.php` | Sincronizar carrito (UUID) | solo sesión |
| GET | `api/sales/cart_sse.php` | SSE del carrito (display) | público (UUID=llave) |

- `create_sale`: `{store_id, items:[{product_id, quantity}], payment_method: cash|card|transfer|mixed|credit, cash_amount?, discount?, tax?, customer_id?, amount_paid?, register_id?}`.
  **Los precios se recalculan en el servidor** (ignora el `price` del cliente). Devuelve `data.sale_id`.
  Con `payment_method=credit` + `customer_id` + `amount_paid` registra apartado (validación de límite → 409).
- `get_sales`: query `store_id?|date?`.
- `sale_details`: query `sale_id` → incluye `customer_name` y `created_via` (session|token).
- `cancel_sale`: `{sale_id}` → devuelve stock.
- `refund_sale`: `{sale_id, items:[{product_id, quantity}], reason?}` → reingresa stock y registra devolución (parcial acumulable).

### 4.9 Tiendas / Configuración

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| GET | `api/stores/read.php` | Listar tiendas | sesión/token read |
| POST | `api/stores/create.php` | Crear tienda | solo sesión admin |
| PUT | `api/stores/update.php` | Actualizar tienda propia | sesión/token write |
| GET/POST | `api/stores/settings.php` | Leer/guardar settings | sesión/token |
| GET/POST | `api/stores/theme.php` | Leer/modificar tema | sesión/token (custom) |
| POST | `api/stores/import_data.php` | Importar productos | solo sesión admin |
| POST | `api/stores/upload_logo.php` | Subir logo | solo sesión admin |
| POST | `api/stores/save_background.php` | Guardar fondo | solo sesión (IA off en CE) |

- `theme`: `POST {theme_config: {"primary_color":"#E3057A",...}}` requiere scope **custom** (un token write NO puede). GET requiere read.

### 4.10 Usuarios

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| GET | `api/users/read.php` | Listar usuarios (SuperAdmin ve todos) | sesión/token read |
| POST | `api/users/create.php` | Crear usuario | solo sesión admin |
| PUT | `api/users/update.php` | Actualizar usuario | solo sesión admin |
| POST | `api/users/delete.php` | Desactivar usuario | solo sesión admin |
| GET/PUT | `api/users/profile.php` | Perfil propio | solo sesión |
| POST | `api/users/complete_onboarding.php` | Reclamar la única bienvenida global de la tienda | solo sesión admin |

- Roles: `super_admin`, `admin`, `manager`, `cashier`. Un admin normal que consulte `users/read`
  sin ser super_admin recibe **403** (esperado).

### 4.11 Terminales

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| GET | `api/terminals/read.php` | Listar terminales | solo sesión |
| POST | `api/terminals/create.php` | Crear terminal | solo sesión |
| POST | `api/terminals/delete.php` | Desactivar terminal | solo sesión |

### 4.12 Push

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| GET | `api/push/public_key.php` | Clave pública VAPID | público |
| POST | `api/push/subscribe.php` | Suscribir dispositivo | sesión/token write |
| POST | `api/push/unsubscribe.php` | Desuscribir | sesión/token write |
| POST | `api/push/send.php` | Enviar notificación | admin/manager write |

- `subscribe`: `{endpoint, p256dh, auth, device_name?}` · `send`: `{title, body, url?}`.

### 4.13 Pantallas Digitales — Boards

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `api/digital_boards/create.php` | Crear board | sesión/token write |
| GET | `api/digital_boards/read.php` | Listar boards | sesión/token read |
| GET | `api/digital_boards/get_board.php` | Board completo (slides+elementos) | sesión/token read |
| PUT | `api/digital_boards/update.php` | Actualizar board | sesión/token write |
| POST | `api/digital_boards/delete.php` | Eliminar board | sesión/token write |
| POST | `api/digital_boards/upload_media.php` | Subir medio (imagen) | sesión/token write |
| GET | `api/digital_boards/list_media.php` | Listar medios | sesión/token read |
| GET | `api/digital_boards/auto_activate.php` | Activación por fecha (cron/CLI) | CLI/cron |

- `create`: `{name, orientation?, slide_duration?, transition_animation?, scheduled_start?, scheduled_end?, description?, is_active?, theme_config?, template?, show_qr?}`.
- `get_board`: query `board_id`.
- `upload_media`: `{image_base64, original_name?, tags?}` (se comprime en servidor, hasta 100MB).

### 4.14 Pantallas Digitales — Slides y Elementos

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `api/board_slides/create.php` | Crear slide | sesión/token write |
| GET | `api/board_slides/read.php` | Leer slides de board | sesión/token read |
| PUT | `api/board_slides/update.php` | Actualizar slide | sesión/token write |
| PUT | `api/board_slides/reorder.php` | Reordenar slides | sesión/token write |
| POST | `api/board_slides/delete.php` | Eliminar slide | sesión/token write |
| POST | `api/board_slide_assignments/assign.php` | Asignar slide maestra | sesión/token write |
| GET | `api/board_slide_assignments/read.php` | Leer asignaciones | sesión/token read |
| POST | `api/board_slide_assignments/remove.php` | Quitar asignación | sesión/token write |
| PUT | `api/board_slide_assignments/reorder.php` | Reordenar asignaciones | sesión/token write |
| POST | `api/slide_elements/create.php` | Crear elemento de slide | sesión/token write |
| GET | `api/slide_elements/read.php` | Leer elementos de slide | sesión/token read |
| PUT | `api/slide_elements/update.php` | Actualizar elemento | sesión/token write |
| POST | `api/slide_elements/delete.php` | Eliminar elemento | sesión/token write |
| GET | `api/slide_library/read.php` | Biblioteca de slides reutilizables | sesión/token read |

- `board_slides/create`: `{board_id, grid_cols?, grid_rows?, title?, enter_animation?, exit_animation?, custom_duration?, background_color?, background_image?}`.
- `board_slides/update`: `{slide_id, title?, grid_cols?, grid_rows?, custom_duration?, orientation?, layout_width?, layout_height?, ...}`.
- `slide_elements/create`: `{slide_id, element_type: product_card|image|text|category_grid|banner|clock, content, grid_col?, grid_row?, col_span?, row_span?, animation?, animation_delay?, z_index?}`.
- `slide_library/read`: slides maestras que pueden reutilizarse entre boards.

### 4.15 Pantallas Digitales — Grupos / Escenas (multipantalla)

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `api/display_groups/create.php` | Crear grupo (escena) | sesión/token write |
| GET | `api/display_groups/read.php` | Listar grupos | sesión/token read |
| GET | `api/display_groups/read_full.php` | Grupo completo (layout+slides) | sesión/token read |
| GET | `api/display_groups/get_group.php` | Grupo público para display | público (group_id) |
| PUT | `api/display_groups/update.php` | Actualizar grupo | sesión/token write |
| POST | `api/display_groups/delete.php` | Eliminar grupo | sesión/token write |
| POST | `api/display_groups/duplicate.php` | Duplicar grupo | sesión/token write |
| PUT | `api/display_groups/save_layout.php` | Guardar layout de pantallas | sesión/token write |
| PUT | `api/display_groups/save_screen_slides.php` | Guardar slides por pantalla | sesión/token write |
| POST | `api/display_groups/save_steps.php` | Guardar secuencia de pasadas | sesión/token write |

- `create`: `{name, bg_color?, screens?:[{label?, pos_x?, pos_y?, w_pct?, h_pct?, orientation?}]}`.
- `save_layout`: `{group_id, screens:[{id?, label, pos_x, pos_y, w_pct, h_pct, orientation}]}` (reemplaza el set).
- `save_screen_slides`: `{screen_id, slides:[{source_slide_id, custom_duration?, transition?}]}`.
- `save_steps`: `{group_id, steps:[{step_order, screen_id, source_slide_id, custom_duration?}]}`.

### 4.16 Super Admin / Soporte

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `api/super_admin/create_backup.php` | Backup de BD | sesión super admin |
| POST | `api/support/send_message.php` | Formulario de contacto | público (rate-limit 5/h) |

---

## 5. IA (deshabilitada en Community Edition)

Los 5 endpoints `api/ai/*` (`analyze_image`, `generate_image`, `remove_background`,
`replace_background`, `generate_background`) responden **403** cuando `APP_MODE=OPEN_SOURCE`.
No usarlos ni depender de ellos en CE.

## 6. Códigos de error y buenas prácticas

| Código | Significado |
|---|---|
| 200 / 201 | OK / creado |
| 401 | No autenticado (o token inválido/revocado) |
| 403 | Sin permisos / recurso de otra tienda / scope insuficiente |
| 404 | No existe |
| 405 | Método no permitido |
| 409 | Conflicto (p. ej. límite de crédito excedido) |
| 422 | Error de validación (`error` trae el campo) |
| 429 | Rate-limit (login / soporte) |
| 500 | Error de servidor |

Buenas prácticas:
1. Login primero y reutiliza la cookie, o usa un token con scopes mínimos.
2. Respeta el multi-tienda: usa tu `store_id`, nunca pidas datos ajenos.
3. Los agentes con token quedan registrados con `created_via: token`.
4. Cambia la contraseña admin por defecto en producción.

## 7. Verificación de la API (estado)

- Suite de pruebas automatizada: `docker/test_suite.sh <base_url>` → **33/33 PASS** en instalación limpia.
- Smoke test manual amplio (30 endpoints clave): **todos OK** con los parámetros correctos.
  (Los 4 que en un primer barrido dieron 403/422 era por faltar parámetros/permisos; con los
  valores correctos responden 200, comportamiento esperado.)
