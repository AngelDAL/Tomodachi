# Tomodachi CE — Reporte de pruebas

Fecha: 2026-08-10 (actualizado: tokens cableados en endpoints core)
Entorno: Docker (Dockerfile + docker-compose), puerto 8091
Imagen: php:8.2-apache + MariaDB 10.11
Modo: APP_MODE=OPEN_SOURCE, SEED_DEMO=true

## Resumen

**25/25 pruebas de la batería automatizada pasaron** (18 base + 7 de API
tokens integradas en `docker/test_suite.sh`). Además se verificaron
manualmente 27 flujos con token (incluyendo stock, ventas y reportes).

## Pruebas de API Tokens (Integraciones / Agentes IA)

### En la suite automatizada (`docker/test_suite.sh` sección 9)

| # | Prueba | Esperado | Resultado |
|---|---|---|---|
| 19 | Crear token read+write | success + token td_ | PASS |
| 20 | Token read: listar productos | 200 | PASS |
| 21 | Token write: crear categoría | 200 | PASS |
| 22 | Limpieza categoría de prueba | eliminada | PASS |
| 23 | Token read-only en endpoint write | **403** (sin scope write) | PASS |
| 24 | Token sin custom en theme | **403** (custom exclusivo) | PASS |
| 25 | Revocar tokens de prueba | revocados | PASS |

### Verificación manual adicional (2026-08-10)

| # | Prueba | Esperado | Resultado |
|---|---|---|---|
| A | Token read: GET products | 200 | PASS |
| B | Token read: POST categories | 403 sin write | PASS |
| C | Token rw: GET products | 200 | PASS |
| D | Token rw: POST categories | 200 | PASS |
| E | Token write-only: GET products | 403 sin read | PASS |
| F | Token write-only: POST categories | 200 | PASS |
| G | Sin auth: GET products | 401 | PASS |
| H | Sesión admin: GET products (regresión) | 200 | PASS |
| I | Token read: dashboard_stats | 200 | PASS |
| J | Token read: promotions/read | 200 | PASS |
| K | Token rw: crear promoción | 200 | PASS |
| L | Token read: theme GET | 200 (via=token) | PASS |
| M | Token rw: theme POST sin custom | 403 | PASS |
| N | Token rw: ajustar stock | 200 | PASS |
| O | user_id del movimiento con token | admin (user_id=1), NO 0 | PASS |
| P | Token read: get_sales | 200 | PASS |
| Q | Token read: users/read | 200 | PASS |
| R | Token read: current_register | 200 | PASS |
| S | Token read: stores/settings GET | 200 | PASS |
| T | Token rw: stores/update PUT | 200 | PASS |
| U | Token rw: create_sale | 200 (sale creada, user_id=1) | PASS |
| V | Token read: sale_details | 200 | PASS |
| W | Token revocado → uso | 401 | PASS |

## Bugs encontrados y corregidos durante las pruebas

1. **Tokens solo funcionaban en theme.php** — los ~50 endpoints usaban
   exclusivamente sesión; un agente IA con token no podía leer ventas,
   inventario ni reportes. Corregido cableando `ApiAuth` (getActor +
   requireScope) en 23 endpoints core: inventario, ventas, reportes,
   promociones, cajas, tiendas y users/read. (commit pendiente)

2. **Ventas/movimientos rompían con token** — `user_id` es NOT NULL con FK
   y un token no tiene usuario. `ApiAuth::getActor()` ahora atribuye las
   acciones del token al admin de la tienda (user_id del admin).

3. **Scope custom no era exclusivo** — theme.php permitía `custom` O `write`
   para personalizar. Un token solo-write podía tocar el tema. Corregido:
   solo `custom` (commit 68faea5).

## Cómo reproducir

```bash
cd Tomodachi && git checkout community-edition
PORT=8091 SEED_DEMO=true docker compose up -d --build
bash docker/test_suite.sh http://localhost:8091
# API tokens: crear -> usar -> revocar (ver docs/API.md)
```

## Pruebas ejecutadas

| # | Prueba | Esperado | Resultado |
|---|---|---|---|
| 1 | Login admin/admin123 | 200 | PASS |
| 2 | Login demo/demo123 (tienda seed) | 200 | PASS |
| 3 | Login con password incorrecta | 401 | PASS |
| 4 | Modo OPEN_SOURCE (todo desbloqueado) | OPEN_SOURCE | PASS |
| 5 | Reportes sin sesión | 401 | PASS |
| 6 | IDOR get_sales?store_id=2 (tienda ajena) | 403 | PASS |
| 7 | IDOR create_sale store_id=2 | 403 | PASS |
| 8 | IDOR users/create store_id=2 | 403 | PASS |
| 9 | IDOR stores/update store_id=2 | 403 | PASS |
| 10 | IDOR open_register store_id=2 | 403 | PASS |
| 11 | Crear venta en tienda propia | 200 | PASS |
| 12 | Listar ventas tienda propia | 200 | PASS |
| 13 | Actualizar tienda propia | 200 | PASS |
| 14 | Crear tienda | 200 | PASS |
| 15 | IA generate_image en CE | 403 | PASS |
| 16 | IA analyze_image en CE | 403 | PASS |
| 17 | Rate limit soporte (5/hora → 429) | 429 | PASS |
| 18 | Frontend login.html | 200 | PASS |

## Bugs encontrados y corregidos durante las pruebas

1. **permissions.php: parse error** (pre-existente en main) — código muerto
   con llave suelta después del `exit` rompía el healthcheck del contenedor.
   Eliminado. Este archivo ES el healthcheck de Docker; sin este fix el
   contenedor nunca pasaba a healthy.

2. **Sesión rota en stores/create, stores/update** (pre-existente) — usaban
   `session_start()` directo sin `session_name(SESSION_NAME)`, buscando la
   cookie `PHPSESSID` en vez de `tomodachi_session`. Siempre respondían
   "No autorizado" incluso con sesión válida. Migrados a la clase `Auth`.

3. **Endpoints IA con 500 en instalación limpia** — `require_once 'config.php'`
   (API keys) ocurría antes del guard de CE; al no existir el archivo,
   daban 500 en vez de 403. El guard OPEN_SOURCE ahora se evalúa primero.

4. **Encoding UTF-8 al importar schema/seed** — el cliente mysql importaba
   en latin1, rompiendo acentos ("Cafetería" → "CafeterÃ­a"). Corregido con
   `SET NAMES utf8mb4` en los SQL y `--default-character-set=utf8mb4` en el
   entrypoint.

## Cómo reproducir

```bash
cd Tomodachi && git checkout community-edition
PORT=8091 SEED_DEMO=true docker compose up -d --build
bash docker/test_suite.sh http://localhost:8091
```

## Datos de prueba disponibles

- Tienda 1 "Tienda Principal": admin / admin123 (6 productos base)
- Tienda 2 "Cafetería Demo": demo / demo123 (5 productos, 7 ventas históricas)
- Store_id 1 y 2 para pruebas de aislamiento multi-tienda
