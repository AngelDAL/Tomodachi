# Tomodachi POS — API Reference (Community Edition)

API REST en PHP puro. Base URL: `https://tomodachi.tabtap.dev` (o tu propio host).

## Autenticación

- **Sesión de navegador**: `POST /api/auth/login.php` con `{username, password}`.
  El servidor setea una cookie de sesión (`tomodachi_session`, httponly).
- **API Token (para agentes/IA)**: header `Authorization: Bearer td_...`
  (o `X-API-Key`). Los tokens se gestionan en el panel
  **Integraciones** (`/public/integrations.html`) o vía los endpoints
  `api/api_tokens/*`. Cada token pertenece a UNA empresa y tiene scopes.
- **Todas las rutas (excepto auth públicas) requieren autenticación**. Si no,
  responden `401 {"success": false, "message": "No autorizado"}`.
- **Aislamiento multi-tienda**: el backend usa SIEMPRE `store_id` de la sesión
  o del token. Si un endpoint recibe `store_id` por query/body, lo valida
  contra la identidad y responde `403` si no coincide.

## Scopes de API Token (estilo Home Assistant)

| Scope | Permiso |
|---|---|
| `read` | Leer datos (ventas, inventario, reportes, tema) |
| `write` | Crear/modificar (ventas, inventario, config) |
| `custom` | Personalizar apariencia (tema, colores) |

Los tokens pueden tener expiración (`expires_in_days`) o ser eternos
(`0`). Un token revocado o expirado responde `401`.

## Formato de respuesta

```json
{"success": true, "data": {...}, "message": "..."}
{"success": false, "message": "Error", "errors": {...}}
```

Códigos: 200 OK · 400 validación · 401 no autenticado · 403 sin permisos ·
404 no existe · 405 método no permitido · 409 conflicto · 429 rate limit · 500 error.

## Auth

| Método | Ruta | Descripción | Body/Query |
|---|---|---|---|
| POST | `/api/auth/login.php` | Iniciar sesión | `{username, password, remember?}` |
| POST | `/api/auth/logout.php` | Cerrar sesión | — |
| GET | `/api/auth/verify_session.php` | Verificar sesión activa | — |
| GET | `/api/auth/permissions.php` | Plan y permisos según APP_MODE | — |
| POST | `/api/auth/register.php` | Registrar tienda (si está habilitado) | `{store_name, username, password, full_name, email}` |
| POST | `/api/auth/forgot_password.php` | Solicitar reset | `{email}` |
| POST | `/api/auth/reset_password.php` | Aplicar reset | `{token, new_password}` |

## Ventas (Sales)

| Método | Ruta | Descripción | Body/Query | Roles |
|---|---|---|---|---|
| POST | `/api/sales/create_sale.php` | Crear venta | `{store_id, items:[{product_id, quantity, price?}], payment_method, discount?, tax?, cash_amount?, register_id?}` | admin/manager/cashier |
| GET | `/api/sales/get_sales.php` | Listar ventas del día | `?store_id=&date=YYYY-MM-DD` | auth |
| GET | `/api/sales/sale_details.php` | Detalle de venta | `?sale_id=` | auth |
| POST | `/api/sales/cancel_sale.php` | Cancelar venta (devuelve stock) | `{sale_id}` | admin/manager |
| POST | `/api/sales/cart_sync.php` | Sincronizar carrito (kiosko/display) | ver archivo | auth |
| GET | `/api/sales/cart_sse.php` | SSE para customer display | `?session=UUID` | público (UUID = llave) |

Nota: `create_sale` valida que `store_id`, `register_id` y los `product_id`
pertenezcan a la tienda de la sesión (403 si no). El precio puede venir del
cliente para reflejar promociones; la validación de precios en servidor es
una mejora pendiente (ver MEJORAS_OPERATIVAS.md #1).

## Inventario (Inventory)

| Método | Ruta | Descripción | Body/Query | Roles |
|---|---|---|---|---|
| GET/POST/PUT/DELETE | `/api/inventory/products.php` | CRUD productos | query: `?store_id=&search=`; body según acción | admin/manager |
| GET/POST/PUT/DELETE | `/api/inventory/categories.php` | CRUD categorías | body según acción | admin/manager |
| POST | `/api/inventory/stock.php` | Ajustar stock | `{product_id, movement_type: entry\|exit\|adjustment, quantity, notes?}` | admin/manager |
| GET | `/api/inventory/scanner.php` | Buscar por código | `?code=&store_id=` | auth |
| POST | `/api/inventory/upload_image.php` | Subir imagen base64 | `{product_id, image_base64}` | admin/manager |

## Cajas (Cash Registers)

| Método | Ruta | Descripción | Body/Query | Roles |
|---|---|---|---|---|
| POST | `/api/cash_register/open_register.php` | Abrir caja | `{store_id, initial_amount, terminal_id?}` | admin/manager/cashier |
| POST | `/api/cash_register/close_register.php` | Cerrar caja | `{register_id, counted_amount, notes?}` | admin/manager/cashier |
| GET | `/api/cash_register/current_register.php` | Caja abierta actual | `?store_id=&terminal_id=&register_id=` | admin/manager/cashier |
| GET | `/api/cash_register/get_movements.php` | Movimientos de caja | `?register_id=` | auth |
| POST | `/api/cash_register/cash_movements.php` | Registrar movimiento | `{register_id?, store_id?, movement_type: entry\|withdrawal, amount, description?}` | admin/manager/cashier |

## Promociones (Promotions)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/promotions/create.php` | Crear promoción (simple_discount, bulk_discount, bundle, bill_discount) |
| GET | `/api/promotions/read.php` | Listar promociones de la tienda |
| POST | `/api/promotions/update.php` | Actualizar promoción |
| POST | `/api/promotions/delete.php` | Eliminar promoción |

## Reportes (Reports)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/reports/dashboard_stats.php` | Estadísticas del dashboard (ventas, productos, cajas) |
| GET | `/api/reports/get_chart_data.php` | Datos de gráficas |

## API Tokens (Integraciones / Agentes IA)

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `/api/api_tokens/create.php` | Crear token. Body: `{name, scopes:[read\|write\|custom], expires_in_days}`. Devuelve el token UNA vez | admin (sesión) |
| GET | `/api/api_tokens/read.php` | Listar tokens de la tienda (sin revelar el token) | admin (sesión) |
| POST | `/api/api_tokens/revoke.php` | Revocar token. Body: `{token_id}` | admin (sesión) |

### Uso con agentes de IA

```bash
# 1. Crear un token con scope custom (desde el panel o con sesión admin)
curl -b cj -X POST http://localhost:8080/api/api_tokens/create.php \
  -H 'Content-Type: application/json' \
  -d '{"name":"mi-agente","scopes":["read","custom"],"expires_in_days":30}'

# 2. El agente usa el token para personalizar el tema de la tienda
curl -X POST https://tomodachi.tabtap.dev/api/stores/theme.php \
  -H "Authorization: Bearer td_1_abc123.<SECRET>" \
  -H 'Content-Type: application/json' \
  -d '{"theme_config":{"primary_color":"#E3057A","secondary_color":"#4a4a4a"}}'

# 3. Leer el tema actual
curl https://tomodachi.tabtap.dev/api/stores/theme.php \
  -H "Authorization: Bearer td_1_abc123.<SECRET>"
```

## Tiendas (Stores)

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| GET | `/api/stores/read.php` | Listar tiendas | auth |
| POST | `/api/stores/create.php` | Crear tienda | admin |
| PUT | `/api/stores/update.php` | Actualizar tienda (solo la propia) | admin |
| GET/POST | `/api/stores/settings.php` | Leer/guardar settings de la tienda propia | auth |
| GET/POST | `/api/stores/theme.php` | Leer/modificar tema (colores). POST requiere scope `custom` o `write`; GET scope `read` | sesión o token |
| POST | `/api/stores/import_data.php` | Importar productos (CSV/JSON) | admin |
| POST | `/api/stores/upload_logo.php` | Subir logo | admin |
| POST | `/api/stores/save_background.php` | Guardar fondo generado (IA deshabilitada en CE) | auth |

## Usuarios (Users)

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| GET | `/api/users/read.php` | Listar usuarios (solo tu tienda) | auth |
| POST | `/api/users/create.php` | Crear usuario (solo en tu tienda) | admin |
| PUT | `/api/users/update.php` | Actualizar usuario (solo tu tienda / sí mismo) | admin |
| DELETE | `/api/users/delete.php` | Desactivar usuario (solo tu tienda) | admin |
| GET/PUT | `/api/users/profile.php` | Perfil propio | auth |
| POST | `/api/users/complete_onboarding.php` | Marcar onboarding completo | auth |

## Terminales (Terminals)

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| GET | `/api/terminals/read.php` | Listar terminales de tu tienda | auth |
| POST | `/api/terminals/create.php` | Crear terminal | admin/manager |
| POST | `/api/terminals/delete.php` | Desactivar terminal | admin/manager |

## Super Admin

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| POST | `/api/super_admin/create_backup.php` | Crear backup de BD | super_admin |

## Soporte (público)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/support/send_message.php` | Formulario de contacto. Rate limit: 5/hora por IP (429) |

## IA (deshabilitada en Community Edition)

Los endpoints `api/ai/*` (analyze_image, generate_image, remove_background,
replace_background, generate_background) responden `403 "Funciones de IA no
incluidas en Community Edition"` cuando `APP_MODE=OPEN_SOURCE`. Se activan
solo en modo `SAAS` con API keys configuradas en `api/ai/config.php`.

## Modo de despliegue (APP_MODE)

- `OPEN_SOURCE` (default): todas las features desbloqueadas, sin cobros.
- `SAAS`: planes free/premium con límites; para el proveedor de hosting.

## Buenas prácticas para agentes que integren

1. Login primero: `POST /api/auth/login.php`, guardar cookie de sesión.
2. Usa `store_id` de tu sesión; nunca intentes otra tienda (403).
3. Respeta roles: cashier no crea usuarios; manager no cancela ventas.
4. Para datos de prueba usa la tienda demo (store_id 1, admin/admin123).
5. Cambia la contraseña admin después del primer uso.
