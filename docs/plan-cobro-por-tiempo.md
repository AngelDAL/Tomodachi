# Cobro por LUGAR y por TIEMPO — diseño y capas de negocio

Pedido de Ángel (28-sep-2026): *"estoy pensando en cómo implementar un sistema de cobro por
lugar, por ejemplo si fuera un estacionamiento, que se cobre por el tiempo que se ha usado el
lugar, o si fuera un ciber igualmente, cosas así, quiero tener la capacidad de tener múltiples
capas de negocio controladas"*. **Decisión: diseñarlo y documentarlo ahora; implementarlo en otra
tanda.**

## Lo que ya existe y por qué alcanza la base

- **El punto de servicio ya es el "lugar".** `dining_tables` (`label` + `zone` libre) ya se usa
  para mesa, barra, habitación o lo que sea; el QR del punto abre SU carta (`menu_id`, migración
  045) y su cuenta vive en `dining_sessions` (`opened_at`, `ordering_enabled`, `expires_at`).
- **La cuenta ya se cobra con un servicio aparte** (`ChargeService` + `SaleService`): el cobro no
  toca `sales` hasta cerrar, y la venta real se genera al cobrar. Los reportes filtran
  `status = 'completed'`, así que una cuenta abierta NUNCA ensucia las ventas.
- **El tiempo ya se mide**: `TIMESTAMPDIFF(MINUTE, s.opened_at, NOW())` es lo que la interfaz
  muestra como "minutos abierta" en el apartado del punto.

Es decir: **no hace falta un módulo nuevo**, hace falta una TARIFA por punto y convertir el
tiempo en una línea de la cuenta al cobrar.

## Las cuatro capas (para que un negocio cobre distinto por lugar)

| Capa | Qué es | Dónde vive | Qué manda |
|---|---|---|---|
| 1. Tienda | el negocio | `stores` + `store_settings` | marca, moneda, impuestos, propina |
| 2. Servicio / módulo | mesa · habitación · estación · lugar | nuevo `service_modes` (o enum en la tienda) | el MODO de cobro por defecto y sus reglas de redondeo |
| 3. Punto | Mesa 3 · Hab. 12 · PC-04 · Cajón 27 | `dining_tables` | la tarifa concreta y sus excepciones |
| 4. Cuenta | lo que se cobra | `dining_sessions` | lo consumido + el tiempo, y el total |

Cada capa hereda de la de arriba y puede sobrescribir: el hotel cobra POR NOCHE en habitaciones
y POR CONSUMO en su bar, con el mismo sistema y sin dos productos distintos.

## El modelo propuesto (migración nueva, no tocar las existentes)

En `dining_tables` (todas NULL/0 = comportamiento de hoy: solo consumo):

```
charge_mode      ENUM('consumption','time','time_plus_consumption')  DEFAULT 'consumption'
rate_per_hour    DECIMAL(10,2) NULL   -- tarifa del lugar
min_minutes      INT DEFAULT 0        -- mínimo facturable (p. ej. 60)
free_minutes     INT DEFAULT 0        -- cortesía inicial (p. ej. 15)
round_minutes    INT DEFAULT 0        -- 0 = al minuto; 15 = bloques; 60 = hora iniciada
cap_amount       DECIMAL(10,2) NULL   -- tope (p. ej. el día completo)
```

Y en `dining_sessions`:

```
time_frozen_at   DATETIME NULL   -- el reloj se detiene al PEDIR la cuenta
time_amount      DECIMAL(10,2) NULL  -- lo calculado y congelado (para que no se mueva mientras se cobra)
```

## Reglas del cálculo (las que evitan pleitos en el mostrador)

1. **El reloj arranca cuando el PERSONAL abre el punto**, no cuando el cliente escanea el QR
   (el escaneo puede ser antes: el cliente llega y se sienta; o después). Es `opened_at`, que ya
   existe. Para un estacionamiento, "abrir el punto" = registrar la entrada.
2. **El reloj se congela al pedir la cuenta** (`time_frozen_at`): el cliente no paga la espera de
   la fila del cobro. Reabrir el consumo descongela.
3. **Redondeo explícito y visible.** `round_minutes = 0` cobra al minuto; 15 cobra cada 15
   iniciados; 60 cobra la hora iniciada. El desglose se muestra en el apartado del punto
   ("2 h 15 min → 3 h por hora iniciada") antes de cobrar.
4. **`free_minutes` y `min_minutes`** son cortesía y piso: 15 min de cortesía, mínimo una hora.
5. **`cap_amount`** es el tope: evita la cuenta de $8 000 de un lugar olvidado. Sin tope, un
   estacionamiento necesita una ALERTA (la cuenta lleva abierta N horas) — la cola de avisos ya
   existe por WebSocket (`tiempo-real-websocket`).
6. **Puntos juntados**: el reloj del grupo es el del punto abierto MÁS VIEJO (lo justo para el
   cliente y simple de explicar). Al separar, el que se queda conserva su propio reloj.
7. **El tiempo NO descuenta inventario.** Es un servicio: `tracking_type = 'none'` y sin receta.
8. **El tiempo entra como una LÍNEA de la venta**, con su concepto ("Tiempo de estacionamiento ·
   2 h 15 min") y su importe. Así caja, ticket y reportes cuadran sin tocar una sola consulta.
   *Decisión pendiente de Ángel:* ¿el tiempo se cobra con un producto-servicio del catálogo
   ("Hora de estacionamiento", invisible en la carta) o con un campo nuevo en `sale_details`?
   Lo primero funciona hoy sin migrar reportes; lo segundo es más limpio a largo plazo.
9. **Impuestos y propina** se aplican igual que a cualquier línea: el tiempo es una línea más.

## Qué NO se toca

- `sales` sigue significando "venta cerrada". El tiempo es una línea dentro de esa venta.
- El modo de la carta (`open_tab` / `order_and_pay` / `menu_only`) y el cobro por tiempo son
  independientes: un ciber puede tener carta `open_tab` (pide snacks) y cobrar además el tiempo;
  un estacionamiento puede tener carta `menu_only` (solo informativa) y cobrar SOLO el tiempo.
- Las zonas y etiquetas libres siguen siendo la forma de nombrar lugares ("Cajón 27", "PC-04").

## Fases sugeridas

1. **Tarifa por punto + línea de tiempo en el cobro** (estacionamiento, ciber). Es la fase que
   resuelve el 90 %: migración con los campos, tarifa en el apartado del punto, y la línea de
   tiempo calculada y congelada al cobrar. Se puede dejar en 0 (solo consumo) para no cambiar
   nada en las tiendas que ya operan.
2. **Paquetes y prepago**: "2 h por $50", "hora + consumo incluido", pases por día. Se apoya en
   promociones (que ya existen) + la línea de tiempo.
3. **Estancia por día** (hotel): tarifa por noche con hora de corte (check-out), y cargos
   adicionales por servicio a la habitación (la carta `open_tab` ya lo resuelve).
4. **Avisos automáticos**: cuenta por vencer su tope de tiempo, lugar ocupado más de N horas,
   tarifa por cambiar de tramo.

## Riesgos anotados

- **Zona horaria**: TODO cálculo de tiempo con `NOW()` de la base (MariaDB en UTC, la app en
  CST). Nunca calcular en PHP un valor temporal que después se compare contra la base.
- **Cuentas eternas**: sin tope ni alerta, el tiempo sigue corriendo. Es el error más caro.
- **Cobrar en vivo vs congelar**: si el importe se recalculara durante el cobro, el total que ve
  el cajero no coincidiría con el que pagó el cliente. Por eso `time_frozen_at`.
