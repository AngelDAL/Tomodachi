# Plan — Sistema de Pantalla Digital de Menús (Digital Signage Avanzado)

> Fecha: 2026-08-18 · Rama: community-edition
> Alcance: subida de imágenes robusta + edición directa + controles intuitivos
> + timeline de animaciones + multipantalla sincronizada

## Contexto

El editor de Pantallas Digitales actual (digital-signage-editor.html) soporta
crear slides con elementos de tipo rect/texto/imagen, arrastrar/estirar, y una
animación simple de APARICIÓN por elemento. El display (digital-signage-
display.html) rota una secuencia de slides EN UNA sola pantalla/TV.

Se pide evolucionarlo a un SISTEMA COMPLETO de display de menús multi-pantalla.

## Objetivos (5 módulos)

### M1 — Subida de imágenes robusta (hasta 100MB + compresión)
- Subir imágenes de hasta **100MB** (hoy 5MB).
- **Validar que realmente sea imagen** (magic bytes / getimagesize, no solo
  extensión/MIME declarado).
- **Comprimir/redimensionar en servidor** (GD disponible) para que una imagen
  de 100MB no sature el disco ni la memoria: se genera una versión optimizada
  (p. ej. máx 2400px de lado, JPEG/WebP calidad ~82) y se descarta la original
  pesada.
- **Ajustar límites PHP**: upload_max_filesize y post_max_size a >=100M, y
  memory_limit suficiente para la compresión GD (p. ej. 256M).
- Guardar metadatos (dims originales vs comprimidas) en digital_signage_media.
- Frontend: `accept="image/*"`, previsualización, indicador de progreso, y
  aviso claro de la compresión ("se optimizará a X").

### M2 — Doble clic para editar texto directamente
- Doble clic (dblclick) sobre un elemento de texto en el canvas despliega un
  editor inline (contenteditable o textarea superpuesto) que edita `el.text`
  en vivo, sin ir al panel de propiedades.
- Doble click también útil para imágenes/rect (abre el buscador de sección).
- Respetar touch: en móvil, "doble tap" o botón de lápiz en la selección.

### M3 — Controles intuitivos (iconos + organización clara)
- Reorganizar el panel de propiedades en **secciones con encabezados e iconos**
  agrupadas por: Contenido, Apariencia, Posición/Tamaño, Animación/Tiempo, Capas.
- Atajos de iconos contextuales sobre el elemento seleccionado (duplicar,
  borrar, traer al frente, enviar atrás, editar texto, bloquear).
- Toolbar de canvas: zoom, ajustar a pantalla, y estado de orientación.
- Todo con iconos FontAwesome y tooltips; nada "escondido".

### M4 — Timeline de animaciones (aparición Y desaparición)
- Cada elemento pasa a tener **entrada** y **salida** (hoy solo entrada).
- Un control **tipo timeline** por elemento: momento de inicio (delay), duración,
  efecto de entrada, efecto de salida, y opcionalmente animación continua (loop).
- Efectos soportados (entrada/salida): fade, slide_up, slide_left, slide_down,
  slide_right, scale_in, scale_out, rotate_in, bounce_in.
- El display aplica la salida (remueve el elemento con su efecto) y respeta el
  timeline: cada elemento aparece/desaparece en SU momento.
- Persistir en `content` (rect.animation_* / timeline JSON).

### M5 — Multipantalla sincronizada (varias TVs mostrando el mismo menú)
El corazón del pedido: 2-3 pantallas (p. ej. Postres + Bebidas) trabajan como un
**grupo sincronizado** con una única secuencia coordinada.

Modelo de datos propuesto (revisar antes de migrar):
- Nueva tabla `display_groups` (id, store_id, name, is_active).
- Nueva tabla `display_group_screens` (id, group_id, screen_index 0..N,
  board_id/layout del display, position en el group).
- La **secuencia** vive a nivel de grupo: `display_group_slides` (group_id,
  position, source_slide_id o layout). Cuando avanza el grupo, TODAS las
  pantallas avanzan a su slide correspondiente.
- **Offsets de tiempo por pantalla**: cada screen tiene un `delay_ms`
  opcional (p. ej. pantalla izq inicia en 0s, centro en 0.3s, derecha en 0.6s)
  para el efecto "cascada".
- El display público nuevo (`digital-signage-group.html?group=X`) renderiza
  un grid de N pantallas, cada una con su slide actual, y sincroniza el avance
  (un solo timer; cada pantalla aplica sus transiciones con su delay).

Composición: en vez de "board = secuencia completa", un grupo define layout de
pantallas y cada pantalla apunta a un board/contenido. Reutiliza slides maestras.

## Dependencias y orden sugerido
1. M4 (timeline) sobre editor + display → prepara el motor de timing que M5 usa.
2. M2 y M3 (UX editor) → mejoras al editor que no dependen de M5.
3. M1 (subida) → backend independiente, puede ir en paralelo con M2/M3.
4. M5 (multipantalla) → al final, usa el motor de timing de M4 y el modelo de
   grupos (BD + endpoints + nuevo display).

## Riesgos
- Bloqueo por limite PHP 2M/8M: exige tocar config del contenedor (Dockerfile/
  php.ini) + rebuild. Verificar que subir 100MB comprima bien.
- M5 cambia el modelo conceptual de "board" → riesgo de romper boards existentes.
  Se diseñará como ADDITIVO (no migra boards actuales; solo agrega grupos).
- Todos los módulos tocan digital-signage-editor.html (repositorio único con
  build docker, sin bind mount) → implementar SECUENCIALMENTE, no en paralelo
  sobre el mismo archivo, para evitar conflictos de merge.
- Touch: M2 (doble clic) debe preservar drag/resize táctil.

## Criterios de aceptación
- Subir PNG/JPG/WebP/GIF de hasta 100MB → se optimiza y se muestra; tipos
  inválidos rechazados; el servidor no se llena (compresión funciona).
- Doble clic edita texto inline sin ir al panel.
- Panel de propiedades agrupado con iconos; controles visibles.
- Elementos con entrada+salida+delay según timeline en el display.
- Grupo de 3 pantallas: al avanzar, las 3 cambian a la vez, con offset .3s
  cada una (cascada). Todo dentro de una URL publica de grupo.
- Suite 33/33 sigue pasando; boards existentes intactos.
