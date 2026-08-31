/**
 * format-utils.js — Formato regional por tienda (números, moneda, fechas).
 * Cargado en el head de las páginas. Se inicializa con
 * FormatUtils.init(store.settings.format) desde loadStoreSettings (app.js)
 * o desde el inicio de cada página. Fallback: es-MX / MXN.
 */
(function () {
    'use strict';

    const DEFAULTS = {
        currency_code: 'MXN',
        currency_symbol: '$',
        symbol_position: 'before',   // before | after | none
        thousands_sep: ',',          // , | . | space | none
        decimal_sep: '.',            // . | ,
        decimals: 2,                 // 0..4
        date_format: 'DD/MM/YYYY',   // DD/MM/YYYY | MM/DD/YYYY | YYYY-MM-DD | DD-MM-YYYY
        time_format: '24h',          // 24h | 12h
        locale: 'es-MX'
    };

    let config = { ...DEFAULTS };

    // Auto-inicialización desde caché local (pos_format_config) si existe.
    // Evita la race condition entre el pintado de datos (dashboard, etc.)
    // y la respuesta de settings.php que inicializa FormatUtils.
    try {
        const cached = localStorage.getItem('pos_format_config');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && typeof parsed === 'object') config = { ...DEFAULTS, ...parsed };
        }
    } catch (e) { /* sin caché */ }
    // Si ya hay config (caché), aplicar símbolos de moneda de inmediato
    try {
        if (config && config.currency_symbol) {
            document.addEventListener('DOMContentLoaded', () => applyCurrencyIcons());
        }
    } catch (e) { /* noop */ }

    function init(cfg) {
        config = { ...DEFAULTS, ...(cfg || {}) };
        // Normalizar separadores
        if (config.thousands_sep === 'space') config.thousands_sep = '\u00A0';
        if (config.thousands_sep === 'none') config.thousands_sep = '';
        if (!config.decimal_sep) config.decimal_sep = '.';
        if (config.decimals === undefined || config.decimals === null) config.decimals = 2;
        // Persistir en caché local para la próxima carga inmediata
        try {
            if (cfg && typeof cfg === 'object') localStorage.setItem('pos_format_config', JSON.stringify(cfg));
        } catch (e) { /* noop */ }
        // Actualizar símbolos de moneda en el DOM (iconos .currency-icon)
        applyCurrencyIcons();
        return config;
    }

    // Reemplaza los iconos fa-dollar-sign (ahora .currency-icon) con el
    // símbolo de la moneda configurada (¥, $, €, "COP $"...).
    function applyCurrencyIcons() {
        try {
            const sym = config.currency_symbol || '$';
            document.querySelectorAll('.currency-icon').forEach(el => {
                el.textContent = sym;
            });
        } catch (e) { /* DOM no disponible aún */ }
    }

    function getConfig() {
        return { ...config };
    }

    // ============================================================
    // Números
    // ============================================================

    // Formatea un número con los separadores configurados.
    // amount: number|string. Devuelve string, ej. "1,234.56" o "1.234,56".
    function number(amount) {
        const n = Number(amount);
        if (isNaN(n)) return String(amount ?? '');
        const dec = Math.max(0, Math.min(4, config.decimals || 0));
        const fixed = n.toFixed(dec);
        const [intPart, decPart] = fixed.split('.');
        const sep = config.thousands_sep || '';
        const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
        return decPart ? withThousands + config.decimal_sep + decPart : withThousands;
    }

    // Cantidad genérica (sin símbolo de moneda), con decimales según config.
    function quantity(amount) {
        return number(amount);
    }

    // Cantidad INTELIGENTE para stock/cantidades: si es entero, no muestra
    // decimales (3 → "3", nunca "3.000"); si tiene fracción, muestra los
    // decimales necesarios sin ceros finales (3.5 → "3.5", 3.250 → "3.25").
    // No usa config.decimals (las cantidades no se redondean como moneda).
    function qty(amount) {
        const n = Number(amount);
        if (isNaN(n)) return String(amount ?? '');
        if (Number.isInteger(n)) return String(n);
        // Hasta 4 decimales, quitar ceros finales
        return n.toFixed(4).replace(/\.?0+$/, '');
    }

    // ============================================================
    // Moneda
    // ============================================================

    // Formatea como moneda según posición del símbolo y separadores.
    // Ej. MX: "$1,234.56" | CO: "$ 1.234,56" | EU: "$1,234.56" | ¥: "¥1,234"
    function currency(amount) {
        const n = Number(amount);
        if (isNaN(n)) return String(amount ?? '');
        const body = number(n);
        const sym = config.currency_symbol || '';
        if (!sym || config.symbol_position === 'none') return body;
        if (config.symbol_position === 'after') return body + ' ' + sym;
        // before: símbolo pegado o con espacio según config
        return sym + body;
    }

    // Versión con espacio entre símbolo y número (estilo COP: "$ 1.234,56").
    // Se usa cuando el preset lo define con symbol_space=true (no en DEFAULTS
    // para no romper el formato actual de México).
    function currencySpace(amount) {
        const n = Number(amount);
        if (isNaN(n)) return String(amount ?? '');
        const body = number(n);
        const sym = config.currency_symbol || '';
        if (!sym || config.symbol_position === 'none') return body;
        if (config.symbol_position === 'after') return body + ' ' + sym;
        return sym + ' ' + body;
    }

    // ============================================================
    // Fechas
    // ============================================================

    function pad2(v) { return String(v).padStart(2, '0'); }

    // Convierte cualquier entrada (Date, ISO, timestamp) a Date válido.
    function toDate(input) {
        if (input instanceof Date) return input;
        if (typeof input === 'number') return new Date(input);
        if (!input) return null;
        const d = new Date(input);
        return isNaN(d.getTime()) ? null : d;
    }

    // Aplica el patrón de fecha configurado (date_format).
    // dateStr: Date|string ISO|timestamp. Devuelve ej. "13/08/2026".
    function dateOnly(dateStr) {
        const d = toDate(dateStr);
        if (!d) return String(dateStr ?? '');
        const dd = pad2(d.getDate());
        const mm = pad2(d.getMonth() + 1);
        const yyyy = d.getFullYear();
        const fmt = config.date_format || 'DD/MM/YYYY';
        switch (fmt) {
            case 'MM/DD/YYYY': return mm + '/' + dd + '/' + yyyy;
            case 'YYYY-MM-DD': return yyyy + '-' + mm + '-' + dd;
            case 'DD-MM-YYYY': return dd + '-' + mm + '-' + yyyy;
            case 'DD/MM/YYYY':
            default: return dd + '/' + mm + '/' + yyyy;
        }
    }

    // Hora según time_format: "14:30" (24h) o "2:30 PM" (12h).
    function timeOnly(dateStr) {
        const d = toDate(dateStr);
        if (!d) return '';
        const h = d.getHours();
        const m = pad2(d.getMinutes());
        if (config.time_format === '12h') {
            const period = h >= 12 ? 'PM' : 'AM';
            const h12 = h % 12 === 0 ? 12 : h % 12;
            return h12 + ':' + m + ' ' + period;
        }
        return pad2(h) + ':' + m;
    }

    // Fecha + hora según configuración. Ej. "13/08/2026 14:30".
    function date(dateStr) {
        const d = toDate(dateStr);
        if (!d) return String(dateStr ?? '');
        return dateOnly(d) + ' ' + timeOnly(d);
    }

    // Fecha larga legible (para encabezados de reportes/tickets), usando el
    // locale del preset. Ej. "martes, 11 de agosto de 2026".
    function dateLong(dateStr) {
        const d = toDate(dateStr);
        if (!d) return String(dateStr ?? '');
        try {
            return new Intl.DateTimeFormat(config.locale || 'es-MX', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            }).format(d);
        } catch (e) {
            return dateOnly(d);
        }
    }

    // Fecha para inputs datetime-local / consultas: SIEMPRE ISO local.
    // Importante: el backend y SQL esperan YYYY-MM-DD / YYYY-MM-DDTHH:MM.
    function isoLocal(dateStr) {
        const d = toDate(dateStr);
        if (!d) return '';
        const tzOffset = d.getTimezoneOffset() * 60000;
        return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
    }

    // Fecha para consultas SQL: SIEMPRE YYYY-MM-DD (nunca el formato visual).
    function isoDate(dateStr) {
        const d = toDate(dateStr);
        if (!d) return '';
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    window.FormatUtils = {
        init: init,
        getConfig: getConfig,
        applyCurrencyIcons: applyCurrencyIcons,
        number: number,
        quantity: quantity,
        qty: qty,
        currency: currency,
        currencySpace: currencySpace,
        date: date,
        dateOnly: dateOnly,
        dateLong: dateLong,
        timeOnly: timeOnly,
        isoLocal: isoLocal,
        isoDate: isoDate
    };
})();
