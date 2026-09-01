# Mejoras Operativas - Tomodachi POS

Este documento contiene las mejoras operativas identificadas para el sistema Tomodachi POS. Cada ítem incluye una casilla de verificación para marcar su estado.

**Instrucciones:**
- `[ ]` = Pendiente
- `[x]` = Completado
- Actualiza el estado al finalizar cada mejora.
- Agrega notas o enlaces a commits/pull requests en la columna "Notas".

---

## 🔴 Críticas

| # | Mejora | Archivos involucrados | Estado | Notas |
|---|--------|----------------------|--------|-------|
| 1 | **Validar precios y promociones en el servidor** — Mover la lógica de descuentos/promociones del navegador al backend; recalcular totales en el servidor; guardar `promotion_id` por línea de venta. | `includes/Pricing.class.php`, `api/sales/create_sale.php` | [x] | Fase A: Pricing.class.php + migración 015 |
| 2 | **Sincronizar `database/schema.sql` con migraciones** — Incluir en `schema.sql` tablas y campos finales: promociones, terminales, venta a granel, configuración de tienda, etc. Corregir migraciones duplicadas (`003`, `006`, `010/011`). | `database/schema.sql`, `database/migrations/` | [ ] | |
| 3 | **Guardar costo histórico en `sale_details`** — Agregar `unit_cost` a `sale_details` y poblarlo al crear la venta; actualizar reportes para usar costo histórico. | `database/schema.sql`, `api/sales/create_sale.php`, `api/reports/` | [x] | Fase A: migración 015 + reportes con COALESCE(unit_cost, cost) |

---

## 🟠 Altas

| # | Mejora | Archivos involucrados | Estado | Notas |
|---|--------|----------------------|--------|-------|
| 4 | **Implementar devoluciones y reembolsos parciales** — Permitir devolver productos individuales de una venta sin cancelar toda la transacción; reingresar stock opcionalmente. | `api/sales/refund_sale.php`, `database/migrations/016_add_refunds.sql` | [x] | Fase A: endpoint refund + tablas sale_refunds |
| 5 | **Control de apertura de caja** — Eliminar o hacer opcional el fallback que abre caja automáticamente con `$0.00`; exigir apertura formal antes de vender. | `api/sales/create_sale.php`, `public/profile.html`, `public/js/profile.js` | [x] | Fase A: setting require_open_register |
| 6 | **Tabla de pagos de venta (`sale_payments`)** — Registrar desglose completo de pagos mixtos (efectivo, tarjeta, transferencia) para conciliación. | `database/schema.sql`, `api/sales/create_sale.php`, `public/js/sales.js`, `public/sales.html` | [ ] | |
| 7 | **Módulo de clientes y asociación a ventas** — Crear tabla `customers`; permitir asociar venta a cliente; base para facturación y fidelización. | `database/schema.sql`, `public/sales.html`, `public/js/sales.js`, `api/sales/create_sale.php` | [ ] | |

---

## 🟡 Medias

| # | Mejora | Archivos involucrados | Estado | Notas |
|---|--------|----------------------|--------|-------|
| 8 | **Logs de auditoría centralizados** — Registrar quién cambió precios, stock, canceló ventas o cerró caja. | `database/schema.sql`, múltiples endpoints | [ ] | |
| 9 | **Revalidar sesión contra base de datos** — `verify_session.php` debe verificar que el usuario siga activo y su contraseña/rol no hayan cambiado. | `api/auth/verify_session.php`, `includes/Auth.class.php` | [ ] | |
| 10 | **Permisos granulares en el frontend** — Ocultar opciones/menús según rol (cajero no debería ver finanzas/inventario). | `public/js/sidebar-loader.js`, todas las páginas HTML | [ ] | |
| 11 | **Corregir campo SKU** — El formulario de producto tiene campo SKU pero no se persiste en la base de datos ni en el API. | `database/schema.sql`, `api/inventory/products.php`, `public/inventory.html` | [ ] | |
| 12 | **Corregir cancelación de ventas mixtas** — Al cancelar una venta `mixed`, solo se debe retirar de caja la parte en efectivo, no el total. | `api/sales/cancel_sale.php` | [ ] | |
| 13 | **Conteo por denominaciones al cerrar caja** — Agregar conteo de billetes/monedas al cierre para facilitar arqueo. | `public/finance.html`, `public/js/finance.js`, `api/cash_register/close_register.php` | [ ] | |
| 14 | **Permitir crear productos a granel desde el alta** — Agregar campos `is_bulk` y `bulk_unit` al formulario de creación de producto. | `public/inventory.html`, `public/js/inventory.js` | [ ] | |
| 15 | **Ver detalle de venta desde historial del punto de venta** — Implementar `viewSaleDetails` consumiendo `api/sales/sale_details.php`. | `public/js/sales.js`, `public/sales.html` | [ ] | |
| 16 | **Reporte de cierre Z / auditoría de caja** — Consolidar por día/turno: ventas por método de pago, cancelaciones, retiros y arqueos. | Nuevo endpoint, `public/reports.html` | [ ] | |
| 17 | **Exportación completa de reportes** — Agregar exportación Excel/PDF para cajas, movimientos de efectivo y etiquetas QR. | `public/reports.html` | [ ] | |

---

## 🟢 Bajas (rápidas)

| # | Mejora | Archivos involucrados | Estado | Notas |
|---|--------|----------------------|--------|-------|
| 18 | **Corregir redirección a login** — `sales.js` redirige a `/login.php` pero el archivo es `login.html`. | `public/js/sales.js` | [ ] | |
| 19 | **Corregir `cartBadge` duplicado** — Líneas 59/68 de `sales.js` sobreescriben la referencia. | `public/js/sales.js` | [ ] | |
| 20 | **Corregir asignación de QR en reportes** — No sobrescribir `barcode` con el valor de QR. | `public/reports.html` | [ ] | |
| 21 | **Refactorizar lógica duplicada de gráficos** — Unificar cálculos entre `dashboard_stats.php` y `get_chart_data.php`. | `api/reports/dashboard_stats.php`, `api/reports/get_chart_data.php` | [ ] | |
| 22 | **Corregir `api/auth/permissions.php`** — Eliminar código inalcanzable después del `exit`. | `api/auth/permissions.php` | [ ] | |

---

## Registro de cambios

| Fecha | Mejora realizada | Responsable |
|-------|------------------|-------------|
| | | |

