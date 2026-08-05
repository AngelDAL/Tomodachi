# Tomodachi CE — Reporte de pruebas

Fecha: 2026-08-05
Entorno: Docker (Dockerfile + docker-compose), puerto 8091
Imagen: php:8.2-apache + MariaDB 10.11
Modo: APP_MODE=OPEN_SOURCE, SEED_DEMO=true

## Resumen

**18/18 pruebas pasaron. 0 fallaron.**

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
