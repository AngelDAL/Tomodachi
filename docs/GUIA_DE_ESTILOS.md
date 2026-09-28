# Guía de Estilos — Tomodachi POS

Documento normativo de la interfaz. Aplica a **todo** el frontend de
Tomodachi (Punto de Venta, Inventario, Dashboard, Clientes, Promociones,
Finanzas, Reportes, Puntos de servicio, Mesas, Pantallas Digitales,
Integraciones, Perfil, el menú público y las páginas públicas de acceso).

Léelo completo antes de escribir una línea de HTML, CSS o JS de interfaz. Si
algo de esta guía contradice tu gusto personal, gana la guía. Si crees que la
guía está mal, se cambia la guía primero y después el código — nunca al revés.

- **Versión:** 1.0
- **Última revisión:** 2026-09-28
- **Fuente única de verdad del estilo:** `public/css/variables.css` (tokens) y
  `public/css/design-system.css` (forma de los componentes)
- **Catálogo visual vivo:** `public/design-system.html` (Perfil de Estilos v1.3)
- **Lint automático:** `scripts/verificar-estilos.sh`
- **Tokens para agentes:** `DESIGN.md` (raíz del repo, formato Google DESIGN.md)

---

## Índice

1. [Cómo usar esta guía](#1-cómo-usar-esta-guía)
2. [Principios de diseño](#2-principios-de-diseño)
3. [Reglas de oro](#3-reglas-de-oro)
4. [Arquitectura de estilos](#4-arquitectura-de-estilos)
5. [Tokens](#5-tokens)
6. [Layout y estructura de página](#6-layout-y-estructura-de-página)
7. [Componentes](#7-componentes)
8. [Capas: modales, drawers y overlays](#8-capas-modales-drawers-y-overlays)
9. [Feedback al usuario](#9-feedback-al-usuario)
10. [Estados de pantalla](#10-estados-de-pantalla)
11. [Temas claro y oscuro](#11-temas-claro-y-oscuro)
12. [Animaciones](#12-animaciones)
13. [Accesibilidad](#13-accesibilidad)
14. [Iconografía](#14-iconografía)
15. [Contenido y textos](#15-contenido-y-textos)
16. [Responsive](#16-responsive)
17. [Anti-patrones y deuda conocida](#17-anti-patrones-y-deuda-conocida)
18. [Cómo añadir un componente nuevo](#18-cómo-añadir-un-componente-nuevo)
19. [Checklist de revisión](#19-checklist-de-revisión)
20. [Verificación](#20-verificación)

---

## 1. Cómo usar esta guía

**Si eres una persona nueva en el repositorio:** lee las secciones 2, 3 y 4
antes de tocar nada. Con eso ya no vas a inventar un estilo distinto. Cuando
vayas a construir algo concreto, salta a la sección de componentes (7) o de
capas (8).

**Si eres un agente de IA:** carga `DESIGN.md` para los valores numéricos y
esta guía para las reglas de aplicación. Antes de dar por terminado un cambio
de interfaz, corre `bash scripts/verificar-estilos.sh` y corrige lo que
reporte.

**Regla de convivencia:** el catálogo `public/design-system.html` es la
referencia visual. Si tu pantalla nueva no se parece a lo que se ve ahí, algo
está mal en tu pantalla, no en el catálogo.

---

## 2. Principios de diseño

1. **Una sola identidad.** Cian Hatsune (`#39C5BB`) como único color de
   marca. El resto de la paleta son superficies neutras y colores de estado.
2. **Superficies suaves, no planas.** Fondos casi blancos (o casi negros en
   oscuro), tarjetas con sombra suave y esquinas redondeadas. Nada de bordes
   duros de 1px negro ni de degradados estridentes.
3. **Forma cápsula para lo accionable.** Botones, badges, tabs y toggles son
   cápsulas (radio 100px). Cards, modales e inputs usan radios de 14 a 20px.
4. **Textura sutil, nunca ruido.** El fondo lleva un patrón SVG monocromático
   al 3% de opacidad. Es un detalle, no un protagonista.
5. **Densidad de herramienta, no de folleto.** Tomodachi se usa en mostrador
   con prisa: información densa, jerarquía clara, cero decoración inútil.
6. **Consistencia antes que originalidad.** Si el componente ya existe, se
   reutiliza. Inventar una variante nueva exige justificarlo.
7. **Accesible por defecto.** Todo se ve bien en claro y en oscuro, se opera
   con teclado y tiene contraste suficiente.

---

## 3. Reglas de oro

Estas reglas no son sugerencias. El lint (`scripts/verificar-estilos.sh`)
detecta varias de forma automática.

### 3.1 Prohibido: emojis

Ningún emoji en la interfaz, ni en texto, ni en `placeholder`, ni en mensajes,
ni en comentarios de código visible al usuario, ni en respuestas de la API que
se pinten en pantalla. Nada de `🎉  🚀  ✅  ❌`.

En su lugar: iconos FontAwesome (`<i class="fas fa-check"></i>`) o un glifo
tipográfico simple. El proyecto ya usa `\f00c`, `\f00d`, `\f129`, `\f12a` en
los `::before` de las notificaciones.

### 3.2 Prohibido: `alert()`, `confirm()` y `prompt()`

Bloquean el hilo, no son estilizables y rompen la sensación de aplicación.

- Mensaje informativo o resultado de una acción → `showNotification(mensaje, tipo)`
- Confirmación de una acción destructiva → `<dialog>` propio con botón
  "Eliminar" y botón "Cancelar"
- Captura de un dato → formulario en modal o drawer, nunca `prompt()`

Deuda actual conocida (medida el 2026-09-28 sobre community-edition): quedan 8
llamadas bloqueantes — `sales.js` (2), `finance.js` (2), `tables.js` (2), y una
cada una en `PlanManager.js`, `promotions.js`, `super_admin.js` y `cobro.js`.
`inventory.js` ya se migró por completo: es el ejemplo de cómo se hace. Cada
quien que toque una de las que quedan, la migra.

### 3.3 Prohibido: colores en duro

Ningún `#hex`, `rgb()` ni nombre de color CSS en archivos de módulo. Todo sale
de los tokens de `variables.css`. La única excepción tolerada es `#fff` para
texto sobre superficies oscuras y los colores dentro de los `url("data:image/svg+xml...")`.

Motivo medible: `public/css/inventory.css` es el peor caso con 244 colores en
duro (22 de ellos `#4fddd2`, el cian del **tema oscuro**), seguido de
`sales.css` (70) y `main.css` (103). Resultado: esas vistas no siguen el tema y
hay que retocarlas a mano cada vez que la paleta se mueve.

### 3.4 Prohibido: modales sobre modales

Ver sección 8. Un modal a la vez, por regla. Si un flujo de verdad exige una
segunda capa, se usa `--capa-overlay-2` de la escalera, nunca un `z-index`
inventado a mano.

### 3.5 Prohibido: `?v=` olvidado

Todo `<link>` a un CSS del proyecto lleva su query de caché (`?v=N`). Si
modificas un archivo, súbele el número. El navegador y Cloudflare cachean
agresivamente.

### 3.6 Obligatorio: probar en claro y en oscuro

Ninguna pantalla se considera terminada si solo se vio en un tema.

### 3.7 Obligatorio: sidebar y contenedor estándar

Toda vista interna usa la sidebar común (cargada por `js/sidebar-loader.js`) y
el contenedor `.main-content`. No se implementa navegación propia.

### 3.8 Obligatorio: español con acentos

`Menú`, no `menu`. `Contraseña`, no `contrasena`. Ortografía profesional en
labels, mensajes y textos de botón.

### 3.9 Obligatorio: textos de botón específicos

Acción principal: "Guardar", "Crear", "Actualizar", "Cobrar". Destructiva:
"Eliminar", "Cancelar venta". Cancelar: "Cancelar". Nunca "OK", "Sí", "Aceptar"
como acción principal.

---

## 4. Arquitectura de estilos

### 4.1 Orden de carga obligatorio

Este orden es el que ya usan `dashboard.html`, `inventory.html` y `sales.html`.
Respétalo tal cual:

```html
<link rel="stylesheet" href="css/fonts.css?v=4">
<link rel="stylesheet" href="lib/fontawesome/css/all.min.css?v=4">
<link rel="stylesheet" href="css/main.css?v=22">
<link rel="stylesheet" href="css/design-system.css?v=8">
<link rel="stylesheet" href="css/sidebar-modern.css?v=6">
<link rel="stylesheet" href="css/mobile-nav.css?v=5">
<link rel="stylesheet" href="css/dashboard.css?v=4">
<link rel="stylesheet" href="css/<modulo>.css?v=N">   <!-- solo si hace falta -->
```

Los números suben con cada cambio; los de arriba son los vigentes al 2026-09-28.

`design-system.css` va **después** de `main.css` a propósito: refina radios,
sombras, tipografía y animaciones de los componentes base. Si un módulo
necesita su propia hoja, va al final para poder sobrescribir.

`variables.css` no se enlaza en las vistas internas: entra por `@import` desde
`main.css` (y desde `landing.css`). Si tocas `variables.css`, sube el `?v=` de
**ese** `@import` y también el de `main.css` en los HTML — si no, el navegador
sigue sirviendo la hoja vieja y el cambio no se ve.

### 4.2 Qué archivo tocar según lo que quieras hacer

| Quiero cambiar... | Archivo |
|---|---|
| Un color, radio, sombra o tipografía global | `public/css/variables.css` |
| La forma/animación de un componente base (botón, card, tabla, modal) | `public/css/design-system.css` |
| Estilos de un componente muy antiguo que aún no migra | `public/css/main.css` |
| El sidebar flotante | `public/css/sidebar-modern.css` |
| La navegación móvil inferior | `public/css/mobile-nav.css` |
| Solo mi módulo (POS, inventario, reportes) | `public/css/<modulo>.css` |

Nunca se meten estilos de un módulo dentro de `main.css`, ni tokens dentro de
un módulo.

### 4.3 Convención de nombres de clase

- Componente base: `.btn`, `.card`, `.badge`, `.modal`, `.drawer`, `.tabs`.
- Variante: `.btn-solid`, `.badge-success`, `.card-header`.
- Prefijo de módulo para lo específico: `.pos-*`, `.inv-*`, `.dashboard-*`,
  `.promo-*`.
- Estado: `.active`, `.is-open`, `.show`, `.disabled`, `.loading`, `.selected`.
- Utilidad puntual: `.ds-flex`, `.ds-between`, `.ds-gap-8`.

No inventes abreviaturas nuevas. Si dudas, busca la clase existente:

```bash
grep -rn "nombre-aproximado" public/css/main.css public/css/design-system.css
```

---

## 5. Tokens

Todos viven en `public/css/variables.css`. **Nunca escribas el valor, usa la
variable.**

### 5.1 Color de marca

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--primary-color` | `#39C5BB` | `#49D4C6` | Marca, acción principal, foco, acentos |
| `--primary-dark` | `#2CB1A7` | `#32BDAF` | Hover de la acción principal |
| `--primary-darker` | `#1F8A82` | `#2C9B90` | Active/pressed |
| `--primary-light` | `#E4F8F6` | `#193331` | Fondo suave de elementos de marca |
| `--primary-lighter` | `#F0FBFA` | `#152826` | Fondo casi imperceptible |
| `--primary-shadow` | `rgba(57,197,187,.22)` | `rgba(73,212,198,.28)` | Sombra / anillo de foco |
| `--primary-ink` | `#177068` | `#49D4C6` | **Texto** de marca sobre superficie (5.91:1 en claro) |
| `--secondary-color` | `#0E86A6` | `#51BCD6` | Acento secundario (con texto oscuro encima) |
| `--secondary-dark` | `#0A6A86` | `#33A5C1` | Fondo del botón "Guardar" (blanco encima) |

Alias listos para usar: `--primary-hover`, `--primary-active`,
`--primary-focus-ring`.

### 5.2 Color de estado

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--success-color` / `-dark` | `#2E7D32` / `#1B5E20` | `#5DB660` / `#4AA34E` | Pagado, en stock, confirmación |
| `--danger-color` / `-dark` | `#D32F2F` / `#B71C1C` | `#EA5A57` / `#D84845` | Cancelado, eliminar, error |
| `--warning-color` / `-dark` | `#F57C00` / `#E65100` | `#F69A31` / `#E08420` | Pendiente, stock bajo, atención |
| `--warning-ink` | `#A34A00` | `#F69A31` | Texto ámbar sobre superficie (badges de "Pendiente") |
| `--info-color` / `-dark` / `-light` | `#1976D2` / `#0D47A1` / `#E3F2FD` | `#50A0E2` / `#3B8CD0` / `#14293D` | Información neutra |

### 5.3 Superficies, texto y bordes

| Token | Función |
|---|---|
| `--bg-body` | Fondo de la aplicación |
| `--bg-card` | Superficie de tarjeta, modal, drawer, tabla |
| `--bg-light` / `--bg-lighter` / `--bg-lightest` | Superficies de menor jerarquía (cabeceras de card, secciones) |
| `--bg-input` | Fondo de campos de formulario |
| `--bg-hover` | Fondo de fila/ítem al pasar el cursor |
| `--text-color` | Texto principal |
| `--text-medium` | Texto secundario |
| `--text-light` | Texto terciario |
| `--text-muted` | Texto auxiliar, placeholders, hints |
| `--text-on-primary` | Texto sobre superficie primaria cian |
| `--border-color` | Borde estándar (inputs, tabs, divisores marcados) |
| `--border-light` / `--border-lighter` | Bordes suaves (contornos de card, separadores internos) |

En tema oscuro las superficies son una rampa con tinte azul-teal, la misma
familia que el `#f4f7f6` del claro: `--bg-body` `#0D1516`, `--bg-card`
`#162022`, `--bg-light` `#1D282B`. No metas grises neutros ni negros puros:
desentonan con la marca.

### 5.4 Regla de texto sobre color

`#fff` sobre el cian de marca **no pasa contraste** (2.13:1 en claro; 2.21:1
sobre el secundario del tema oscuro). Sobre `--primary-color` va
`--text-on-primary` (`#08352F`, 6.33:1 en claro; `#06302C`, 7.85:1 en oscuro).
Sobre `--warning-color` va `--warning-ink` o texto oscuro, nunca blanco.

### 5.5 Tipografía

Dos familias, sin excepciones:

- Encabezados y controles: `var(--font-heading)` → **Sora**
- Cuerpo de texto: `var(--font-body)` → **Inter**

Quedan prohibidas otras familias. Deuda: `sidebar-modern.css` pide `Nunito`
(nunca se carga, así que cae al fallback), y `tables.html` y `comandas.js`
traen la suya propia. Se corrigen cuando se toque cada archivo.

Las fuentes se sirven **localmente**: `css/fonts.css` declara los `@font-face`
de Sora e Inter (archivos en `lib/fonts/`) y de Google Sans Flex, que usan las
páginas públicas. Prohibido volver a enlazar Google Fonts, cdnjs o cualquier
CDN: la interfaz tiene que verse igual sin internet. FontAwesome también vive
en el repo (`lib/fontawesome/`).

| Token | Valor | Uso típico |
|---|---|---|
| `--font-size-xs` | `0.75rem` | Etiquetas de tabla en mayúsculas, meta |
| `--font-size-sm` | `0.875rem` | Texto secundario, hints |
| `--font-size-md` | `1rem` | Cuerpo |
| `--font-size-lg` | `1.125rem` | Subtítulos |
| `--font-size-xl` | `1.375rem` | Título de sección |
| `--font-size-2xl` | `1.75rem` | Título de página |

### 5.6 Radios

| Token | Valor | Uso |
|---|---|---|
| `--ds-radius-sm` | `10px` | Elementos pequeños, ítems de menú |
| `--ds-radius-md` | `14px` | Inputs, selects, tablas |
| `--ds-radius-lg` | `20px` | Cards, modales, drawers, stages |
| `--ds-radius-pill` | `100px` | Botones, badges, tabs, toggles |

Existen además `--border-radius` (8px) y `--border-radius-sm` (6px) de la capa
antigua. En código nuevo usa los `--ds-*`.

### 5.7 Sombras

| Token | Uso |
|---|---|
| `--ds-shadow-sm` | Reposo de elementos pequeños |
| `--ds-shadow-md` | Reposo de cards y paneles |
| `--ds-shadow-lg` | Hover de card, modal, drawer |
| `--shadow-primary` | Sombra de acción principal |

### 5.8 Transiciones

| Token | Valor | Uso |
|---|---|---|
| `--transition-fast` / `--dur` | `.15s` / `.28s cubic-bezier(.4,0,.2,1)` | Cambios de color, hover |
| `--dur-spring` | `.38s cubic-bezier(.34,1.56,.64,1)` | Rebote suave (toggles, tabs) |
| `--dur-soft` | `.5s cubic-bezier(.16,1,.3,1)` | Revelados, aparición de contenido |
| `--transition-normal` | `.3s ease` | Genérico |
| `--transition-slow` | `.5s ease` | Salidas amplias |

Nunca escribas una duración suelta tipo `0.2s` si existe token.

### 5.9 Espaciado

El proyecto no tiene una escala formal: hay valores sueltos de 4, 6, 8, 10, 12,
14, 16, 18, 20, 24, 30, 40. Mientras se formaliza, respeta esta escala de
trabajo (múltiplos de 4) y no inventes 13px ni 27px:

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40`

### 5.10 Capas (`z-index`)

El proyecto **ya tiene una escalera formal** en `variables.css`. Úsala: no
inventes números. Existe porque un modal con `z-index: 20300` quedaba debajo de
la barra de navegación móvil (`99999`) y aparecía cortado.

| Token | Valor | Para qué |
|---|---|---|
| `--capa-contenido` | `1` | Tarjetas, listas, el flujo normal |
| `--capa-encima` | `100` | Menús y desplegables dentro de la página |
| `--capa-navbar` | `99999` | Barra de navegación (inferior en móvil) |
| `--capa-overlay` | `100000` | **Todo** modal y drawer |
| `--capa-overlay-2` | `100100` | Modal que se abre desde otro modal |
| `--capa-aviso` | `200000` | Avisos, notificaciones, diálogos que van sobre todo |

Regla: la barra de navegación es lo más alto del **contenido**, y cualquier
modal o drawer va por encima de ella, sin excepción. Quedan `z-index` crudos
sueltos en algunas hojas (`1000` y `100` sobre todo): al tocar un archivo con
alguno, cámbialo por el token que corresponda.

### 5.11 Layout

| Token | Valor |
|---|---|
| `--sidebar-desktop-width` | `250px` |
| `--sidebar-collapsed-width` | `80px` |
| `--sidebar-gap` | `16px` |
| `--sidebar-border-radius` | `12px` |
| `--topbar-height` | `60px` |

---

## 6. Layout y estructura de página

### 6.1 Estructura estándar de una vista interna

```html
<aside class="sidebar">
  <!-- La sidebar la inyecta js/sidebar-loader.js. No la copies a mano. -->
</aside>

<main class="main-content">
  <!-- Encabezado de la vista -->
  <header class="page-header">
    <h1 class="page-title"><i class="fas fa-box"></i> Inventario</h1>
    <p class="page-subtitle">Productos, stock y movimientos</p>
    <div class="page-actions">
      <button class="btn btn-solid"><i class="fas fa-plus"></i> Nuevo Producto</button>
    </div>
  </header>

  <!-- Tarjetas KPI (si aplica) -->
  <section class="stats-grid">
    <article class="stat-card">
      <div class="stat-icon"><i class="fas fa-box-open"></i></div>
      <div class="stat-info">
        <span class="stat-title">Valor inventario</span>
        <span class="stat-value" data-count="24159" data-prefix="$">$24,159.00</span>
      </div>
    </article>
  </section>

  <!-- Contenido -->
  <section class="list-section">
    <div class="card">
      <div class="card-header"><h3><i class="fas fa-list"></i> Productos</h3></div>
      <div class="table-responsive">
        <table class="dashboard-table"><!-- ... --></table>
      </div>
    </div>
  </section>
</main>
```

Puntos que no se negocian:

- La sidebar es flotante: el `main-content` ya lleva su margen y su padding
  (`30px 40px`) desde `sidebar-modern.css`. No agregues padding propio al body.
- El título de página siempre con icono FontAwesome a la izquierda.
- La acción principal de la vista va arriba a la derecha, una sola, y es
  `btn-solid`.

### 6.2 Grids

- Tarjetas KPI: `.stats-grid` (el módulo define cuántas columnas).
- Tarjetas de contenido: `display:grid` con
  `repeat(auto-fill, minmax(230px, 1fr))` y `gap: 18px`, como en el catálogo.
- POS: dos columnas (productos / carrito) con `.pos-content-grid`; el carrito
  es fijo y con scroll propio.

---

## 7. Componentes

Todos los ejemplos de esta sección salen del catálogo real
(`public/design-system.html`) y de las clases ya definidas en
`design-system.css`.

### 7.1 Botones

Base: `.btn` (cápsula, Sora 600, 11-12px de alto de padding, icono opcional).

```html
<button class="btn btn-solid"><i class="fas fa-plus"></i> Nuevo</button>
<button class="btn btn-dark">Guardar</button>
<button class="btn btn-outline">Cancelar</button>
<button class="btn btn-soft"><i class="fas fa-tag"></i> Promoción</button>
<button class="btn btn-success-soft"><i class="fas fa-check"></i> Pagado</button>
<button class="btn btn-danger-soft"><i class="fas fa-trash"></i> Eliminar</button>
<button class="btn btn-ghost">Ver más</button>
<button class="btn btn-solid btn-icon"><i class="fas fa-cog"></i></button>
```

| Variante | Cuándo |
|---|---|
| `btn-solid` | Acción principal de la pantalla. Una por vista. |
| `btn-dark` | Acción secundaria de peso (Guardar en formularios) |
| `btn-outline` | Cancelar, alternativas |
| `btn-soft` | Acción de menor peso sobre tarjeta |
| `btn-success-soft` | Confirmar estado positivo |
| `btn-danger-soft` | Destructiva |
| `btn-ghost` | Terciaria, dentro de filas de tabla |

Tamaños: `btn-lg`, `btn-sm`, `btn-block`. Estado de carga:
`.btn.loading` (desactiva clics y gira el icono).

Prohibido: `<a class="btn">` sin `role="button"` cuando no navega, y
`onclick` inline en el HTML.

### 7.2 Badges y estados

```html
<span class="badge badge-primary"><i class="fas fa-circle dot"></i> En stock</span>
<span class="badge badge-success"><i class="fas fa-check"></i> Pagado</span>
<span class="badge badge-warning"><i class="fas fa-clock"></i> Pendiente</span>
<span class="badge badge-danger"><i class="fas fa-xmark"></i> Cancelado</span>
<span class="badge badge-outline"><i class="fas fa-circle"></i> Borrador</span>
```

El badge siempre lleva icono. El estado nunca se comunica solo por color.

### 7.3 Cards

```html
<article class="card">
  <div class="card-header"><h3><i class="fas fa-chart-line"></i> Ventas del día</h3></div>
  <div class="card-body"><!-- contenido --></div>
</article>
```

- Radio 20px, sombra `--ds-shadow-md`.
- La cabecera puede llevar la textura sutil (`.card-header` ya la trae).
- Una card no se usa como contenedor de página completa; para eso existe
  `.panel` / secciones.

### 7.4 KPIs

```html
<article class="stat-card">
  <div class="stat-icon"><i class="fas fa-sack-dollar"></i></div>
  <div class="stat-info">
    <span class="stat-title">Ventas del día</span>
    <span class="stat-value" data-count="1250.5" data-prefix="$" data-decimals="2">$1,250.50</span>
    <span class="stat-trend badge badge-success"><i class="fas fa-arrow-up"></i> +18%</span>
  </div>
</article>
```

`data-count` activa el contador animado (ver sección 12). El valor debe estar
también en el HTML para que se lea sin JS.

### 7.5 Formularios

```html
<div class="field">
  <label class="flabel" for="prod-nombre">Nombre</label>
  <input id="prod-nombre" class="ds-input" type="text" placeholder="Ej. Café Americano" required>
</div>

<div class="field">
  <label class="flabel" for="prod-buscar">Buscar</label>
  <div class="input-wrap">
    <i class="fas fa-search"></i>
    <input id="prod-buscar" class="ds-input with-icon" type="search" placeholder="Buscar...">
  </div>
</div>

<div class="field">
  <label class="flabel" for="prod-precio">Precio</label>
  <input id="prod-precio" class="ds-input" type="number" step="0.01" min="0">
</div>
```

- Etiqueta **siempre** visible arriba, nunca solo `placeholder`.
- Inputs con radio `--ds-radius-md` (14px), borde 1.5px `--border-color`.
- Foco: borde `--primary-color` + `--primary-focus-ring`. Nunca quitar el
  outline sin reemplazarlo.
- Error: clase de error del módulo + mensaje de texto debajo, no solo borde
  rojo.

### 7.6 Selects, toggles y tabs

```html
<!-- Select nativo estilizado -->
<select class="ds-input"><option>Todas las categorías</option></select>

<!-- Selector con menú propio (cuando el nativo no alcanza) -->
<div class="ds-select">...</div>

<!-- Toggle pastilla -->
<div class="toggle-group">
  <button class="toggle-opt active"><i class="fas fa-table-cells"></i> Grilla</button>
  <button class="toggle-opt"><i class="fas fa-list"></i> Lista</button>
</div>

<!-- Interruptor -->
<label class="switch">
  <input type="checkbox" checked><span class="track"></span><span>Notificaciones</span>
</label>

<!-- Tabs -->
<div class="tabs">
  <button class="tab active">Productos</button>
  <button class="tab">Carrito</button>
</div>
```

El select nativo se estiliza con la flecha SVG ya definida; no le pongas
`appearance:none` sin volver a dibujar la flecha.

### 7.7 Tablas

```html
<div class="table-responsive">
  <table class="dashboard-table">
    <thead>
      <tr><th>Fecha</th><th>Productos</th><th>Total</th><th>Ganancia</th></tr>
    </thead>
    <tbody><!-- ... --></tbody>
  </table>
</div>
```

- Cabecera: Sora, `0.76rem`, mayúsculas, `letter-spacing: .04em`.
- Fila al hover: `color-mix(in srgb, var(--primary-color) 6%, transparent)`.
- Números alineados a la derecha; dinero con `FormatUtils.currency()`.
- Si la tabla puede ser larga, envuélvela en `.table-responsive` y usa
  paginación estándar.
- Fila sin datos: usa el estado vacío (7.9), no una fila con "No hay datos"
  centrada sin estilo.

### 7.8 Drawers

```html
<div class="drawer-overlay">
  <aside class="drawer-content">
    <header class="drawer-header"><h3>Detalle del cliente</h3>
      <button class="drawer-close"><i class="fas fa-xmark"></i></button>
    </header>
    <div class="drawer-body"><!-- contenido --></div>
  </aside>
</div>
```

- Entra por la derecha, radio `--ds-radius-lg` en las esquinas izquierdas.
- Para formularios largos o detalles laterales. Nunca para confirmaciones.
- El cierre siempre disponible: botón X, `Escape` y clic en el overlay.

### 7.9 Estados vacío, carga y error

```html
<!-- Vacío -->
<div class="empty-state">
  <i class="fas fa-cart-shopping"></i>
  <p class="empty-title">Tu carrito está vacío</p>
  <p class="empty-hint">Agrega productos para comenzar</p>
</div>

<!-- Carga -->
<div class="skeleton skeleton-table-row"></div>
```

- Vacío: icono grande en `--text-muted`, título en `--text-color`, una línea de
  ayuda. Nunca una pantalla en blanco.
- Carga: skeleton, no spinner de página completa cuando se puede evitar.
- Error: mensaje claro, en español, con la acción de recuperación disponible.

---

## 8. Capas: modales, drawers y overlays

### 8.1 Regla de una sola capa

**Un modal a la vez, por regla.** Tampoco drawer sobre modal, ni modal sobre
drawer. Si te encuentras necesitando eso, primero revisa el diseño del flujo.

La excepción ya prevista por el sistema es la escalera de capas: si de verdad
hace falta abrir una capa desde otra, la segunda se marca con
`--capa-overlay-2`, nunca con un número inventado. Y la notificación
(`.notification`) vive siempre por encima de todo, con `--capa-aviso`.

Cómo resolverlo sin anidar:

| Situación | Solución correcta |
|---|---|
| Confirmar algo que se pidió dentro de un modal | La confirmación va **dentro** del mismo modal, en una vista de paso (contenido que reemplaza al formulario) |
| Elegir un producto/cliente desde un modal | Cierra el modal, abre el selector como capa única, y al elegir vuelve al formulario |
| Ver detalle de un ítem dentro de un drawer | El detalle reemplaza el contenido del drawer (navegación interna), no abre otra capa |
| Varios pasos (asistente) | Un solo modal con pasos, no un modal por paso |

La única excepción tolerada: la notificación (`.notification`), que vive por
encima de cualquier capa para no perderse.

### 8.2 Confirmaciones

Usa `<dialog>` nativo (ya se usa en `customers.html`, `promotions.html`,
`dashboard.html`, `reports.html`):

```html
<dialog id="confirmModal" class="dialog">
  <div class="modal-header"><h3>Eliminar producto</h3></div>
  <div class="modal-body">
    <p>Se eliminará "Café Americano". Esta acción no se puede deshacer.</p>
  </div>
  <div class="modal-footer">
    <button class="btn btn-outline" data-close>Cancelar</button>
    <button class="btn btn-danger-soft" data-confirm>Eliminar</button>
  </div>
</dialog>
```

Reglas:

- El botón destructivo nombra la acción ("Eliminar", "Cancelar venta"), no dice
  "Aceptar".
- "Cancelar" siempre presente y a la izquierda.
- `Escape` cierra y equivale a cancelar.
- El foco entra al modal al abrir y vuelve al elemento que lo abrió al cerrar.
- El backdrop lleva el patrón SVG sutil ya definido (`.dialog::backdrop`).

### 8.3 Tamaños y animaciones

Tres tamaños: `data-modal-size="sm|md|lg"` (por defecto 480px de ancho máximo).
Animaciones de entrada disponibles en el catálogo: `zoom`, `slide-up`, `drop`,
`flip`, `grow`. Usa la que trae por defecto el componente; no definas una nueva
por vista.

Detalle intencional que no se debe "corregir": el modal de detalle de venta
(`.sale-detail-dialog`) tiene las esquinas inferiores rectas porque simula un
ticket.

---

## 9. Feedback al usuario

### 9.1 Notificación (toast)

```javascript
showNotification('Producto actualizado', 'success');
showNotification('No se pudo guardar el cambio', 'error');
showNotification('Sin conexión, reintentando', 'warning');
showNotification('Sincronizando inventario', 'info');
```

Comportamiento ya implementado en `js/app.js` (no lo reimplementes):

- Aparece arriba al centro en escritorio y arriba del navbar en móvil.
- Superficie vidrio negro, borde izquierdo del color del tipo, icono
  FontAwesome por tipo.
- Se autodestruye a los 3.5s; se oculta al pasar el cursor.
- Elimina notificaciones previas para no apilarlas.

Tipos válidos: `success`, `error`, `warning`, `info`.

### 9.2 Cuándo usar cada cosa

| Necesidad | Solución |
|---|---|
| Resultado de una acción | Notificación |
| Confirmación destructiva | `<dialog>` |
| Error de validación de un campo | Mensaje bajo el campo + foco en el primero con error |
| Proceso largo | Indicador de progreso en el contexto (botón `.loading` o barra), no un modal bloqueante |
| Ayuda contextual | Tooltip o texto de ayuda; no un modal |

---

## 10. Estados de pantalla

Toda vista con datos debe resolver los cuatro estados. Esto es parte del
trabajo, no un extra:

1. **Cargando:** skeleton con la forma del contenido.
2. **Vacío:** icono + título + ayuda + acción sugerida.
3. **Con datos:** el contenido normal.
4. **Error:** mensaje claro en español y opción de reintentar.

Una vista que solo funciona cuando la API responde rápido está incompleta.

---

## 11. Temas claro y oscuro

- El tema se controla con el atributo `data-theme="light|dark"` en `<html>` y
  se inicializa con `js/theme-init.js`. No implementes tu propio cambio de tema.
- Los colores de marca **no cambian** entre temas: cambian superficies, texto
  y bordes. Si necesitas un color de marca distinto en oscuro, ya existe su
  token (`--primary-color` cambia solo).
- Prohibido `@media (prefers-color-scheme)` fuera de `theme-init.js`.
- Prohibido fijar `background:#fff` o `color:#333` en un componente de módulo.
- Al probar: alterna el tema con el botón del sidebar y revisa **toda** la
  pantalla, incluidos modales, drawers y tablas.

---

## 12. Animaciones

El sistema vive en `js/design-system.js` (anime.js vendoreado en
`lib/animejs/`). Aplica revelado con stagger a cards, filas de tabla y KPIs, y
contadores a `[data-count]`.

- No agregues animaciones propias para "que se vea vivo". El sistema ya anima
  cards, tablas y contadores al entrar al viewport.
- Si necesitas refrescar tras cargar datos por fetch, dispara el evento:

```javascript
document.dispatchEvent(new Event('ds:refresh'));
```

- Duraciones y curvas: usa los tokens (`--dur`, `--dur-spring`, `--dur-soft`).
- Micro-animaciones disponibles: `.ds-breathe`, clases `.ds-reveal`.
- Nada de animaciones que retrasen una acción del usuario (cobrar, guardar).
- Respeta `prefers-reduced-motion`: si agregas una animación nueva, enciérrala
  en `@media (prefers-reduced-motion: no-preference)`.

---

## 13. Accesibilidad

### 13.1 Contraste medido (WCAG AA = 4.5:1 en texto normal)

Combinaciones verificadas sobre el código actual (2026-09-28):

| Combinación | Ratio | Estado |
|---|---|---|
| Claro: `--text-on-primary` `#08352F` sobre `--primary-color` (botón sólido) | 6.33 | Aplicado |
| Claro: `--primary-ink` `#177068` sobre blanco (contorno, badges, enlaces) | 5.91 | Aplicado |
| Claro: blanco sobre `--secondary-dark` `#0A6A86` (botón Guardar) | 6.14 | Aplicado |
| Claro: `--warning-ink` `#A34A00` sobre blanco (`badge-warning`) | 5.94 | Aplicado |
| Claro: `--text-color` sobre `--bg-body` | 15.82 | Ya cumplía |
| Oscuro: `--text-on-primary` `#06302C` sobre `--primary-color` | 7.85 | Aplicado |
| Oscuro: `--primary-ink` `#49D4C6` sobre `--bg-body` `#0D1516` | 10.14 | Aplicado |
| Oscuro: `--warning-ink` `#F69A31` sobre `--bg-card` `#162022` | 7.58 | Aplicado |
| Oscuro: `--secondary-contrast` `#062A33` sobre `--secondary-dark` `#33A5C1` | 5.26 | Aplicado |
| Oscuro: `--text-muted` `#93A7A9` sobre card / fondo | 6.60 / 7.34 | Ya cumplía |

El tema oscuro tiene la paleta afinada y validada (así lo dice el propio
`variables.css`). El claro es el que trae la deuda pendiente.

**Combinaciones prohibidas** (no cumplen AA):

| Combinación | Ratio | Por qué |
|---|---|---|
| Texto blanco sobre `--primary-color` | 2.13 | Usar `--text-on-primary` |
| Texto blanco sobre `--warning-color` | 2.70 | Usar `--warning-ink` o texto oscuro |
| `--primary-dark` `#2CB1A7` como texto sobre blanco | 2.64 | Usar `--primary-ink` |
| `--warning-dark` `#E65100` como texto sobre blanco | 3.79 | Usar `--warning-ink` |
| Texto blanco sobre `--secondary-color` (claro) | 4.22 | Usar `--secondary-dark` |
| Texto blanco sobre `--secondary-color` (oscuro) | 2.21 | Usar `--secondary-contrast` |

Pendiente (deuda medida): `--text-muted` del tema **claro** (`#999999`) da
2.85:1 sobre blanco y 2.64:1 sobre `--bg-body`. Debe subir a `#667085`
(4.97 / 4.62). Es el único fallo de contraste que queda en el sistema.

### 13.2 Teclado y foco

- Todo accionable se alcanza con `Tab` y se activa con `Enter`/`Espacio`.
- El foco es visible siempre (`--primary-focus-ring`). Nunca `outline:none`
  sin sustituto.
- El POS tiene navegación por teclado (`js/keyboard-nav.js`) y atajos como
  `Ctrl+Enter` para cobrar. Respétalos y documéntalos en la interfaz.
- Los modales atrapan el foco mientras están abiertos.

### 13.3 Semántica

- Un `<h1>` por vista; jerarquía sin saltos.
- Formularios con `<label for>`, no solo `placeholder`.
- Iconos decorativos con `aria-hidden="true"`; botones de solo icono con
  `aria-label`.
- Estados no solo por color: siempre icono o texto acompañando.

---

## 14. Iconografía

- **FontAwesome 6 Free** (`lib/fontawesome/`). No mezcles sets.
- Icono acompañando texto: `<i class="fas fa-plus"></i> Nuevo`.
- Botón solo icono: `btn btn-icon` + `aria-label`.
- Tamaño: hereda del texto (`.95em` en botones) o `1.1-1.2rem` en navegación.
- Cursor por contexto: ya está resuelto en `design-system.css` (pointer, text,
  help, grab, not-allowed). No lo dupliques.
- Prohibido usar SVG de otra librería sin justificación, y prohibido usar
  emojis como iconos.
- Los iconos de la aplicación (favicon y los del manifiesto PWA) viven en
  `public/assets/app-icons/`, que **sí** está versionada. No los devuelvas a
  `public/assets/images/logos/`: esa carpeta está en `.gitignore` (guarda los
  logos que sube cada tienda), el archivo no viajaba en la imagen y el favicon
  daba 404 en producción desde siempre. Si agregas un icono, va ahí y se apunta
  desde el `<link>` y el `manifest.json`.

---

## 15. Contenido y textos

- **Español neutro, con acentos.** Nada de inglés en la interfaz del usuario.
- Formatos: usa `window.FormatUtils` (`currency`, `number`, `quantity`) en vez
  de `toFixed()` suelto. La configuración regional vive en
  `docs/PLAN_FORMATO_REGIONAL.md`.
- Moneda con símbolo y dos decimales: `$1,250.50`.
- Fechas en `dd/mm/aaaa hh:mm` (como ya muestra el dashboard).
- Mayúsculas en cabeceras de tabla y etiquetas de KPI; el resto en caja normal.
- Mensajes de error que digan qué pasó y qué hacer, no "Error 500".
- Sin emojis, sin signos decorativos repetidos (`!!!`), sin mayúsculas
  gritadas fuera de etiquetas.

---

## 16. Responsive

Breakpoints en uso: **480, 640, 768, 1024** son los canónicos; el resto es
deuda a unificar (600 con 10 usos, 900 con 13, más sueltos en 360, 400, 460,
520, 700, 720, 760, 769, 860, 899, 901, 960 y 1000). El de **768** es el que
más se usa (24 veces) y es la frontera móvil/escritorio.

Reglas:

- En móvil (`< 768px`): la sidebar se convierte en navegación inferior
  (`mobile-nav.css`); el `main-content` pierde el margen lateral y toma padding
  reducido.
- Toda acción principal debe quedar alcanzable con el pulgar.
- Tablas anchas: `.table-responsive` con scroll horizontal; nunca rompas el
  layout de la página.
- Prueba tu vista al menos en 1280px, 768px y 390px de ancho.

---

## 17. Anti-patrones y deuda conocida

Estado real medido el 2026-09-28. Esta lista es "lo que hay que arreglar
cuando se toque cada archivo", no una excusa para copiarlo.

| Hallazgo | Dónde | Regla que viola |
|---|---|---|
| 244 colores en duro, 22 de ellos `#4fddd2` (cian del tema oscuro) | `public/css/inventory.css` | 3.3 |
| 70 colores en duro | `public/css/sales.css` | 3.3 |
| 103 colores en duro (incluye la capa antigua) | `public/css/main.css` | 3.3 |
| Fuente `Nunito` que nunca se carga | `public/css/sidebar-modern.css` | 5.5 |
| Fuentes propias fuera de Sora/Inter | `public/tables.html`, `public/js/comandas.js` | 5.5 |
| 8 llamadas bloqueantes que quedan | `sales.js` (2), `finance.js` (2), `tables.js` (2), `PlanManager.js`, `promotions.js`, `super_admin.js`, `cobro.js` | 3.2 |
| `z-index` crudos en hojas que ya podrían usar la escalera (`1000`, `100`) | varios CSS | 5.10 |
| `--text-muted` del tema claro con 2.85:1 | `variables.css` | 13.1 |
| Ítem activo del sidebar: texto blanco sobre cian (2.13:1) | `main.css` (`.nav-item.active`) | 13.1 |
| 12 `var(--token)` que no existen y no aplican nada | `design-system.css`, `inventory.css`, `sales.css`, vistas de pantallas digitales, `finance.html`, `promotions.html` | 5, 11 |
| Breakpoints dispersos (360, 400, 460, 520, 700, 720, 760, 769, 860, 899, 901, 960, 1000) | varios CSS | 16 |

---

## 18. Cómo añadir un componente nuevo

1. Comprueba que no exista. Busca en `design-system.css`, `main.css` y el
   catálogo.
2. Si es una variante de algo existente, añádela a `design-system.css` con la
   convención `.base-variante`.
3. Si es propio de un módulo, va en el CSS del módulo con prefijo.
4. Usa tokens (`var(--...)`), nunca valores en duro.
5. Respeta los tokens de radio, sombra, duración y espaciado.
6. Pruébalo en claro y oscuro, en escritorio y móvil.
7. **Añádelo al catálogo** `public/design-system.html` en la pestaña que
   corresponda, con su etiqueta de variante. Un componente que no está en el
   catálogo no existe.
8. Corre `bash scripts/verificar-estilos.sh`.

---

## 19. Checklist de revisión

Antes de abrir un PR de interfaz, responde todo con sí:

- [ ] Cero emojis en HTML, JS y mensajes.
- [ ] Cero `alert()`, `confirm()`, `prompt()` nuevos.
- [ ] Cero colores, radios o sombras en duro: todo por token.
- [ ] El CSS nuevo va en el archivo que corresponde y con la query `?v=N` subida.
- [ ] No hay modales sobre modales; una sola capa a la vez.
- [ ] Los cuatro estados (carga, vacío, datos, error) están resueltos.
- [ ] Se ve bien en tema claro y oscuro.
- [ ] Funciona con teclado; el foco es visible.
- [ ] Los textos están en español, con acentos y sin "OK".
- [ ] Los importes usan `FormatUtils`.
- [ ] Probado en 1280px, 768px y 390px.
- [ ] Si es un componente nuevo, está en el catálogo.
- [ ] `bash scripts/verificar-estilos.sh` sale limpio.

---

## 20. Verificación

### 20.1 Lint de estilos (rápido)

```bash
bash scripts/verificar-estilos.sh
```

Revisa emojis, `alert/confirm/prompt`, colores en duro fuera de los archivos
permitidos, familias tipográficas no autorizadas y referencias a tokens
inexistentes. Sale con código 1 si encuentra algo.

### 20.2 Prueba visual real

```bash
docker compose up -d --build          # app en http://localhost:8091/public/
```

El servidor es **nginx** (`docker/nginx.conf`), con `DocumentRoot` en
`/var/www/html` igual que antes, así que la app se sirve bajo `/public/`. nginx
bloquea `/docs/`, `/config/`, `/includes/` y los archivos `.md`: esta guía se
lee en el repositorio, no por web.

Entra con `admin / admin123` (cambiando la contraseña si lo pide), y revisa la
pantalla en claro y oscuro. Para un cambio de layout relevante, deja captura
en el PR.

### 20.3 Suite funcional

```bash
bash docker/test_suite.sh http://localhost:8091
```

### 20.4 Tokens para agentes

`DESIGN.md` en la raíz lleva los tokens en formato consumible por agentes. Se
puede validar y exportar:

```bash
npx -y @google/design.md lint DESIGN.md
npx -y @google/design.md export --format json-tailwind DESIGN.md > tailwind.theme.json
```

---

**Recordatorio final:** la interfaz de Tomodachi se usa de pie, con clientes
esperando y con prisa. Un botón mal puesto cuesta una venta. Mantén el sistema
aburrido de tan consistente, y rápido de tan claro.
