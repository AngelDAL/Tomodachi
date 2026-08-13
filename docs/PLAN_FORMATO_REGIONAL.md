# PLAN — Configuración de Formato Regional por Empresa (Locale)

**Estado:** APROBADO — decisiones tomadas (2026-08-13)
**Fecha:** 2026-08-13
**Área:** Configuración de Empresa + Frontend (formatos) + Backend (tickets/PDF)

## Decisiones (respuestas de Angel)

1. **Alcance:** GLOBAL — pantallas web + tickets térmicos + PDF de reportes.
2. **Solo visual:** NO hay conversión de moneda ni tipo de cambio.
3. **Símbolo editable:** sí, texto libre (permite "COP $", "¥", "€"...).
4. **Fechas backend:** sí, pero SOLO en salidas (tickets/mensajes). Las
   consultas SQL y los inputs de fecha SIEMPRE usan `YYYY-MM-DD` / ISO —
   el formato regional jamás toca lo que se manda al servidor.
5. **Idiomas:** los paquetes de idioma (nombres de días/meses) se agregan
   después como plugin; esta fase usa `locale` del preset solo para Intl.

## Problema

Hoy los formatos están **hardcodeados** en el frontend:

- `formatCurrency()` → `Intl.NumberFormat('es-MX', { currency: 'MXN' })`
  definida por separado en **7 archivos JS** (app.js, dashboard.js,
  finance.js, sales.js, inventory.js, promotions.js, thermal-print.js).
- Fechas → `toLocaleDateString('es-MX', ...)` o `new Date().toLocaleString()`
  con el locale del navegador (¡inconsistente entre equipos!).
- Reportes (reports.html inline) → `$${x.toFixed(2)}` con signo `$` fijo y
  punto decimal siempre.
- Backend PHP → `number_format(..., 2)` y `date('d/m/Y H:i')` en tickets
  (close_register) y mensajes de error (create_sale).

**Consecuencia:** una empresa de México ve `$1,234.56`, una de Colombia
debería ver `$ 1.234,56` (o `COP 1.234,56`), una de EU `$1,234.56` con
formato de fecha MM/DD/YYYY, etc. Hoy no se puede ajustar por tienda.

## Objetivo

Configuración **por tienda** (dentro de Configuración de Empresa) de:

1. **Moneda**: código ISO (MXN, USD, COP, EUR...) + símbolo personalizado
   opcional (p. ej. "$", "USD", "COP $").
2. **Números**: separador de miles (coma, punto, espacio, ninguno),
   separador de decimales (punto, coma), número de decimales (0, 2, 3...).
3. **Fechas**: formato (DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY),
   incluir hora sí/no, formato de hora (24h / 12h AM-PM).
4. **Presets rápidos**: México, Colombia, Estados Unidos, España, Argentina
   — un select que rellena todo y permite ajuste manual fino.

## Diseño propuesto

### 1. Persistencia — campo `settings` JSON de `stores` (ya existe)

Dentro del JSON `settings` (hoy: `allow_negative_stock`,
`require_open_register`) se agrega un objeto `format`:

```json
{
  "allow_negative_stock": false,
  "require_open_register": false,
  "format": {
    "currency_code": "MXN",
    "currency_symbol": "$",
    "symbol_position": "before",        // before | after | none
    "thousands_sep": ",",               // , | . | space | none
    "decimal_sep": ".",                 // . | ,
    "decimals": 2,                      // 0..4
    "date_format": "DD/MM/YYYY",        // DD/MM/YYYY | MM/DD/YYYY | YYYY-MM-DD | DD-MM-YYYY
    "time_format": "24h",               // 24h | 12h
    "locale": "es-MX"                   // para Intl cuando aplique (días/meses en español)
  }
}
```

**No requiere migración SQL** (columna `settings` ya es TEXT/JSON).

### 2. Backend — `api/stores/settings.php`

- GET: ya devuelve `settings` completo → incluirá `format` sin cambios.
- POST: ya acepta `settings` completo → el frontend manda el objeto
  completo; el backend ya lo guarda tal cual. **Cero cambios** (verificar).

### 3. Frontend — nuevo `public/js/format-utils.js`

Helper global único (cargado en el head o antes de los scripts de página):

```js
const FormatUtils = {
  config: null,                    // se llena con store.settings.format
  init(config) { this.config = { ...defaults, ...config }; },
  currency(amount) { ... },        // aplica símbolo + separadores + decimales
  number(amount)  { ... },         // solo número con separadores
  date(dateStr)   { ... },         // aplica date_format + time_format
  dateShort(dateStr) { ... },      // solo fecha
};
```

- `currency()` reemplaza a todas las `formatCurrency()` locales.
- `date()`/`dateShort()` reemplazan a `toLocaleString`/`toLocaleDateString`
  hardcodeadas.
- Cargado desde `loadStoreSettings()` (app.js) y desde el inicio de cada
  página que lo necesite; **fallback a es-MX/MXN** si no hay config.

### 4. Reemplazo en las ~100 ocurrencias

| Archivo | Ocurrencias | Qué reemplaza |
|---|---|---|
| public/js/sales.js | ~30 | formatCurrency, fechas de venta, ticket |
| public/js/dashboard.js | ~20 | formatCurrency, fechas de gráficas |
| public/js/finance.js | ~17 | formatCurrency, fechas movimientos |
| public/js/promotions.js | ~16 | formatCurrency, fechas promos |
| public/js/inventory.js | ~8 | formatCurrency, fechas |
| public/js/thermal-print.js | ~5 | fecha del ticket |
| public/js/app.js | ~3 | formatCurrency/formatDate globales |
| public/reports.html (inline) | ~61 | `$${x.toFixed(2)}` y toLocaleString |
| public/customers.html (inline) | ~3 | saldos/adeudos |
| api/... (PHP) | pocas | number_format en mensajes y tickets |

**Estrategia:** dejar las funciones `formatCurrency`/`formatDate` existentes
como wrappers que deleguen a `FormatUtils` (menos difusión del cambio), y
reemplazar los usos inline tipo `$${x.toFixed(2)}` por `FormatUtils.currency(x)`.

### 5. UI — Configuración de Empresa (profile.html)

Nueva sección "Formato Regional" (después de Configuración de Negocio):

- **Select de preset**: México / Colombia / Estados Unidos / España /
  Argentina / Personalizado.
- **Moneda**: select de código (MXN, USD, COP, EUR, ARS...) + símbolo
  (texto) + posición (antes/después/ninguno).
- **Números**: separador de miles, separador de decimales, decimales.
- **Fechas**: formato de fecha (select), hora 24/12.
- **Preview en vivo**: "1,234.56 · 13/08/2026 14:30" que cambia al editar.
- Guardar con el mismo botón de Guardar de la página (POST settings.php).

### 6. Presets (valores iniciales)

| País | Código | Símbolo | Miles | Dec. | Decs | Fecha | Hora |
|---|---|---|---|---|---|---|---|
| México | MXN | $ | , | . | 2 | DD/MM/YYYY | 24h |
| Colombia | COP | $ | . | , | 0 | DD/MM/YYYY | 24h |
| EE. UU. | USD | $ | , | . | 2 | MM/DD/YYYY | 12h |
| España | EUR | € | . | , | 2 | DD/MM/YYYY | 24h |
| Argentina | ARS | $ | . | , | 2 | DD/MM/YYYY | 24h |

### 7. Tickets térmicos (thermal-print.js)

El ticket impreso usa `formatCurrency` → heredará el formato automáticamente.
El backend `close_register.php` (arqueo) usa `date('d/m/Y H:i')` — se puede
dejar (es el estándar de arqueo) o parametrizar después; **decisión abierta**.

## Preguntas abiertas (para ti, Angel)

1. **¿Alcance inicial?** ¿Empezamos con la config + frontend web (pantallas),
   o también tickets térmicos y PDF de reportes desde el inicio?
   - PDF de reportes (reports.html) tiene ~61 ocurrencias inline — es el
     pedazo más grande. ¿Lo incluimos en esta fase o en una segunda?

2. **¿Moneda = solo visual o también conversión?** Esta feature es SOLO
   formato de presentación (cómo se ven los números). No incluye tipo de
   cambio ni conversión MXN↔COP. ¿Correcto? (asumo que sí)

3. **¿Símbolo personalizado o solo código ISO?** ¿Quieres poder escribir
   "COP $" o prefieres que el símbolo se derive del código?

4. **¿Las fechas en el backend (PHP) también?** Los tickets de arqueo
   (close_register) y mensajes de error usan formato PHP fijo. ¿Los
   tocamos o los dejamos como están por ahora?

5. **¿Locale de idioma?** ¿Además del formato numérico, quieres que los
   nombres de días/meses se muestren en el idioma del preset (es-CO, es-MX,
   en-US)? Esto afecta etiquetas tipo "martes, 11 de agosto".

## Verificación

- Preset México → `$1,234.56` y `13/08/2026 14:30` en todas las pantallas.
- Preset Colombia → `$ 1.234,56` (o `COP 1.234`) y `13/08/2026`.
- Preset EE.UU. → `$1,234.56` y `08/13/2026 2:30 PM`.
- Cambiar config → recargar → todo consistente (dashboard, ventas,
  finanzas, reportes, inventario, promociones, clientes).
- Suite `docker/test_suite.sh` 33/33 (sin regresión).
