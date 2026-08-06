# Tomodachi CE — Reporte de pruebas

Fecha: 2026-08-05 (actualizado con API tokens)
Entorno: Docker (Dockerfile + docker-compose), puerto 8091
Imagen: php:8.2-apache + MariaDB 10.11
Modo: APP_MODE=OPEN_SOURCE, SEED_DEMO=true

## Resumen

**18/18 pruebas de la batería base pasaron** + **14/14 pruebas de API tokens** (a continuación).

## Pruebas de API Tokens (Integraciones / Agentes IA)

| # | Prueba | Esperado | Resultado |
|---|---|---|---|
| 1 | Login admin (sesión) | 200 | PASS |
| 2 | Crear token read+custom, 30 días | success + prefix td_ | PASS |
| 3 | Crear token write, sin expiración | expires_at null | PASS |
| 4 | Leer tema con token (scope read) | 200, via=token | PASS |
| 5 | Personalizar tema con token (scope custom) | 200, via=token | PASS |
| 6 | Tema guardado visible vía sesión | primary_color correcto | PASS |
| 7 | Token SOLO write intenta tema | **403** (custom exclusivo) | PASS |
| 8 | Token inválido | 401 | PASS |
| 9 | Sin auth | 401 | PASS |
| 10 | Listar tokens (admin) | 3+ tokens visibles | PASS |
| 11 | Token read+custom personaliza | 200 | PASS |
| 12 | Revocar token → uso posterior | 401 | PASS |
| 13 | Login demo (tienda 2) | 200 | PASS |
| 14 | Revocar token de OTRA tienda | **403** (aislamiento) | PASS |
| 15 | Token expirado (forzado en BD) | **401** | PASS |
| 16 | last_used_at se actualiza al usar | registrado | PASS |

## Bugs encontrados y corregidos durante las pruebas

1. **Scope custom no era exclusivo** — theme.php permitía `custom` O `write`
   para personalizar. Un token solo-write podía tocar el tema. Corregido:
   solo `custom` (commit 68faea5). La prueba 7 lo detectó.

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
