# El pedido del comensal — activación por números, carrito por comensal y modo reposo

Diseño acordado con Ángel (28-sep-2026). Sustituye la primera versión de este documento: el
mecanismo de activación ya no es "el mesero ve la mesa", es un **emparejamiento por números**, como
los segundos factores de autenticación (te muestran un número aquí y lo confirmas allá).

> *"el cliente cuando entra le muestra dos números, estos se los dice al mesero para empezar su
> cuenta […] a cada usuario en espera se le asigna un número, y el mesero pregunta por esos números
> y al ingresarlos se le asigna esa mesa a ese cliente […] eso siempre y cuando haya más de una
> persona en la sala de espera; si no hay más que una persona en esa mesa, pasa directo […] apenas
> el usuario escanee el QR, al mesero ya le aparezca que hay alguien en esa mesa, y el mesero solo
> tenga que autorizar las órdenes de ese usuario."*

## El flujo, paso a paso

**El comensal**

1. Escanea el QR de la mesa → ve la carta (nivel 1: solo mirar).
2. Toca **"Listo para pedir"**.
3. Aparece el drawer con **dos números** (ej. `4 7`) y la instrucción de decirselos a quien atiende.
4. La pantalla queda en *"Esperando a que te activen…"* y **se pone sola en verde** cuando el mesero
   los escribe. No hay que refrescar nada: el aviso llega por WebSocket.
5. Ya activado: pide todo lo que quiera (un toque agrega; +/− ajusta; notas por platillo; quitar;
   ver el pedido; enviar a cocina) hasta que se cierra la cuenta.

**El mesero**

1. Su pantalla (tableta o celular, `tables.html?vista=activar`) lista en vivo las mesas con gente
   **en espera** — desde que alguien escanea el QR, sin que el cliente haga nada más.
2. Con **una sola** persona esperando en esa mesa: un botón grande **"Activar mesa 3"** (sin
   números: no hay ambigüedad de a quién autorizar). Un toque.
3. Con **dos o más**: cada una tiene su número; el mesero pregunta "¿quién tiene el 47?", lo escribe
   y activa **a ese dispositivo**. Los demás siguen esperando con su propio número.
4. Puede **Rechazar** una solicitud y **expulsar** a un dispositivo ya activado (el que se fue, el
   que molesta). El umbral lo pone la empresa (por defecto, el número de asientos de la mesa).

**La configuración de empresa**

- `require_activation = 0`: se salta todo y el cliente pide directo. El aviso al apagarlo dice el
  riesgo con todas sus letras: *"cualquiera que tenga el enlace de una mesa puede pedir sin estar
  ahí"*. Es la decisión del dueño, con la información a la vista.
- `activation_minutes` (10 por defecto): vida del par de números.

## Modelo de datos

En `dining_participants` (una fila por DISPOSITIVO: es lo que permite autorizar a uno y expulsar a
otro sin tocar a los demás):

```
activation_code     CHAR(2)  NULL   -- los dos números que se le enseñan al mesero
activation_expires  DATETIME NULL   -- caducan; se regeneran al volver a pedir
activated_at        DATETIME NULL   -- NULL = mira pero no pide
activated_by        INT      NULL   -- qué usuario del personal lo autorizó (auditoría)
rejected_at         INT      NULL   -- si el mesero rechazó esta solicitud
```

En `store_settings` (con override por carta en `menus`):

```
require_activation   TINYINT DEFAULT 1
activation_minutes   INT     DEFAULT 10
max_devices_per_check INT    DEFAULT 0   -- 0 = sin tope explícito (usa los asientos si existen)
```

Reglas del emparejamiento:

1. **Los números son únicos en TODA la tienda entre solicitudes vivas** (no solo en la mesa): dos
   mesas con "47" al mismo tiempo es un error garantizado en el mostrador. Si al generar choca, se
   reintenta. Es el mismo criterio que el folio de comanda: candado en la base, no cálculo aparte.
2. **Presencia ≠ solicitud.** El dispositivo aparece como PRESENTE al abrir la carta (el mesero ya
   sabe que hay alguien en la mesa, que es lo que pidió Ángel); el número se genera solo cuando el
   cliente toca "Listo para pedir". Así la pantalla del mesero no se llena de números que nadie va
   a usar y el cliente que solo quiere mirar no ve trámites.
3. **Caducan y se limpian solas**: a los `activation_minutes`; y si el dispositivo deja de latir se
   cae de la lista (ya existe `dining_participants.last_seen_at`). El mesero nunca ve solicitudes
   fantasma.
4. **Un dispositivo sin `activated_at` que intente pedir recibe 403** con un mensaje de persona:
   "Pídele a quien te atiende que active tu pedido" — nunca un error técnico.

## Observaciones honestas sobre este modelo

1. **El número no es un secreto fuerte.** Quien esté sentado al lado puede ver la pantalla del
   vecino. Esto es **verificación de presencia**, no autenticación: lo que de verdad protege es que
   el mesero está físicamente ahí y decide a quién activa. Por eso el número **caduca**, es de **un
   solo uso** y activa **un dispositivo** (no la mesa): el de la casa nunca lo recibe.
2. **"Pasa directo" con una sola persona: propongo que sea un toque del mesero, no automático.**
   Si fuera automático, cualquiera con un enlace filtrado pide sin que nadie lo vea. Un toque
   ("Activar mesa 3") mantiene la inmediatez que Ángel quiere y conserva el control.
3. **Hace falta poder decir que no**: Rechazar (el dispositivo vuelve a la carta, sin pedir) y
   Expulsar (al que ya estaba activado). Sin esas dos salidas, el mesero queda sin herramientas
   cuando alguien molesta.
4. **Tope de dispositivos por cuenta.** Con el código de 4 caracteres se puede unir quien sea; el
   tope (asientos de la mesa, o el que configure la empresa) cierra ese hueco. Se apoya en `seats`
   de la mesa física (Fase 3).
5. **La reconexión no debe romper nada**: si el cliente recarga, conserva su lugar
   (`pos_diner_session` en localStorage ya lo hace) y puede regenerar sus números. Si los pierde y
   ya estaba activado, sigue activado.
6. **Aviso al mesero también cuando alguien se va**: si el dispositivo deja de latir, su renglón se
   va con él. Un "esperando" que nunca desaparece es peor que no tener lista.

## Lo que el comensal LEE (texto propuesto, tal cual)

**Drawer de activación (título):** `Para pedir, que te activen`

- Paso 1: **"Dile estos dos números a quien te atiende:"** → `4 7` (grande, con tipografía tabular)
- Paso 2: **"En cuanto los escriba, esta pantalla te avisa sola."**
- Nota: **"Son de este dispositivo. Nadie más puede pedir por ti."**
- Estado esperando: `Esperando a que te activen…`
- Estado activado: **"Listo, ya puedes pedir. Toca lo que quieras del menú."** (y la carta se
  desbloquea en el mismo instante)
- Si caducan: **"Los números vencieron. Tócalos para generar otros."**
- Botón secundario: `Solo quiero ver la carta` (vuelve al nivel 1 sin perder la solicitud)

**Pantalla del mesero**

- Con una sola persona: `Mesa 3 · 1 esperando` + botón **`Activar mesa 3`**
- Con varias: `Mesa 3 · 3 esperando` + campo `Número` + botón `Activar` (los demás se quedan)
- Cada renglón: mesa, minutos esperando, y `Rechazar` / `Expulsar`

## El modo "Espera" (reposo) y la cartelería por contexto

Su corrección: **no** se muestran "todas las promos activas" ni todas las diapositivas, sino **las
que el administrador asignó a ESE destino**.

- La cartelería digital ya existe (`digital-signage*.html`, `digital-scene`,
  `digital-screen-sequence`, API `digital_boards/*` y `board_slides/*`, editor de diapositivas), y
  se usará en varios entornos: **pantallas, caja, kiosko, tabletas de mesa, estaciones de
  servicio**.
- Falta lo que hace posible ese reparto: un **destino/contexto** por pantalla (y por asignación de
  diapositiva): `destino ENUM('display','caja','kiosko','mesa','estacion')`. El modo reposo de la
  carta pide *"las diapositivas del destino mesa"* de esa tienda; no filtra nada por su cuenta.
- Si no hay ninguna asignada para `mesa`, **no hay protector**: se queda la carta. Y una diapositiva
  puede marcarse "solo si la promoción está vigente", para no anunciar algo vencido.
- Reglas de convivencia (para que no estorbe): no entra si hay algo sin enviar, no entra si el
  drawer de activación está abierto, sin audio, respetando `prefers-reduced-motion`, y se reinicia
  también cuando llega el aviso "tu pedido está listo" (eso vale más que un anuncio).

## Fases

1. **Activación por números + pantalla del mesero + configuración de empresa.** Es el flujo que
   Ángel describió, con WebSocket desde el primer paso (presencia en vivo).
2. **Carrito con swipe y por comensal** en el teléfono (columna en escritorio, hoja deslizable en el
   teléfono), agrupado por persona.
3. **Mesa física**: `pos_x/pos_y/shape/seats` + editor de plano arrastrando; el tope de dispositivos
   se apoya en los asientos.
4. **Modo reposo** con las diapositivas del destino `mesa` (el módulo de cartelería ya está hecho;
   falta el destino y la asignación).

## Lo que NO hay que rehacer

Unirse con el código de 4 caracteres · pausar/reanudar pedidos · atribuir cada platillo a quien lo
pidió · cobrar por partes · el WebSocket por canal · el estado por línea · un toque agrega y el
escalón +/− ajusta · los agotados sin botón · la barra del carrito siempre visible en el teléfono ·
el módulo completo de cartelería digital.
