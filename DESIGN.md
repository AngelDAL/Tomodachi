---
version: alpha
name: Tomodachi POS
description: Interfaz de punto de venta densa y clara; cian Hatsune sobre superficies suaves, formas cápsula y radios generosos.
colors:
  primary: "#39C5BB"
  primary-dark: "#2CB1A7"
  primary-darker: "#1F8A82"
  primary-light: "#E4F8F6"
  primary-lighter: "#F0FBFA"
  on-primary: "#08352F"
  primary-ink: "#177068"
  warning-ink: "#A34A00"
  secondary: "#0E86A6"
  secondary-dark: "#0A6A86"
  secondary-light: "#E1F3F9"
  success: "#2E7D32"
  success-dark: "#1B5E20"
  danger: "#D32F2F"
  danger-dark: "#B71C1C"
  warning: "#F57C00"
  warning-dark: "#E65100"
  info: "#1976D2"
  surface: "#FFFFFF"
  surface-sunken: "#F4F7F6"
  surface-muted: "#FAFAFA"
  surface-hover: "#F7F7F7"
  border: "#E0E0E0"
  border-light: "#EEEEEE"
  text: "#1A1A2E"
  text-medium: "#555555"
  text-light: "#666666"
  text-muted: "#999999"
  neutral: "#F4F7F6"
typography:
  h1:
    fontFamily: Sora
    fontSize: 1.75rem
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  h2:
    fontFamily: Sora
    fontSize: 1.375rem
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  h3:
    fontFamily: Sora
    fontSize: 1.125rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body-md:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Sora
    fontSize: 0.8rem
    fontWeight: 600
    lineHeight: 1.4
  table-header:
    fontFamily: Sora
    fontSize: 0.76rem
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.04em"
  kpi-value:
    fontFamily: Sora
    fontSize: 1.75rem
    fontWeight: 700
    lineHeight: 1.1
rounded:
  sm: 10px
  md: 14px
  lg: 20px
  pill: 100px
  sidebar: 12px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: 12px
    height: 46px
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
    padding: 12px
  button-secondary:
    backgroundColor: "{colors.secondary-dark}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: 12px
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: 12px
  button-danger-soft:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: 12px
  badge-success:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.success-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: 7px
  badge-warning:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.warning-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: 7px
  badge-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: 7px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: 20px
  card-header:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text}"
    typography: "{typography.h3}"
    rounded: "{rounded.lg}"
    padding: 18px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 13px
  input-focus:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: 13px
  modal:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: 24px
  drawer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: 24px
  notification:
    backgroundColor: "{colors.text}"
    textColor: "{colors.surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 14px
  stat-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: 20px
  table-header:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text-medium}"
    typography: "{typography.table-header}"
    padding: 12px
  nav-item-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: 12px
  kpi-value:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.kpi-value}"
---

# Tomodachi POS — Design Tokens

Este archivo describe la identidad visual de Tomodachi POS en formato
consumible por agentes de código (spec DESIGN.md de Google Labs). Los valores
numéricos son normativos; el porqué y las reglas de aplicación están en
`docs/GUIA_DE_ESTILOS.md`.

La fuente real en ejecución es `public/css/variables.css` (tema claro y oscuro).
Si algo de aquí diverge de ese archivo, gana `variables.css` y este documento
se corrige.

## Overview

Tomodachi POS es una herramienta de mostrador: se usa de pie, con prisa y con
clientes esperando. La interfaz es densa pero aireada, con jerarquía fuerte y
cero decoración inútil.

La identidad visual es un **cian Hatsune** (`#39C5BB`) sobre superficies casi
blancas (o casi negras en tema oscuro). Los elementos accionables son
**cápsulas**; los contenedores usan **radios generosos** (14 a 20px) y sombras
suaves. El fondo lleva un patrón SVG monocromático al 3% de opacidad.

Dos familias tipográficas: **Sora** para encabezados, controles y etiquetas;
**Inter** para cuerpo de texto y campos.

**Nada de emojis.** Los iconos son FontAwesome 6 Free.

## Colors

- **Primary (`#39C5BB`)**: único color de marca. Sombreado de la acción
  principal, foco de campos y acentos. En tema oscuro sube a `#4FDDD2`.
- **On-primary (`#08352F`)**: **todo texto sobre superficie primaria**. El
  texto blanco sobre el cian no pasa contraste (2.13:1) y está prohibido.
- **Primary-ink (`#177068`)**: **texto de marca sobre superficie blanca**
  (enlaces, botón de contorno, badges de marca). 5.91:1. El cian suelto como
  texto solo alcanza 2.13:1 y no cumple AA.
- **Warning-ink (`#A34A00`)**: **texto ámbar sobre superficie clara** (badges
  de "Pendiente"). 5.94:1. `warning-dark` se queda en 3.79:1 y no cumple AA.
- **Secondary (`#0E86A6`)**: acento secundario. Para texto blanco encima usa
  **Secondary-dark (`#0A6A86`)** (6.14:1); `secondary` solo da 4.22:1.
- **Success / Danger / Warning / Info**: estados. Siempre acompañados de icono
  o texto; el color por sí solo no comunica. Sobre `warning` va texto oscuro.
- **Surface / Surface-sunken / Surface-muted / Surface-hover**: jerarquía de
  fondos. Nunca se escribe un color de fondo en duro en un componente.
- **Text / Text-medium / Text-light / Text-muted**: jerarquía de texto.
- **Border / Border-light**: contornos y separadores.

En tema oscuro, los colores de marca se mantienen (con su variante propia) y
solo cambian superficies, texto y bordes.

## Typography

Sora (encabezados, botones, etiquetas, cabeceras de tabla, KPIs) e Inter
(cuerpo, campos, texto de tabla). No se admiten otras familias: hay una
referencia heredada a `Nunito` en `sidebar-modern.css` que debe retirarse.

Escala: `0.75 / 0.875 / 1 / 1.125 / 1.375 / 1.75 rem`.

## Layout

Sidebar flotante de `250px` (colapsada `80px`) separada `16px` de los bordes,
con radio `12px`. El contenido vive en `.main-content` con padding `30px 40px`.
Escala de espaciado en múltiplos de 4: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40`.

Breakpoints canónicos: `480 · 640 · 768 · 1024`. Por debajo de 768px la
sidebar se convierte en navegación inferior.

Escala de capas: contenido `0-1`, elevado `10`, pegajoso `50`, drawer/modal
`1000-2000`, notificación `9999`.

## Elevation & Depth

Tres niveles de sombra: `sm` en reposo de elementos pequeños, `md` en reposo de
cards y paneles, `lg` en hover de card y en modales/drawers. La acción primaria
lleva sombra con tinte del color de marca. No se inventan sombras nuevas.

## Shapes

Botones, badges, tabs y toggles: cápsula (`100px`). Inputs, selects y tablas:
`14px`. Cards, modales, drawers: `20px`. Excepción intencional: el modal de
detalle de venta tiene las esquinas inferiores rectas porque imita un ticket.

## Components

El catálogo visual con todos los estados es `public/design-system.html`. Cualquier
componente nuevo se añade ahí además de a `design-system.css`.

## Do's and Don'ts

- No emojis. Sí iconos FontAwesome.
- No `alert()`, `confirm()` ni `prompt()`. Sí notificaciones y `<dialog>`.
- No colores en duro: todo por token, para que el tema oscuro funcione.
- No modales sobre modales: una sola capa a la vez.
- No texto blanco sobre el cian: usa `{colors.on-primary}`.
- No inventes radios, sombras ni duraciones: usa las escalas de este archivo.
- No dependas del color para comunicar un estado.
- No agregues una librería de iconos, tipografía o animación nueva.
