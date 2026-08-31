# Análisis Profundo — Tomodachi POS Community Edition

> Fecha: 2026-08-11 · Autor: análisis automatizado sobre el código real
> Rama: `community-edition` · Último commit: de3b90b

---

## 1. Estado actual (lo que YA tiene)

### Núcleo POS (sólido)
- **Caja/Punto de venta completo**: carrito, búsqueda, filtros por categoría,
  escáner de código de barras (web + nativo ML Kit en la app), descuentos
  (fijo / porcentaje / 2×1), promociones, venta a granel con báscula
  (integración de báscula), ticket con impresión, historial de ventas con
  reimpresión, guardar/recuperar venta en curso (park).
- **Pantalla para el cliente** (customer-display.html): enlace para tablet.
- **Inventario**: CRUD de productos/categorías, stock, movimientos, ajustes,
  imágenes, códigos QR, alerta de stock bajo.
- **Promociones**: simple_discount, bulk_discount, bundle, bill_discount.
- **Caja registradora**: apertura/cierre, movimientos de efectivo (entradas/
  salidas), arqueo con conteo y diferencia.
- **Reportes**: dashboard con estadísticas, ventas, productos más vendidos,
  valoración de inventario, movimientos, historial de cajas, movimientos de
  efectivo. Exportación parcial Excel/PDF.
- **Usuarios y roles**: super_admin, admin, manager, cashier; multitienda
  (store_id en toda la BD).

### Plataforma / infraestructura (bien resuelta)
- Docker Compose con MaríaDB persistente, migraciones automáticas, imágenes
  subidas y **sesiones persistentes** (volumen app_sessions).
- **API REST con tokens** para agentes IA: 23 endpoints con scopes
  read/write/custom, aislamiento multi-tienda, `created_via` (session vs token).
- **App Android (Capacitor)**: WebView con navegación interna, escáner ML Kit,
  wakelock, cookies persistentes, sin caché en RAM. APK distribuido por
  GitHub Releases.
- Sesión con "mantener sesión siempre" (cookie 1 año + GC 1 año), modal de
  re-login bonito, UI en español, tema personalizable (colores/logo).

---

## 2. Puntos críticos a corregir (afectan operación real)

| # | Problema | Impacto | Archivos |
|---|----------|---------|----------|
| C1 | **Precios/promociones calculados en el navegador; el servidor acepta el precio que mande el cliente** | Un vendedor (o un agente) puede vender a $0.01 o inventar descuentos. Para negocio real es inaceptable | `create_sale.php`, `sales.js` |
| C2 | **Apertura de caja automática con $0.00** si no hay caja abierta | No hay control de efectivo: no se sabe cuánto debería haber | `create_sale.php` |
| C3 | **No existe módulo de clientes** (tabla `customers` no existe) | No se puede vender "a crédito/fiado", ni llevar historial, ni fidelizar | BD + POS |
| C4 | **Solo cancelación total de venta**; no hay devoluciones parciales | Devolver 1 producto = cancelar toda la venta y rehacerla | `cancel_sale.php` |
| C5 | **Costo histórico no se guarda** en `sale_details` | Si el costo cambia, los reportes de ganancia histórica se distorsionan | `create_sale.php`, reportes |
| C6 | **Pagos mixtos sin desglose** (no hay `sale_payments`) | Conciliación difícil: no se sabe cuánto fue efectivo vs tarjeta | BD + POS |

---

## 3. Nodos por implementar (roadmap sugerido)

### FASE A — Operar de verdad (prioridad alta, semanas 1-2)
1. **Validación de precios en servidor** (C1): el backend recalcula totales con
   precios de BD + promociones; `promotion_id` por línea; rechaza precios
   inventados. *Es la mejora #1 de MEJORAS_OPERATIVAS.md.*
2. **Cierre de caja Z / auditoría diaria**: consolidar por día/turno — ventas
   por método de pago, cancelaciones, retiros, arqueo. Reporte imprimible.
3. **Devoluciones y reembolsos parciales** (C4): devolver items individuales,
   reingreso de stock, nota de devolución.
4. **Costo histórico** (C5): columna `unit_cost` en `sale_details`; reportes
   usan costo de la venta, no el actual.
5. **Control de apertura de caja** (C2): exigir apertura formal con monto
   inicial; opción de desactivar el auto-fallback.
6. **Impresora térmica ESC/POS** (hoy solo `window.print()`): ticket de 58/80mm,
   copias, logo, QR del ticket; puente con impresora USB/Bluetooth en la app.

### FASE B — Diferenciador para el vendedor (semanas 3-4)
7. **Módulo de clientes** (C3): alta rápida, historial de compras, saldo
   pendiente (fiado), búsqueda por nombre/teléfono; asociar venta a cliente.
8. **Permisos granulares en frontend** (cajero no ve finanzas/inventario).
9. **Modo offline** (IndexedDB + Service Worker): vender sin internet y
   sincronizar al volver. *Crítico para cafeterías/mercados con wifi malo.*
10. **Notificaciones push en la app** (FCM): aviso de venta, stock bajo,
    cierre de caja. *(Fase 3 del plan móvil, aún pendiente.)*
11. **Arqueo por denominaciones** al cerrar caja (billetes/monedas).

### FASE C — Crecimiento (mes 2+)
12. **Facturación / CFDI** (México): datos fiscales en clientes, folio,
    XML/PDF; o al menos recibo simple con RFC.
13. **Fidelización**: puntos por compra, tarjetas de cliente, promociones
    dirigidas.
14. **Logs de auditoría centralizados** (quién cambió precio/stock/canceló).
15. **Exportación completa de reportes** (Excel/PDF para cajas, efectivo, QR).
16. **Multitienda avanzado**: transferencias de inventario entre tiendas,
    consolidado corporativo.

---

## 4. Mejoras rápidas (baja complejidad, buen impacto)

- Corregir SKU: el formulario tiene campo SKU pero no se persiste en BD.
- Corregir cancelación de ventas mixtas (hoy retira el total de caja, no solo
  la parte en efectivo).
- Atajos de teclado en la caja (F2 vender, F4 descuento, Esc cancelar, tecla
  para buscar) — los cajeros viven en el teclado.
- Búsqueda por nombre con resaltado y "productos frecuentes" en el POS.
- Revalidar sesión contra BD en `verify_session.php`.
- Unificar lógica de gráficos (`dashboard_stats` vs `get_chart_data`).
- Botón "Ver detalle" en el historial del POS (ya existe la API).

---

## 5. Lo que un vendedor valora (prioridad de features por impacto)

Basado en cómo operan POS de éxito (Square, SumUp, Clip, iZettle):

| Feature | Por qué importa al vendedor |
|---|---|
| Velocidad de cobro (atajos, escáner, productos frecuentes) | Más clientes atendidos por hora |
| Ticket térmico confiable | El cliente se va con su comprobante; reclamaciones |
| Cierre de caja claro (cuánto hay, cuánto debería haber) | Arqueo diario en 2 minutos, sin drama |
| Devoluciones fáciles | Confianza del cliente; ahorro de tiempo |
| Crédito/fiado a clientes conocidos | Ventas que de otro modo se pierden |
| Modo offline | Nunca dejar de vender aunque falle el internet |
| Alertas de stock bajo | No quedarse sin producto en el peor momento |
| Ganancia real (costo histórico) | Saber si el negocio gana o pierde |

---

## 6. Resumen ejecutivo

**Tomodachi CE ya tiene una base sólida** (POS completo, inventario, cajas,
reportes, API para agentes, app Android, multitienda, UI en español). Lo que
le falta para ser una herramienta que un vendedor use a diario y recomiende
no es más "pantallas", sino **confiabilidad operativa**:

1. **Seguridad económica**: validar precios en servidor (C1) — es la base.
2. **Ticket y caja**: impresión térmica + cierre Z + arqueo por denominaciones.
3. **Clientes**: módulo de clientes con fiado e historial.
4. **Resiliencia**: modo offline con sincronización.
5. **Devoluciones** parciales y costo histórico para reportes honestos.

Con Fase A + B, Tomodachi pasa de "demo bonita" a "POS que un negocio real
usa todos los días".
