# El pedido del comensal — flujo, faltantes y plan

Lo que describe Ángel (28-sep-2026), textual, y cómo se implementa:

> *"el usuario cliente escanea el código y le muestra el menú, este es el primer nivel; si el
> usuario quiere pedir del menú debe dar clic en «listo para pedir», le mostrará un drawer con un
> código QR para que escanee el usuario mesero y lo pueda activar o permitir a ordenar, o que se
> le pasen 2 números de activación (en configuración de empresa se puede configurar para que no
> se pida contraseña y pueda pedir directo […] pero eso se presta a que alguien se meta desde su
> casa y por molestar haga pedidos a una mesa que no está, por eso pido una verificación), y una
> vez autorizado puede pedir todo lo que quiera hasta que se cierra su cuenta."*

## El flujo, nivel por nivel

| Nivel | Qué ve el comensal | Estado |
|---|---|---|
| 1. Carta | el menú de la tienda, con precios, agotados y promociones. Sin un botón de pedido | **Ya existe** |
| 2. «Listo para pedir» | un **drawer** con: QR de activación, **código de 2 dígitos** y la leyenda "muéstraselo al mesero". El mesero lo activa **escaneando** ese QR o **tecleando el código** en su pantalla | **Falta** |
| 3. Autorizado | la carta con controles (agregar, +/−, notas, quitar, ver el pedido, enviar a cocina) hasta que se cierra la cuenta | **Casi**: faltan los controles condicionados a la autorización y el carrito deslizable |
| 3b. Sin verificación | si la empresa lo configura, se salta el nivel 2 y pide directo (con el riesgo aceptado) | **Falta** (hoy el "sin personal" es el modo `order_and_pay`) |
| 4. Cierre | la cuenta se cierra al cobrar (o se cancela), y el permiso de pedir cae con ella | **Ya existe** (`ordering_enabled`, cobro, cancelación) |

## Modelo de datos propuesto

En `dining_participants` (la identidad de CADA dispositivo dentro de la cuenta: es lo que permite
autorizar a uno y expulsar a otro):

```
activation_code     CHAR(2)    NULL   -- lo que el comensal le enseña al mesero
activation_expires  DATETIME   NULL   -- caduca (default 10 min); se regenera al pedir otra vez
activated_at        DATETIME   NULL   -- NULL = puede mirar, no puede pedir
activated_by        INT        NULL   -- qué usuario del personal lo autorizó (auditoría)
```

En `store_settings` / `menus` (hereda la tienda, sobrescribe la carta):

```
require_activation     TINYINT  DEFAULT 1   -- 0 = pedir sin verificación (el riesgo es del dueño)
activation_minutes     INT      DEFAULT 10  -- cuánto dura el código
```

**Por qué por DISPOSITIVO y no por cuenta**: la mesa se autoriza una vez y cualquiera con el
código de 4 caracteres podría unirse desde su casa — que es exactamente el abuso que Ángel quiere
evitar. Autorizando al participante, el mesero ve la lista de dispositivos de la mesa en su
pantalla ("2 activos · 1 esperando") y puede **expulsar** al que no está. Un dispositivo sin
`activated_at` recibe 403 con un mensaje claro ("pídele al mesero que active tu pedido"), nunca un
error técnico.

El código de 2 dígitos es corto a propósito (se dicta de un vistazo), así que **debe caducar** y
ser único entre las solicitudes vivas de la tienda: al generar, si choca con otra activa, se
reintenta. Es el mismo criterio del folio de comanda (candado en la base, no "MAX+1" calculado
aparte).

## El QR de activación: dos caminos, una sola acción

- **Escaneado por el mesero**: el QR lleva `tables.html?vista=activar&c=<codigo>&p=<qr_token del
  punto>`; el mesero lo abre con la cámara y le sale EN GRANDE la mesa y el botón "Activar".
- **Tecleado**: una pantalla `tables.html?vista=activar` con un campo de 2 dígitos: el mesero
  escribe lo que le enseñó el cliente y activa.

Ambos caminos llaman al MISMO endpoint (`api/dining/activate.php`), que autoriza al participante
de ese código y avisa por WebSocket; el drawer del comensal cambia solo a "¡Listo! Ya puedes
pedir" sin recargar.

## Lo que falta, en su lista y en el sistema

| Lo que pide | Qué hay | Qué falta |
|---|---|---|
| Dividir la mesa entre comensales | `dining_participants` (uno por celular), `dining_order_items.participant_id`, `dining_sessions.split_mode` (`none/equal/by_items`), `dining_split_shares`, y el cobro por partes ya implementado | **UI**: agrupar el pedido por comensal (cada uno con su nombre/color), "esto es mío", y el reparto al cobrar desde el drawer |
| Mostrar la mesa física y ordenarla | el mapa por zonas (rejilla automática) | **Plano con posiciones**: `dining_tables.pos_x/pos_y/shape/seats` + un editor de plano en la pestaña Puntos de servicio (arrastrar y soltar, como el tablero de cocina) |
| El carrito como columna o drawer con TODO lo pedido | barra inferior en el teléfono + columna en escritorio (ya verificado) | **Swipe carta ↔ pedido** en el teléfono (hoy son pestañas) y el drawer agrupado por comensal con el estado de cada línea |
| Tableta del mesero que solo activa | el apartado del punto ya abre/cierra/cobra | **Vista "Activar"**: solicitudes en vivo (mesa + código + minutos esperando), botón grande Activar/Rechazar, y el mapa con el estado de cada mesa |
| La "espera" con contenido (ventanas) | **módulo de cartelería digital ya construido**: 8 pantallas (`digital-signage*.html`, `digital-scene`, `digital-screen-sequence`), API `api/digital_boards/*` y `api/board_slides/*`, y el editor de diapositivas. En esta base hay **0 pantallas y 0 diapositivas** configuradas | **Modo reposo de la carta**: sin toques ni scroll durante N segundos (default 60) → protector de pantalla con las **promociones activas** (la carta ya las trae) y, cuando existan, las diapositivas de la cartelería. Al tocarla, vuelve a la carta |
| Que no se pida verificación (config de empresa) | el modo `order_and_pay` (kiosko, sin personal) | el interruptor `require_activation = 0` DENTRO del flujo de cuenta abierta, con el aviso del riesgo al apagarlo |

### Reglas del modo reposo (para que no estorbe)

1. **No entra en reposo si hay algo sin enviar** en el pedido ni si el drawer de activación está
   abierto: primero el trabajo, después el escaparate.
2. Si no hay promociones ni diapositivas, **no hay protector**: se queda la carta. Una pantalla
   vacía se ve peor que una carta quieta.
3. Se respeta `prefers-reduced-motion` (sin animaciones para quien las pide fuera) y no hay audio.
4. La transición es de opacidad, sin mover el scroll, para que al volver el comensal encuentre
   donde estaba.
5. El temporizador se reinicia con cualquier toque, scroll o tecla — y también cuando llega un
   aviso de su pedido (que la mesa vea "listo" vale más que un anuncio).

## Fases propuestas

1. **El flujo tal como lo contó**: `require_activation` (+ configuración), solicitud de activación
   por dispositivo con código de 2 dígitos y QR, endpoint `activate.php`, vista "Activar" del
   mesero (tableta o celular), y los controles de la carta condicionados a la autorización.
2. **El carrito con swipe y por comensal**, en el mismo drawer: columna en escritorio, hoja
   deslizable en el teléfono, agrupado por persona.
3. **La mesa física**: plano con posiciones y asientos, editable arrastrando; el mapa del salón
   pasa a mostrar la forma real del piso.
4. **El reposo / las ventanas**: promociones activas primero (datos que ya existen), diapositivas
   de cartelería después (módulo que ya existe, solo hay que configurarlo).

## Lo que NO hay que rehacer (ya está y funciona)

Unirse con código de 4 caracteres · pausar/reanudar pedidos · atribuir cada platillo a quien lo
pidió · cobrar por partes · el WebSocket por canal (sala y cocina) · el estado por línea
("Pendiente" / "Enviado a cocina") · un clic agrega un platillo y el escalón +/− ajusta · los
agotados sin botón · la barra del carrito siempre visible en el teléfono.

## Decisiones que necesito de Ángel

1. **Quién teclea los 2 números**: ¿el comensal los MIRA y el mesero los teclea en su pantalla
   (recomendado: el mesero está físicamente ahí, así nadie de otra casa puede activarse), o el
   mesero se los dicta al comensal para que los escriba?
2. **Alcance de la autorización**: si el mesero activa un dispositivo, ¿los demás de esa mesa
   entran solos (más cómodo) o cada uno pasa por el mismo trámite (más estricto)?
3. **Con qué arranco**: por defecto propongo la Fase 1 completa (es la que desbloquea su flujo), y
   de ahí el swipe del carrito — dígame si prefiere empezar por la mesa física.
