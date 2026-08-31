# API Tracking — Seguimiento de la API de Tomodachi POS (v1.0)

> Objetivo: mantener un registro vivo y verificable de los endpoints de la API,
> su estado y cómo revisarlos, para que la documentación de `docs/API.md` nunca
> quede desactualizada y un agente/integración sepa siempre qué herramientas tiene.

## Cómo mantener este documento al día (workflow recomendado)

1. **Cuando se añade/modifica/elimina un endpoint**, actualiza la sección 4 del
   módulo correspondiente en `docs/API.md` y añade una fila en el registro de
   cambios (sección 4).
2. **Re-audita al menos al cerrar cada versión** (ej. antes de publicar v1.0, v1.1...):
   - `cd /opt/tomodachi && find api -name "*.php" | wc -l` → nº total de archivos.
   - Compara con el nº documentado (91 funcionales, sin contar `api/ai/*`).
   - Verifica con el auditor automático (ver sección 5).
3. **Corre la suite** sobre un entorno limpio:
   `bash docker/test_suite.sh <base_url>` → debe pasar 33/33.
4. **Smoke test de humo** sobre los endpoints que tocaste.

## Inventario vivo (generado 2026-08-20)

- **Total archivos de endpoint** (`find api -name "*.php"`): **96**
- **Funcionales documentados (CE, sin IA)**: **91**
- **IA deshabilitada** (`api/ai/*`): 5 → responden 403 en OPEN_SOURCE.
- **Esquemas de BD**: 29 tablas en instalación limpia (incluye `login_attempts`).

| Módulo | Endpoints | Métodos principales | ¿Verificado? |
|---|---|---|---|
| auth | 7 | POST/GET | ✅ (suite + smoke) |
| api_tokens | 3 | POST/GET | ✅ (suite) |
| cash_register | 5 | GET/POST | ✅ (smoke) |
| customers | 2 | GET/POST/PUT/DELETE | ✅ (suite/smoke) |
| inventory | 5 | GET/POST/PUT/DELETE | ✅ (suite) |
| promotions | 4 | GET/POST | ✅ (suite) |
| reports | 3 | GET | ✅ (smoke) |
| sales | 7 | GET/POST | ✅ (suite + smoke) |
| stores | 8 | GET/POST/PUT | ✅ (smoke) |
| users | 6 | GET/POST/PUT | ✅ (smoke) |
| terminals | 3 | GET/POST | ✅ (smoke) |
| push | 4 | GET/POST | ✅ (smoke) |
| digital_boards | 8 | GET/POST/PUT | ✅ (smoke) |
| board_slides | 5 | GET/POST/PUT | ✅ (smoke) |
| board_slide_assignments | 4 | GET/POST/PUT | ✅ (smoke) |
| slide_elements | 4 | GET/POST/PUT | ✅ (smoke) |
| slide_library | 1 | GET | ✅ (smoke) |
| display_groups | 10 | GET/POST/PUT | ✅ (smoke) |
| super_admin | 1 | POST | ⚠️ (requiere super admin) |
| support | 1 | POST | ✅ (suite: rate-limit) |

## Registro de cambios (API)

| Fecha | Cambio | Versión |
|---|---|---|
| 2026-08-20 | Auditoría completa; documentados 91 endpoints funcionales en docs/API.md; creado este seguimiento | v1.0 |
| 2026-08-20 | Añadido rate limiter de login (429 anti fuerza bruta) + tabla `login_attempts` | v1.0 |
| 2026-08-20 | Corregido esquema de instalación limpia (reorden customers→sales; consolidado tablas de Pantallas Digitales 019-024) | v1.0 |

## Convención de versionado

La API se considera **v1.0** cuando:
- Todos los endpoints documentados responden como está descrito (no rotos).
- La instalación limpia desde `docker compose up` crea las 29 tablas sin errores.
- La suite pasa 33/33.
- Un agente puede autenticarse (sesión o token) y operar inventario, ventas,
  clientes, cajas, promos, reportes y pantallas digitales.

## 5. Auditor automático del inventario de endpoints

Script de referencia para regenerar el inventario; se guardó en `docker/audit_api.sh`.

```bash
#!/bin/bash
# Cuenta y lista endpoints por módulo
echo "Total archivos api:"; find api -name "*.php" | wc -l
echo "Por módulo:"; for d in api/*/; do
  n=$(find "$d" -name "*.php" | wc -l)
  [ "$n" -gt 0 ] && echo "  $(basename $d): $n"
done | sort
```
