# El pedido del comensal — activación por números (o su QR), mesa sin cliente y modo reposo

Diseño acordado con Ángel (28-sep-2026), con las cuatro situaciones que él mismo puso sobre la
mesa. Este documento es el que se implementa; la primera versión (solo "el mesero ve la mesa")
quedó sustituida.

## El flujo

**El comensal**

1. Escanea el QR de la mesa → ve la carta (nivel 1: solo mirar).
2. Toca **"Listo para pedir"**.
3. Aparece el drawer con **dos números** (`4 7`) **y el MISMO par en un QR** (el QR no es otra cosa:
   es ese par, para no dictarlo en voz alta ni equivocarse de dedo).
4. Su pantalla queda en *"Esperando a que te activen…"* y **se pone sola en verde** al ser activado
   (WebSocket, sin refrescar).
5. Ya activado: pide todo lo que quiera (un toque agrega, +/− ajusta, notas por platillo, quitar,
   ver el pedido, enviar a cocina) hasta que se cierra la cuenta.

**El mesero** (`tables.html?vista=activar`, tableta o celular)

1. Ve en vivo las mesas con gente **en espera**, desde que alguien escanea el QR.
2. **Escanear el QR del cliente** o **teclear los dos números**: mismo endpoint, misma acción.
3. Con **una sola** persona en esa mesa: botón directo **"Activar mesa 3"** (sin números: no hay
   ambigüedad). La acción sigue siendo suya — automático dejaría pedir a cualquiera con un enlace.
4. Con **dos o más**: cada dispositivo tiene su par; el mesero activa **a uno a la vez** ("¿quién
   tiene el 47?"). Los demás siguen esperando con el suyo.
5. Herramientas: **Rechazar** una solicitud, **Expulsar** un dispositivo, **Reiniciar la mesa**
   (todos los dispositivos de esa cuenta, sin cerrarla) y **Integrar cliente** (ver abajo).

**Configuración de empresa** · `require_activation = 0` permite pedir directo; el aviso al apagarlo
dice el riesgo con todas sus letras ("cualquiera con el enlace de una mesa puede pedir sin estar
ahí"). `activation_minutes` (10) es la vida del par.

## Modelo de datos

`dining_participants` (una fila por DISPOSITIVO: es lo que permite autorizar a uno y expulsar a
otro sin tocar a los demás):

```
activation_code     CHAR(2)  NULL   -- los dos números; el QR los codifica
activation_expires  DATETIME NULL   -- caducan (10 min) y se regeneran
activated_at        DATETIME NULL   -- NULL = mira pero no pide
activated_by        INT      NULL   -- quién del personal lo autorizó (auditoría)
rejected_at         DATETIME NULL   -- el mesero rechazó esta solicitud
```

`store_settings` (override por carta en `menus`): `require_activation`, `activation_minutes`,
`max_devices_per_check` (0 = sin tope explícito; en la Fase 3 usa los asientos de la mesa).

Reglas del emparejamiento:

1. **Únicos en TODA la tienda** entre solicitudes vivas (dos mesas con "47" al mismo tiempo es un
   error garantizado en el mostrador). Si choca al generar, se reintenta: candado en la base, no
   cálculo aparte (mismo criterio que el folio de comanda).
2. **El QR y el par de números son lo mismo**: un QR escaneado y un par tecleado producen la misma
   autorización. Escanear evita dictar en un lugar con ruido y el error de dedo.
3. **Presencia ≠ solicitud.** El dispositivo aparece como PRESENTE desde que abre la carta (el mesero
   ya sabe que hay alguien en la mesa); el par se genera solo al tocar "Listo para pedir".
4. **Caducan y se limpian solas** (`activation_minutes`, y `last_seen_at` para el que dejó de latir).
   Un dispositivo que lleva rato sin latir **no se expulsa solo** (puede estar en el bolsillo del
   cliente): se marca "inactivo hace N min" y el mesero decide.
5. Un dispositivo sin `activated_at` que intente pedir recibe 403 con mensaje de persona: "Pídele a
   quien te atiende que active tu pedido".

## La mesa que el mesero atiende solo (sin cliente con teléfono)

- La cuenta puede existir **sin un solo participante**: es el caso del cliente que llega sin
  teléfono y el mesero anota todo. Cada platillo queda como `added_by='staff'` (ya funciona hoy).
- **Integrar cliente**: si después el cliente quiere pedir desde su teléfono, el mesero lo integra a
  la cuenta que YA está sirviendo — es el mismo flujo de activación, pero la solicitud se liga a la
  sesión abierta de ese punto **sin abrir una nueva**. Desde ese momento el cliente ve **toda la
  cuenta** (lo que anotó el mesero + lo suyo) y puede agregar.
- **Si el punto NO tiene cuenta abierta** y el mesero activa una solicitud: el sistema abre la cuenta
  en ese mismo toque y se lo dice ("no había cuenta: se abrió la de la Mesa 3"). Es el caso del
  cliente que llega primero, sin mesero cerca.

## El dispositivo que ya no pertenece a la mesa

El caso que puso Ángel: alguien veía el menú, se fue (o alguien de fuera tiene el enlace) y entra una
persona nueva **sin teléfono**; el dispositivo viejo sigue autorizado y podría interrumpir el pedido
de esa mesa. Herramientas, de menor a mayor:

1. **Expulsar** un dispositivo (el mesero ve la lista: cuántos activos, cuántos esperando, quién
   lleva rato sin latir).
2. **Reiniciar la mesa**: expulsa a TODOS los dispositivos de esa cuenta **sin cerrarla** — para
   cuando el consumo sigue pero los que están sentados son otros.
3. **Cerrar o cobrar la cuenta invalida a todos** automáticamente: una cuenta cerrada no deja
   ningún permiso vivo. Al reabrir esa mesa se arranca sin dispositivos.
4. Un expulsado puede volver a pedir activación (solicitud nueva, par nuevo). Expulsar no es un
   castigo permanente, es limpiar la mesa.

## Observaciones (respuesta a las tres de Ángel)

1. **De acuerdo: prueba simple + factor humano.** El par de números/prueba de presencia demuestra que
   **esa persona** está pidiendo; el juicio del mesero cubre el resto. Queda escrito así en el
   diseño para que nadie lo "endurezca" por su cuenta ni lo venda como autenticación fuerte.
2. **De acuerdo: "pasa directo" es un toque del mesero**, porque su escenario del dispositivo que se
   quedó colgado es real. Y con la lista de dispositivos + Reiniciar mesa, el mesero tiene con qué
   responder cuando la mesa cambió de gente.
3. **De acuerdo: la integración la hace el mesero.** El control de "Integrar cliente" es explícito
   (no automático) porque él es quien sabe quién está sentado; a partir de la integración el cliente
   ve la cuenta completa y puede agregar.

## Lo que el comensal LEE (texto propuesto)

**Drawer de activación · título:** `Para pedir, que te activen`

- **1.** Dile estos dos números a quien te atiende —o muéstrale este código: → **`4 7`** + su QR
- **2.** En cuanto los escriba o lo escanee, esta pantalla te avisa sola.
- *Son de este dispositivo. Nadie más puede pedir por ti.*
- `Esperando a que te activen…` → **"Listo, ya puedes pedir. Toca lo que quieras del menú."**
- Si vencen: **"Los números vencieron. Tócalos para generar otros."**
- Botón secundario: `Solo quiero ver la carta`

**Pantalla del mesero**

- `Mesa 3 · 1 esperando` → **`Activar mesa 3`**
- `Mesa 3 · 3 esperando` → campo `Número` o botón `Escanear` + `Activar` (los demás se quedan)
- Cada renglón: mesa, minutos esperando, `Rechazar` · y por mesa: `Reiniciar mesa`, `Integrar cliente`

## El modo "Espera" (reposo) — por DESTINO, no "todas las promos"

- La carta pide **las diapositivas asignadas al destino `mesa`** de esa tienda; no filtra por su
  cuenta ni muestra todas las activas.
- El módulo de cartelería digital (ya construido: 8 pantallas, editor, API de tableros y
  diapositivas) se usará en varios entornos, así que hace falta un **destino** por pantalla y por
  asignación: `display`, `caja`, `kiosko`, `mesa`, `estacion`.
- Sin ninguna asignada para `mesa`, **no hay protector**: se queda la carta (mejor que una pantalla
  vacía). Una diapositiva podrá marcarse "solo si la promoción está vigente".
- Convivencia: no entra si hay algo sin enviar ni si el drawer de activación está abierto; sin audio;
  respeta `prefers-reduced-motion`; y se reinicia también cuando llega el aviso "tu pedido está
  listo".

## Fases

1. **Activación (números + QR) + pantalla del mesero + Integrar cliente + Expulsar/Reiniciar mesa +
   configuración de empresa**, con el WebSocket de presencia desde el primer paso.
   → **Hecha la activación, la pantalla del mesero, Expulsar y Reiniciar mesa** (commit
   `d68f482`). Queda **Integrar cliente** en una cuenta ya servida.
2. **Carrito con swipe y por comensal** (columna en escritorio, hoja deslizable en el teléfono).
   → **Hecha (29-sep-2026).** La hoja del pedido se arrastra por su asa (70dvh ↔ 92dvh y se
   cierra), el total y "Enviar a cocina" quedan pegados abajo, **deslizar un platillo propio lo
   quita con Deshacer**, y la lista va **por comensal**: "Tú" primero, separador "De la mesa" y
   cada grupo con sus piezas y su subtotal. El repintado (sondeo/WebSocket) se aplaza mientras
   hay un dedo encima para no romper el gesto.
3. **Mesa física**: `pos_x/pos_y/shape/seats` + editor de plano; el tope de dispositivos usa los
   asientos.
4. **Modo reposo** con las diapositivas del destino `mesa`.

## Decisiones que faltan

1. ¿**Quién** puede activar, integrar y reiniciar: cualquier personal autenticado (recomendado) o
   solo admin/gerente?
2. Al activar una solicitud de un punto **sin cuenta abierta**: ¿se abre la cuenta en ese toque
   (recomendado, con aviso) o se le pide al mesero abrirla primero?
3. **Reiniciar mesa** vs. cerrar y reabrir: ¿quieres las dos (recomendado) o solo el cierre normal?

## Lo que NO hay que rehacer

Unirse con el código de 4 caracteres · pausar/reanudar · atribuir cada platillo a quien lo pidió ·
cobrar por partes · WebSocket por canal · estado por línea · un toque agrega y +/− ajusta · agotados
sin botón · barra del carrito siempre visible en el teléfono · el módulo completo de cartelería
digital · la cuenta sin participantes (`added_by='staff'`).
