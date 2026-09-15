/**
 * Regla única del umbral de existencias (Fase 0, T0.1).
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * El dueño lo definió así: "el usuario define su rango mínimo de stock y a partir de ahí
 * es como que debería aparecer en rojo". O sea: el umbral son las existencias mínimas que
 * el propio producto declara (`products.min_stock`), y NUNCA un número escrito a mano en
 * el código.
 *
 * Antes de esto había dos reglas distintas: el badge del punto de venta usaba `< 5` fijo
 * (por eso no coincidía con la ficha del producto) y las tarjetas de "Próximas Compras"
 * usaban el mínimo del producto. Ahora las dos pantallas pintan igual porque las dos
 * llaman a estas funciones.
 *
 * REGLA
 *   'out'  existencia en cero o negativa  -> rojo, con triángulo si es negativa
 *   'low'  existencia en o por debajo del mínimo definido (mínimo > 0) -> rojo
 *   'ok'   el resto, incluido el caso de un producto SIN mínimo definido
 *
 * El último caso importa: si el dueño no definió mínimo, el sistema no inventa uno.
 * Un producto con 3 piezas y mínimo 0 sale normal, porque el mínimo no es asunto
 * nuestro sino suyo.
 *
 * Se usa igual en el navegador (funciones globales, cargadas por <script>) y en las
 * pruebas de node (module.exports al final), como promotion-client-rules.js.
 */

/** Convierte lo que venga de la API en número, o null si no hay existencia que mostrar. */
function stockNumber(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
}

/** Mínimo declarado por el producto. Ausente o negativo se toma como "sin mínimo". */
function stockMinimo(valor) {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Nivel de la existencia: 'out' | 'low' | 'ok'. */
function stockLevel(cantidad, minimo) {
    const q = stockNumber(cantidad);
    if (q === null) return 'ok';           // sin dato: no se marca nada
    if (q <= 0) return 'out';              // cero o negativo
    const m = stockMinimo(minimo);
    if (m > 0 && q <= m) return 'low';     // a partir del mínimo que definió el dueño
    return 'ok';
}

/**
 * Clases CSS de la marca, listas para pegar en el atributo class.
 * Sirven las dos pantallas: `.stock-badge` (punto de venta) y
 * `.product-card-stock` (Próximas Compras) comparten `low` y `negative`.
 */
function stockClasses(cantidad, minimo) {
    const nivel = stockLevel(cantidad, minimo);
    if (nivel === 'ok') return '';
    const q = stockNumber(cantidad);
    return (q !== null && q < 0) ? 'low negative' : 'low';
}

/** Cantidad para mostrar: entera si lo es, hasta 3 decimales si es a granel. */
function stockQty(cantidad) {
    const q = stockNumber(cantidad);
    if (q === null) return '';
    return String(Number(q.toFixed(3)));
}

/**
 * Texto del tooltip: aclara que el número son las existencias y cuál es el mínimo,
 * para que el aviso tenga sentido sin abrir la ficha del producto.
 */
function stockTooltip(cantidad, minimo) {
    const q = stockNumber(cantidad);
    const m = stockMinimo(minimo);
    const nivel = stockLevel(cantidad, minimo);

    if (nivel === 'out') return 'Sin existencias. Hay que reabastecer.';
    if (nivel === 'low') {
        return 'Existencias disponibles: ' + stockQty(q) + ' (mínimo ' + stockQty(m) +
            '). Quedan pocas, conviene reabastecer.';
    }
    return 'Existencias disponibles: ' + stockQty(q) + (m > 0 ? ' (mínimo ' + stockQty(m) + ')' : '');
}

if (typeof module !== 'undefined') {
    module.exports = {
        stockNumber,
        stockMinimo,
        stockLevel,
        stockClasses,
        stockQty,
        stockTooltip,
        // alias cortos, que son los que usan las pruebas
        level: stockLevel,
        classes: stockClasses,
        tooltip: stockTooltip,
    };
}
