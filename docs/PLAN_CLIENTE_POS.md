# PLAN — Cliente vinculado + Apartado en el Punto de Venta

**Estado:** PROPUESTA — revisar antes de construir
**Fecha:** 2026-08-13
**Área:** POS (sales.html/sales.js) + APIs existentes

## Situación actual (investigado)

El backend YA soporta apartados completos:
- `create_sale.php` acepta `payment_method=credit` + `customer_id` +
  `amount_paid`; valida límite de crédito (409 con monto formateado),
  incrementa `customers.balance`, registra el abono en `cash_movements`
  y guarda `customer_id` en la venta.
- `customers.php` devuelve detalle + últimas 20 ventas + 20 abonos.
- `sale_details.php` ya trae `customer_name` y los items.

PERO en el POS el flujo está **escondido**:
- El selector de cliente (`customerSelectorGroup`) solo aparece al elegir
  "Apartado (a crédito)" en el método de pago del checkout.
- Es un `<select>` simple sin foto ni información del cliente.
- No hay forma de ver promociones aplicables, últimas compras ni saldo
  ANTES de finalizar.
- No hay un "cliente vinculado" persistente durante la sesión de venta.

## Decisiones (respuestas de Angel — 2026-08-13)

1. **Caja vs saldo a favor**: el saldo pendiente del cliente (cuentas por
   cobrar) NO cuenta como efectivo en caja. En caja solo se refleja el
   pago parcial que el cliente dio HOY (amount_paid) y los abonos que
   pague DESPUÉS. El panel del POS debe distinguir: "Caja: ¥500" y
   "Saldo a nuestro favor: ¥200" por separado. → payments.php debe
   insertar cash_movement 'entry' al abonar (el dinero del abono SÍ entra
   a caja cuando el cliente paga esa última parte).
2. **Promociones SOLO informativas**: listar las activas y marcar las que
   aplican a productos del carrito, sin botón "Aplicar" integrado (el
   cajero aplica el descuento manualmente como hoy).
3. **Cliente vinculado se limpia** al finalizar la venta o recargar la
   página (no persiste entre ventas).
4. **Crédito = apartados/adelantos/fiados/parcialidades**: el sistema debe
   distinguir cada situación con control claro, sin complicar al usuario.
   El flujo único es: carrito → vincular cliente → método Apartado →
   pago ahora (opcional) → resto queda como saldo a favor. Los abonos se
   registran desde clientes y entran a caja.
5. **Alcance completo**: vincular + panel (promos/últimas compras) +
   apartado visible + registro contable correcto, en esta fase.

## Diseño propuesto

### 1. Barra de cliente vinculado (junto a la búsqueda)

En la cabecera del POS (junto al buscador de productos) se agrega un
botón/control "👤 Cliente" que:
- Al hacer clic abre un **selector con buscador** (reutiliza customers.php
  ?search=) en un dropdown/popover.
- Al elegir cliente → se muestra un **chip/badge fijo** en la barra:
  avatar con iniciales + nombre + saldo (si debe), con botón "✕" para
  desvincular y botón "⋯" para abrir el panel de opciones.

### 2. Panel de cliente vinculado (drawer lateral)

Al hacer clic en el chip o en "⋯", se abre un drawer (estilo igual al de
movimientos de finanzas) con 2 columnas / pestañas:

- **Resumen**: avatar, nombre, teléfono, saldo pendiente, límite de
  crédito, compras totales. Botones: "Desvincular", "Ver perfil completo"
  (va a customers.html).
- **Promociones activas** (pestaña): promociones vigentes de la tienda
  (reutiliza promotions/read.php) resaltando las que aplican a productos
  en el carrito actual (comparar targets contra CART). Botón "Aplicar" por
  promo si aplica a productos del carrito.
- **Últimas compras** (pestaña): últimas 10 ventas del cliente
  (customers.php?id= → sales) con total, estado y fecha.

### 3. Apartado en el checkout (mejorado, no escondido)

Se mantiene el método "Apartado (a crédito)" pero ahora:
- Si hay cliente vinculado, el select se auto-rellena con ese cliente
  (sin tener que buscarlo otra vez) y se muestra su saldo.
- El campo "Pago ahora" muestra en vivo cuánto quedará de saldo
  (Total - Pago ahora = nuevo saldo).
- Si NO hay cliente vinculado, al elegir Apartado se abre el selector
  de cliente (como hoy).
- Validación: no exceder límite de crédito (el backend ya la hace; el
  frontend puede pre-validar y mostrar error claro).

### 4. Registro de movimientos (verificación)

Confirmar y completar que cada operación deje rastro:
- Venta apartado → `sales` con customer_id + amount_paid + status; balance
  del cliente incrementado; cash_movements 'sale' por el pago parcial.
- Abono desde clientes → customer_payments + balance decrementado
  (ya existe en payments.php).
- ¿Qué falta? Revisar: un movimiento en cash_movements por el abono de
  apartado (payments.php hoy NO inserta cash_movement — solo actualiza
  balance; decidir si debe registrarse para el arqueo de caja).
  → **Pregunta abierta**.

## Archivos a tocar

| Archivo | Cambio |
|---|---|
| public/sales.html | Barra de cliente vinculado + drawer del panel + mejoras checkout |
| public/js/sales.js | Lógica de vincular/desvincular, panel, promos aplicables, pre-validación crédito |
| public/js/sales.js | Auto-rellenar customerSelect con el cliente vinculado |
| public/css/sales.css (o main.css) | Estilos del chip, drawer del cliente, pestañas |
| api/customers/payments.php | (opcional, pregunta) insertar cash_movement al abonar |
| api/promotions/read.php | (verificar) exponer promo vigente + targets para calcular aplicabilidad |

## Preguntas abiertas (para ti, Angel)

1. **¿El abono de apartado debe registrarse en cash_movements (arqueo de
   caja)?** Hoy payments.php solo baja el balance del cliente, no crea
   movimiento de caja. Para el arqueo, el efectivo recibido por un abono
   debería contarse. ¿Lo agregamos como 'entry'?

2. **¿Promociones aplicables al carrito o solo listar las activas?** El
   botón "Aplicar" por promo implicaría recalcular el carrito con la promo
   (mucha lógica). Opción simple: mostrar las promos activas y marcar las
   que aplican a productos del carrito, pero que el cajero aplique el
   descuento manualmente (como hoy). ¿Simple o integrada?

3. **¿El cliente vinculado persiste al cambiar de pestaña o recargar?**
   ¿Lo guardamos en la sesión de venta (localStorage) para que no se
   pierda si recargas el POS, o se limpia al finalizar cada venta?

4. **¿La venta 'Apartado' puede mezclarse con pago parcial en efectivo?**
   Hoy `amount_paid` puede ser > 0 (pago ahora) y el resto a crédito.
   ¿También quieres permitir abonar EN LA MISMA venta desde el panel del
   cliente (un botón "Abonar saldo" además de la compra actual)?

5. **¿Alcance de esta fase?** ¿Todo (vincular + panel + apartado visible +
   registro completo), o primero el vincular + apartado visible y en una
   segunda fase promos/últimas compras del panel?

## Verificación propuesta

- Vincular cliente desde el POS → chip visible con avatar/nombre/saldo.
- Elegir Apartado con cliente vinculado → customerSelect auto-relleno,
  preview del nuevo saldo.
- Finalizar venta apartado → sale con customer_id, balance incrementado,
  movimiento registrado; verificado en BD y en el detalle del cliente.
- Desvincular → el carrito sigue intacto, checkout vuelve a flujo normal.
- Suite `docker/test_suite.sh` 33/33 sin regresión.
