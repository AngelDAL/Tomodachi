/**
 * Mostrador — pedidos de clientes de paso (sin mesa).
 *
 * La cajera anota lo que pide una persona (a nombre de quién), la cocina lo ve en una pantalla
 * de SOLO LECTURA y el cliente sigue su pedido por un QR/enlace.
 *
 * REGLAS DEL MÓDULO (pedidas por el dueño):
 *  - La lista del pedido es una COLUMNA a la derecha, con las cantidades editables.
 *  - Los precios pasan por el MOTOR DE PROMOCIONES (vista previa en vivo, mismo motor que el
 *    cobro).
 *  - La cajera NO entrega a ciegas: primero AVISA (estado "listo") y solo entonces puede
 *    entregar. Así el cliente siempre se entera.
 *  - Se ve si el cliente tiene el enlace abierto y si activó avisos (para el push).
 *
 * Se apoya en los helpers globales de tables.js (tpPeticion, tpAviso, tpConfirmar, tpEsc,
 * tpDinero, tpCantidad, tpAbrirModal/tpCerrarModal) y en app.js (getRelativeImagePath).
 */

const CT_API = '../api/dining/counter.php';

const ctEstado = {
    pedidos: [],
    historico: false,
    cocina: false,
    // formulario
    nombre: '',
    items: [],              // [{product_id, product_name, price, quantity, notas}]
    busqueda: '',
    categoria: 'todas',
    guardando: false,
    calculo: null,          // último resultado de la vista previa (promociones)
    pagoPedido: null,       // pedido cuyo pago se está editando
};

const CT_ETIQUETA = {
    pending:   ['Pendiente', 'ct-estado-pending'],
    ready:     ['Listo', 'ct-estado-ready'],
    completed: ['Entregado', 'ct-estado-completed'],
    cancelled: ['Cancelado', 'ct-estado-cancelled'],
};

const CT_PAGO = {
    unpaid:  'Por cobrar',
    partial: 'Adelanto',
    paid:    'Pagado',
};

// ============================================================
// Cargar y pintar
// ============================================================
async function ctCargar(silencioso) {
    const cont = document.getElementById('ctLista');
    if (!cont) return;
    if (!silencioso && !ctEstado.pedidos.length) {
        cont.innerHTML = '<div class="tp-vacio"><i class="fas fa-spinner fa-spin"></i><p>Cargando pedidos…</p></div>';
    }
    try {
        const url = CT_API + (ctEstado.historico ? '?historico=1' : '');
        const d = await tpPeticion(url);
        ctEstado.pedidos = d.pedidos || [];
    } catch (e) {
        if (!silencioso) {
            cont.innerHTML = '<div class="tp-vacio"><i class="fas fa-triangle-exclamation"></i><h3>No se pudieron leer los pedidos</h3><p>' + tpEsc(tpMensajeDeError(e)) + '</p></div>';
        }
        return;
    }
    ctPintar();
}

function ctPintar() {
    const cont = document.getElementById('ctLista');
    if (!cont) return;
    const activos = ctEstado.pedidos.filter(function (p) { return p.status === 'pending' || p.status === 'ready'; });
    const porEntregar = ctEstado.pedidos.filter(function (p) { return p.status === 'ready'; });

    const badge = document.getElementById('ctPendientes');
    if (badge) {
        badge.textContent = activos.length;
        badge.classList.toggle('hidden', activos.length === 0);
    }

    if (!ctEstado.pedidos.length) {
        cont.innerHTML = '<div class="tp-vacio"><i class="fas fa-store"></i>' +
            '<h3>' + (ctEstado.historico ? 'No hay pedidos en este momento' : 'No hay pedidos activos') + '</h3>' +
            '<p>' + (ctEstado.historico
                ? 'Los pedidos del día aparecerán aquí conforme los registres.'
                : 'Toca «Nuevo pedido» para anotar lo que pide un cliente de paso.') + '</p></div>';
        return;
    }

    if (ctEstado.cocina) {
        // La cocina ve PENDIENTES y LISTOS: lo que hay que preparar y lo que ya está en la barra.
        cont.innerHTML = (activos.length ? activos.map(ctTarjetaCocina).join('') : '<div class="tp-vacio"><i class="fas fa-check"></i><h3>Todo listo por ahora</h3></div>');
        return;
    }

    let aviso = '';
    if (porEntregar.length) {
        aviso = '<div class="ct-aviso-listo"><i class="fas fa-bell"></i> ' + porEntregar.length +
            (porEntregar.length === 1 ? ' pedido esperando entrega' : ' pedidos esperando entrega') + '</div>';
    }
    cont.innerHTML = aviso + ctEstado.pedidos.map(ctTarjeta).join('');
}

/** Etiquetas de pago y presencia del cliente. */
function ctPagoHtml(p) {
    const etiqueta = CT_PAGO[p.payment_status] || 'Por cobrar';
    const extra = p.payment_status === 'partial' ? ' ' + tpDinero(p.paid_amount) : '';
    return '<span class="ct-pago ct-pago-' + p.payment_status + '"><i class="fas fa-' +
        (p.payment_status === 'paid' ? 'circle-check' : (p.payment_status === 'partial' ? 'coins' : 'clock')) +
        '"></i> ' + etiqueta + extra + '</span>';
}

/**
 * Estado del cliente en un ICONO, para no llenar la tarjeta de texto: el color lo dice de un
 * vistazo y el `title` lo explica al pasar el ratón (o al mantener pulsado en tableta).
 */
function ctEstadoCliente(p) {
    const push = (p.push_dispositivos || 0) > 0;
    if (p.cliente_presente && push) {
        return { clase: 'ct-cli-ok', icono: 'fa-mobile-screen', texto: 'El cliente está viendo su pedido y recibirá el aviso en su teléfono' };
    }
    if (p.cliente_presente) {
        return { clase: 'ct-cli-ok', icono: 'fa-mobile-screen', texto: 'El cliente está viendo su pedido ahora mismo' };
    }
    if (push) {
        return { clase: 'ct-cli-push', icono: 'fa-paper-plane', texto: 'El cliente activó los avisos: se le puede notificar al teléfono' };
    }
    if (p.notified_at) {
        return { clase: 'ct-cli-aviso', icono: 'fa-bell', texto: 'Ya se le avisó, pero no ha abierto su enlace' };
    }
    return { clase: 'ct-cli-apagado', icono: 'fa-mobile-screen', texto: 'El cliente no ha abierto su enlace todavía' };
}

/** Artículos con su miniatura, para reconocerlos de un vistazo. */
function ctArticulosHtml(p, conImagen) {
    return (p.items || []).map(function (it) {
        const img = (typeof getRelativeImagePath === 'function') ? getRelativeImagePath(it.image_path) : null;
        const miniatura = conImagen
            ? '<span class="ct-linea-img">' + (img
                ? '<img src="' + tpEsc(img) + '" loading="lazy" decoding="async" alt="" onerror="this.parentNode.innerHTML=\'<i class=&quot;fas fa-utensils&quot;></i>\';">'
                : '<i class="fas fa-utensils"></i>') + '</span>'
            : '';
        return '<div class="ct-linea">' + miniatura +
            '<span class="ct-cant">' + tpCantidad(it.quantity) + '×</span>' +
            '<span class="ct-nombre">' + tpEsc(it.product_name) +
                (it.promotion_name ? '<span class="ct-promo-tag"><i class="fas fa-tags"></i> ' + tpEsc(it.promotion_name) + '</span>' : '') +
                (it.notes ? '<span class="ct-nota"> — ' + tpEsc(it.notes) + '</span>' : '') + '</span>' +
            '<span class="ct-importe">' + tpDinero(it.line_total) + '</span>' +
            '</div>';
    }).join('');
}

/**
 * Tarjeta del mostrador: compacta, con miniaturas, y con UN solo botón a la vista
 * (Entregar). Todo lo demás vive detrás del menú de tres puntos, para no estorbar.
 */
function ctTarjeta(p) {
    const acti = p.status === 'pending' || p.status === 'ready';
    const est = CT_ETIQUETA[p.status] || ['—', ''];
    const cli = ctEstadoCliente(p);
    const id = p.counter_order_id;

    const opciones = acti
        ? '<button type="button" data-ct-avisar="' + id + '"><i class="fas fa-bell"></i> Notificar al cliente</button>' +
          '<button type="button" data-ct-regenerar="' + id + '"><i class="fas fa-qrcode"></i> Volver a generar el QR</button>' +
          '<button type="button" data-ct-pago="' + p.counter_order_id + '"><i class="fas fa-money-bill"></i> Generar pago</button>' +
          '<button type="button" data-ct-kiosko="' + p.counter_order_id + '"><i class="fas fa-tv"></i> Mostrar en el kiosko</button>' +
          '<button type="button" class="peligro" data-ct-cancelar="' + p.counter_order_id + '"><i class="fas fa-ban"></i> Cancelar orden</button>'
        : '<button type="button" data-ct-regenerar="' + id + '"><i class="fas fa-qrcode"></i> Volver a generar el QR</button>';

    const pie = acti
        ? '<div class="ct-pie">' +
              '<div class="ct-pie-info">' +
                  '<span class="ct-total">' + tpDinero(p.total) + '</span>' +
                  '<span class="ct-min"><i class="fas fa-clock"></i> ' + p.minutos + ' min</span>' +
              '</div>' +
              '<button type="button" class="tp-btn primario ct-entregar" data-ct-entregar="' + id + '">' +
                  '<i class="fas fa-hand-holding-heart"></i> Entregar</button>' +
          '</div>'
        : '<div class="ct-pie"><span class="ct-total">' + tpDinero(p.total) + '</span></div>';

    return '<div class="ct-pedido ' + p.status + '" data-ct="' + id + '">' +
        '<div class="ct-cab">' +
            '<div class="ct-identidad">' +
                '<span class="ct-folio">#' + p.number + '</span>' +
                '<span class="ct-nombre-cliente">' + tpEsc(p.customer_name || 'Sin nombre') + '</span>' +
            '</div>' +
            '<div class="ct-meta">' +
                '<span class="ct-estado ' + est[1] + '">' + est[0] + '</span>' +
                ctPagoHtml(p) +
                '<span class="ct-cliente ' + cli.clase + '" title="' + tpEsc(cli.texto) + '" aria-label="' + tpEsc(cli.texto) + '">' +
                    '<i class="fas ' + cli.icono + '"></i></span>' +
                '<button type="button" class="ct-kebab" data-ct-kebab="' + id + '" aria-label="Más opciones" title="Más opciones">' +
                    '<i class="fas fa-ellipsis-vertical"></i></button>' +
            '</div>' +
        '</div>' +
        '<div class="ct-articulos">' + ctArticulosHtml(p, true) + '</div>' +
        (p.discount > 0 ? '<div class="ct-linea-descuento"><i class="fas fa-tags"></i> Promoción <strong>-' + tpDinero(p.discount) + '</strong></div>' : '') +
        (p.notes ? '<div class="ct-nota-pedido"><i class="fas fa-pen"></i> ' + tpEsc(p.notes) + '</div>' : '') +
        pie +
        '<div class="ct-menu hidden" data-ct-menu="' + id + '">' + opciones + '</div>' +
        '</div>';
}

/** Tarjeta de la cocina (solo lectura): grande, sin botones, con miniatura para reconocer. */
function ctTarjetaCocina(p) {
    const listo = p.status === 'ready';
    return '<div class="ct-cocina-card' + (listo ? ' listo' : '') + '">' +
        '<div class="ct-cocina-cab"><span class="ct-folio">#' + p.number + '</span>' +
        '<span class="ct-nombre-cliente">' + tpEsc(p.customer_name || 'Sin nombre') + '</span>' +
        (listo ? '<span class="ct-cocina-listo"><i class="fas fa-bell"></i> LISTO</span>' : '') +
        '<span class="ct-min"><i class="fas fa-clock"></i> ' + p.minutos + ' min</span></div>' +
        '<div class="ct-articulos">' + ctArticulosHtml(p, true) + '</div>' +
        (p.notes ? '<div class="ct-nota-pedido">' + tpEsc(p.notes) + '</div>' : '') +
        '</div>';
}

// ============================================================
// Alta de pedido
// ============================================================
async function ctNuevo() {
    ctEstado.nombre = '';
    ctEstado.items = [];
    ctEstado.busqueda = '';
    ctEstado.categoria = 'todas';
    ctEstado.calculo = null;
    const campo = document.getElementById('ctNombre');
    if (campo) campo.value = '';
    const buscar = document.getElementById('ctBuscar');
    if (buscar) buscar.value = '';

    if (!tpEstado.catalogo.length) {
        try { await tpCargarCatalogo(); } catch (e) { /* sin catálogo el modal lo dirá */ }
    }
    // Los precios con promoción se piden aparte: el catálogo del punto de venta trae el precio
    // de lista, y la rejilla tiene que mostrar el descuento en la propia tarjeta.
    await ctCargarPreciosDePromocion();
    ctPintarSeleccion();
    ctPintarProductos();
    // Siempre se empieza por los productos, con las pestañas listas (móvil y tableta).
    ctPrepararAlta();
    ctPestanaPrevia = null;   // al abrir no hubo desliz: no hay nada que animar
    ctPonerPestana('productos', true);
    tpAbrirModal('ctModalNuevo');
    setTimeout(function () { if (campo) campo.focus(); }, 60);
}

/**
 * Trae el catálogo del mostrador CON el precio ya con promociones (el mismo motor que cobra) y
 * se lo pega a los productos que ya tiene el punto de venta.
 *
 * Se hace por producto y sobre el catálogo existente para no duplicar la lista ni romper el
 * buscador y las categorías, que ya trabajan sobre `tpEstado.catalogo`. Si esto falla, la
 * rejilla sigue mostrando el precio de lista: es información de más, no un requisito para
 * vender.
 */
async function ctCargarPreciosDePromocion() {
    try {
        const datos = await tpPeticion(CT_API + '?catalogo=1');
        const lista = (datos && datos.products) || [];
        if (!lista.length || !tpEstado.catalogo.length) return;
        const porId = {};
        lista.forEach(function (p) { porId[Number(p.product_id)] = p; });
        tpEstado.catalogo.forEach(function (p) {
            const con = porId[Number(p.product_id)];
            if (!con) return;
            p.price = con.price;
            p.original_price = con.original_price;
            p.promo_price = con.promo_price;
            p.promotion_name = con.promotion_name;
            p.promo_hint = con.promo_hint;
        });
    } catch (e) { /* sin promociones en la lista; la cajera no pierde nada */ }
}

/**
 * La X del buscador: aparece sólo cuando hay algo escrito y deja cancelar la búsqueda de un
 * toque (borra y vuelve a pintar todo), devolviendo el foco al campo para seguir escribiendo.
 */
function ctActualizarBotonBuscar() {
    const campo = document.getElementById('ctBuscar');
    const x = document.getElementById('ctBuscarX');
    if (!campo || !x) return;
    x.classList.toggle('hidden', campo.value.trim() === '');
}

function ctPintarProductos() {
    const cont = document.getElementById('ctProductos');
    if (!cont) return;
    const q = ctEstado.busqueda.toLowerCase();
    const lista = tpEstado.catalogo.filter(function (p) {
        if (ctEstado.categoria !== 'todas' && String(p.category_id) !== String(ctEstado.categoria)) return false;
        if (q && String(p.product_name).toLowerCase().indexOf(q) === -1) return false;
        return true;
    });

    const cats = document.getElementById('ctCats');
    if (cats) {
        const usadas = {};
        tpEstado.catalogo.forEach(function (p) { if (p.category_id) usadas[Number(p.category_id)] = true; });
        let h = '<button type="button" class="tp-chip' + (ctEstado.categoria === 'todas' ? ' activo' : '') + '" data-ct-cat="todas">Todo</button>';
        (tpEstado.categorias || []).forEach(function (c) {
            if (!usadas[Number(c.category_id)]) return;
            h += '<button type="button" class="tp-chip' + (String(ctEstado.categoria) === String(c.category_id) ? ' activo' : '') + '" data-ct-cat="' + c.category_id + '">' + tpEsc(c.category_name) + '</button>';
        });
        cats.innerHTML = h;
    }

    if (!lista.length) {
        cont.innerHTML = '<div class="tp-vacio-mini">Nada que coincida con la búsqueda.</div>';
        return;
    }
    cont.innerHTML = lista.slice(0, 300).map(function (p) {
        const enLista = ctEstado.items.find(function (i) { return Number(i.product_id) === Number(p.product_id); });
        const img = (typeof getRelativeImagePath === 'function') ? getRelativeImagePath(p.image_path) : null;

        // Precios POR UNIDAD. El backend ya puede mandar el desglose (lista + con promoción),
        // pero hasta que esté desplegado la tarjeta se cae al precio de lista: nunca se rompe.
        const lista_ = Number(p.price) || 0;
        const original = (p.original_price === null || p.original_price === undefined) ? lista_ : Number(p.original_price);
        const real = (p.promo_price === null || p.promo_price === undefined) ? lista_ : Number(p.promo_price);
        const originalOk = isFinite(original) ? original : lista_;
        const realOk = isFinite(real) ? real : originalOk;
        // Medio centavo de tolerancia: con puras cuentas de flotantes no queremos pintar un
        // "descuento" que en realidad no existe.
        const hayDescuento = realOk < originalOk - 0.004;
        const pista = p.promo_hint ? String(p.promo_hint) : '';
        // El precio original (tachado) va arriba y el real abajo; cuando no hay promoción solo
        // se muestra el real, en una sola línea.
        const precios = '<div class="ct-prod-precios">' +
            (hayDescuento ? '<div class="ct-prod-precio-orig">' + tpDinero(originalOk) + '</div>' : '') +
            '<div class="ct-prod-precio">' + tpDinero(realOk) + '</div>' +
            '</div>';

        return '<button type="button" class="ct-prod' + (enLista ? ' elegido' : '') + '" data-ct-agregar="' + p.product_id + '">' +
            '<div class="ct-prod-img">' +
                '<span class="ct-prod-vacia"' + (img ? ' hidden' : '') + '><i class="fas fa-utensils"></i></span>' +
                (img ? '<img src="' + tpEsc(img) + '" loading="lazy" decoding="async" alt="" onerror="this.hidden=true;this.parentElement.querySelector(\'.ct-prod-vacia\').hidden=false;">' : '') +
                (enLista ? '<span class="ct-prod-badge">' + tpCantidad(enLista.quantity) + '</span>' : '') +
            '</div>' +
            '<div class="ct-prod-nombre">' + tpEsc(p.product_name) + '</div>' +
            (pista ? '<div class="ct-prod-promo"><i class="fas fa-tags"></i> ' + tpEsc(pista) + '</div>' : '') +
            precios +
            '</button>';
    }).join('');
}

function ctAgregar(product_id) {
    const p = tpEstado.catalogo.find(function (x) { return Number(x.product_id) === Number(product_id); });
    if (!p) return;
    const ya = ctEstado.items.find(function (i) { return Number(i.product_id) === Number(p.product_id); });
    if (ya) {
        ya.quantity += 1;
    } else {
        ctEstado.items.push({ product_id: Number(p.product_id), product_name: p.product_name, price: Number(p.price) || 0, quantity: 1, notas: '' });
    }
    ctPintarSeleccion();
    ctPintarProductos();
    ctProgramarPreview();
}

function ctBump(product_id, delta) {
    const i = ctEstado.items.findIndex(function (x) { return Number(x.product_id) === Number(product_id); });
    if (i < 0) return;
    ctEstado.items[i].quantity += delta;
    if (ctEstado.items[i].quantity <= 0) ctEstado.items.splice(i, 1);
    ctPintarSeleccion();
    ctPintarProductos();
    ctProgramarPreview();
}

/** Columna derecha: el pedido, con cantidades editables. */
function ctPintarSeleccion() {
    const cont = document.getElementById('ctSeleccion');
    ctActualizarCuentaAlta();
    if (!cont) return;
    if (!ctEstado.items.length) {
        cont.innerHTML = '<div class="ct-orden-vacia"><i class="fas fa-basket-shopping"></i><p>Toca los productos para agregarlos.</p></div>';
        ctPintarTotales(null);
        return;
    }
    const lineas = ctEstado.calculo && ctEstado.calculo.lines ? ctEstado.calculo.lines : null;
    cont.innerHTML = ctEstado.items.map(function (i) {
        const linea = lineas ? lineas.find(function (l) { return Number(l.product_id) === Number(i.product_id); }) : null;
        const precio = linea ? linea.unit_price : i.price;
        const promo = linea && linea.promotion_name ? '<div class="ct-sel-promo"><i class="fas fa-tags"></i> ' + tpEsc(linea.promotion_name) + '</div>' : '';
        return '<div class="ct-sel">' +
            '<div class="ct-sel-nombre">' + tpEsc(i.product_name) + promo + '</div>' +
            '<div class="ct-sel-controles">' +
                '<button type="button" class="ct-paso" data-ct-menos="' + i.product_id + '" aria-label="Quitar uno"><i class="fas fa-minus"></i></button>' +
                '<span class="ct-sel-cant">' + tpCantidad(i.quantity) + '</span>' +
                '<button type="button" class="ct-paso" data-ct-mas="' + i.product_id + '" aria-label="Agregar uno"><i class="fas fa-plus"></i></button>' +
            '</div>' +
            '<div class="ct-sel-importe">' + tpDinero(precio * i.quantity) + '</div>' +
            '</div>';
    }).join('');
    ctPintarTotales(ctEstado.calculo);
}

function ctPintarTotales(calculo) {
    const sub = document.getElementById('ctSubtotal');
    const tot = document.getElementById('ctTotal');
    const descLinea = document.getElementById('ctDescuentoLinea');
    const desc = document.getElementById('ctDescuento');
    const descNombre = document.getElementById('ctDescuentoNombre');

    if (!ctEstado.items.length) {
        if (sub) sub.textContent = tpDinero(0);
        if (tot) tot.textContent = tpDinero(0);
        if (descLinea) descLinea.classList.add('hidden');
        return;
    }
    // Sin vista previa todavía: se estima con el precio base.
    const base = ctEstado.items.reduce(function (a, i) { return a + i.price * i.quantity; }, 0);
    const subtotal = calculo ? calculo.subtotal : base;
    const total = calculo ? calculo.total : base;
    const descuento = calculo ? calculo.discount : 0;

    if (sub) sub.textContent = tpDinero(subtotal);
    if (tot) tot.textContent = tpDinero(total);
    if (descLinea && desc && descNombre) {
        descLinea.classList.toggle('hidden', !(descuento > 0));
        if (descuento > 0) {
            desc.textContent = '-' + tpDinero(descuento);
            descNombre.textContent = (calculo && calculo.promotion_name) ? calculo.promotion_name : 'Descuento por promoción';
        }
    }
}

let ctPreviewTimer = null;
function ctProgramarPreview() {
    if (ctPreviewTimer) clearTimeout(ctPreviewTimer);
    ctPreviewTimer = setTimeout(ctPreview, 350);
}

/** Vista previa: aplica las promociones del negocio sin guardar el pedido. */
async function ctPreview() {
    if (!ctEstado.items.length) { ctEstado.calculo = null; ctPintarTotales(null); return; }
    try {
        const r = await tpPeticion(CT_API, {
            method: 'POST',
            body: JSON.stringify({ action: 'preview', items: ctEstado.items.map(function (i) { return { product_id: i.product_id, quantity: i.quantity }; }) }),
        });
        ctEstado.calculo = r;
        ctPintarSeleccion();
    } catch (e) { /* si falla la vista previa, se sigue con el precio base */ }
}

async function ctGuardar() {
    if (ctEstado.guardando) return;
    const nombre = (document.getElementById('ctNombre').value || '').trim();
    const items = ctEstado.items.map(function (i) { return { product_id: i.product_id, quantity: i.quantity }; });
    if (!items.length) { tpAviso('Agrega al menos un producto', 'error'); return; }

    ctEstado.guardando = true;
    const btn = document.getElementById('ctGuardar');
    if (btn) btn.disabled = true;
    try {
        const pedido = await tpPeticion(CT_API, {
            method: 'POST',
            body: JSON.stringify({ action: 'create', customer_name: nombre || null, items: items }),
        });
        tpAviso('Pedido #' + pedido.number + ' registrado', 'success');
        tpCerrarModal('ctModalNuevo');
        ctEstado.historico = false;
        await ctCargar(true);
        ctMostrarEnlace(pedido);
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    } finally {
        ctEstado.guardando = false;
        if (btn) btn.disabled = false;
    }
}

// ============================================================
// Estado, aviso y pago
// ============================================================
async function ctAvisar(id) {
    try {
        const r = await tpPeticion(CT_API, { method: 'POST', body: JSON.stringify({ action: 'notify', counter_order_id: id }) });
        const push = Number(r.push_enviados || 0);
        tpAviso(push > 0
            ? 'Cliente avisado · notificación enviada a ' + push + ' dispositivo(s)'
            : 'Cliente avisado · se verá en su enlace', 'success');
        await ctCargar(true);
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    }
}

/**
 * Entregar: UN solo clic. Si el pedido aún no se había avisado, se avisa y se entrega en el
 * mismo paso — venta express: el cliente está enfrente y ya se llevó el producto, así que el
 * cajero no llena nada más (y el cliente igual recibe su aviso).
 */
async function ctEntregar(id) {
    const p = ctEstado.pedidos.find(function (x) { return Number(x.counter_order_id) === Number(id); });
    const venia = p ? p.status : 'ready';
    try {
        if (venia === 'pending') {
            await tpPeticion(CT_API, { method: 'POST', body: JSON.stringify({ action: 'notify', counter_order_id: id }) });
        }
        await tpPeticion(CT_API, { method: 'POST', body: JSON.stringify({ action: 'status', counter_order_id: id, status: 'completed' }) });
        tpAviso(venia === 'pending' ? 'Venta express: avisado y entregado' : 'Pedido entregado', 'success');
        await ctCargar(true);
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    }
}

/** Cierra todos los menús de tres puntos. */
function ctCerrarMenus() {
    document.querySelectorAll('[data-ct-menu]').forEach(function (m) { m.classList.add('hidden'); });
}

function ctCancelar(id) {
    const p = ctEstado.pedidos.find(function (x) { return Number(x.counter_order_id) === Number(id); });
    tpConfirmar({
        titulo: 'Cancelar el pedido',
        texto: 'Se cancela el pedido <strong>#' + (p ? p.number : id) + '</strong>' + (p && p.customer_name ? ' de ' + tpEsc(p.customer_name) : '') + '. Esta acción no se deshace.',
        boton: 'Cancelar pedido',
        peligro: true,
        alConfirmar: async function () {
            try {
                await tpPeticion(CT_API, { method: 'POST', body: JSON.stringify({ action: 'status', counter_order_id: id, status: 'cancelled', reason: 'Cancelado en mostrador' }) });
                tpAviso('Pedido cancelado', 'success');
                await ctCargar(true);
            } catch (e) {
                tpAviso(tpMensajeDeError(e), 'error');
            }
        },
    });
}

/** Modal de pago: por cobrar / adelanto / pagado completo. */
function ctAbrirPago(id) {
    const p = ctEstado.pedidos.find(function (x) { return Number(x.counter_order_id) === Number(id); });
    if (!p) return;
    ctEstado.pagoPedido = p;
    document.getElementById('ctPagoFolio').textContent = 'Pedido #' + p.number + (p.customer_name ? ' · ' + p.customer_name : '');
    document.getElementById('ctPagoTotal').textContent = tpDinero(p.total);
    const adelanto = document.getElementById('ctPagoAdelanto');
    if (adelanto) adelanto.value = p.payment_status === 'partial' ? p.paid_amount : '';
    ctPagoVolver();   // el modal siempre abre en el estado de opciones, sin confirmación a medias
    tpAbrirModal('ctModalPago');
}

/** Vuelve al estado normal del modal de pago (opciones visibles, confirmación oculta). */
function ctPagoVolver() {
    const ops = document.getElementById('ctPagoOpciones');
    const conf = document.getElementById('ctPagoConfirmar');
    if (ops) ops.classList.remove('hidden');
    if (conf) conf.classList.add('hidden');
    const campo = document.getElementById('ctPagoAdelantoCampo');
    if (campo) campo.classList.remove('hidden');
}

/**
 * El cobro completo pide confirmación, pero EN ESTE MISMO modal: no se abre otro encima.
 * Se ocultan las opciones y se pregunta si de verdad se recibió el dinero.
 */
function ctPagoConfirmarCompleto() {
    const p = ctEstado.pagoPedido;
    if (!p) return;
    document.getElementById('ctPagoOpciones').classList.add('hidden');
    const campo = document.getElementById('ctPagoAdelantoCampo');
    if (campo) campo.classList.add('hidden');
    document.getElementById('ctPagoConfirmarTexto').textContent =
        '¿Confirmas que recibiste ' + tpDinero(p.total) + ' y el pedido queda pagado por completo?';
    document.getElementById('ctPagoConfirmar').classList.remove('hidden');
}

async function ctGuardarPago(estado) {
    const p = ctEstado.pagoPedido;
    if (!p) return;
    const cuerpo = { action: 'payment', counter_order_id: p.counter_order_id, payment_status: estado };
    if (estado === 'partial') {
        cuerpo.paid_amount = Number(document.getElementById('ctPagoAdelanto').value || 0);
        if (!(cuerpo.paid_amount > 0)) { tpAviso('Escribe cuánto dio de adelanto', 'error'); return; }
    }
    try {
        await tpPeticion(CT_API, { method: 'POST', body: JSON.stringify(cuerpo) });
        tpAviso('Pago actualizado', 'success');
        tpCerrarModal('ctModalPago');
        await ctCargar(true);
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    }
}

// ============================================================
// QR / enlace
// ============================================================
function ctPedidoPorId(id) {
    return ctEstado.pedidos.find(function (x) { return Number(x.counter_order_id) === Number(id); });
}

async function ctAbrirEnlace(id) {
    let p = ctPedidoPorId(id);
    if (!p || !p.tracking_url) {
        try { p = await tpPeticion(CT_API + '?orden=' + id); } catch (e) { tpAviso(tpMensajeDeError(e), 'error'); return; }
    }
    ctMostrarEnlace(p);
}

/** Solo el QR (con marco blanco y esquinas redondeadas). Sin enlace a la vista. */
function ctMostrarEnlace(pedido) {
    if (!pedido || !pedido.tracking_url) { tpAviso('Este pedido no tiene enlace de seguimiento', 'error'); return; }
    document.getElementById('ctEnlaceFolio').textContent = 'Pedido #' + pedido.number;
    document.getElementById('ctEnlaceNombre').textContent = pedido.customer_name ? 'A nombre de ' + pedido.customer_name : '';
    const est = CT_ETIQUETA[pedido.status] || ['', ''];
    document.getElementById('ctEnlaceEstado').innerHTML = '<span class="ct-estado ' + est[1] + '">' + est[0] + '</span>';

    const qr = document.getElementById('ctEnlaceQR');
    qr.innerHTML = '';
    if (typeof QRCode === 'function') {
        new QRCode(qr, {
            text: pedido.tracking_url,
            width: 200,
            height: 200,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
    }
    tpAbrirModal('ctModalEnlace');
}

// ============================================================
// Pestañas del alta de pedido (móvil y tableta)
//
// En pantalla chica los productos y el pedido no caben cómodos uno al lado del otro, así que
// van en dos pestañas y cada una se queda con todo el alto. Se cambia tocando la pestaña o
// deslizando el dedo.
//
// El desliz usa el MISMO criterio que el resto de la aplicación (`ui-movil.js`, `comandas.js`):
// solo cuenta si el gesto es claramente horizontal — 45 px de recorrido y al menos 1.5 veces
// el movimiento vertical. Así, cuando alguien desplaza la lista de productos y el dedo se va
// torcido hacia un lado, NO cambia de pestaña sin querer. Además se ignora el gesto que empieza
// sobre un control (el buscador, una categoría, el botón de sumar): ahí el dedo hace otra cosa.
// ============================================================

var CT_ALTA_MIN = 45;   // px de recorrido horizontal para que cuente como desliz

// Pestaña que está visible ahora mismo. Se lleva aparte del DOM para saber, al cambiar, de qué
// lado entró la nueva zona y animar el desliz en la dirección correcta.
var ctPestanaPrevia = null;
var CT_ORDEN_PESTANAS = { productos: 0, pedido: 1 };

function ctPanelAlta() { return document.querySelector('#ctModalNuevo .ct-layout'); }

/** ¿Estamos en la pantalla donde hay pestañas? En escritorio se ven las dos columnas. */
function ctAltaEnPestanas() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
}

/** La zona nueva entra desde la derecha cuando se avanza hacia "Pedido" (y desde la izquierda al volver). */
function ctEntraDesdeLaDerecha(cual) {
    const desde = CT_ORDEN_PESTANAS[ctPestanaPrevia];
    if (desde === undefined) return true;   // sin referencia, da igual: se toma la derecha
    return CT_ORDEN_PESTANAS[cual] > desde;
}

/** Anima SOLO la zona de contenido que entra (ni la barra de pestañas ni el modal). */
function ctAnimarEntradaAlta(cual, desdeDerecha) {
    // Con "menos movimiento" activado el cambio es instantáneo, como pide el sistema.
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const zona = cual === 'pedido'
        ? document.querySelector('#ctModalNuevo .ct-orden')
        : document.querySelector('#ctModalNuevo .ct-picker');
    if (!zona) return;
    const clase = desdeDerecha ? 'ct-entra-derecha' : 'ct-entra-izquierda';
    zona.classList.remove('ct-entra-derecha', 'ct-entra-izquierda');
    void zona.offsetWidth;   // reinicia la animación si se repite el mismo lado dos veces
    zona.classList.add(clase);
    // La clase se quita al terminar (y por si acaso con un temporizador) para no dejarla colgada
    // peleando con el siguiente cambio.
    const limpiar = function () { zona.classList.remove(clase); };
    zona.addEventListener('animationend', limpiar, { once: true });
    setTimeout(limpiar, 450);
}

function ctPonerPestana(cual, sinVolverArriba) {
    const panel = ctPanelAlta();
    if (!panel) return;
    const cambio = ctPestanaPrevia !== cual;

    panel.setAttribute('data-pestana', cual);
    const caja = document.getElementById('ctPestanas');
    if (caja) {
        [].forEach.call(caja.querySelectorAll('[data-ct-pestana]'), function (b) {
            const activa = b.getAttribute('data-ct-pestana') === cual;
            b.classList.toggle('active', activa);
            b.setAttribute('aria-selected', activa ? 'true' : 'false');
        });
    }

    // La zona que entra se desliza desde el lado contrario al gesto (o al orden de las pestañas
    // si el cambio fue tocando). Se hace DESPUÉS de mostrar la zona, que si no no se anima.
    if (cambio) ctAnimarEntradaAlta(cual, ctEntraDesdeLaDerecha(cual));
    ctPestanaPrevia = cual;

    // Al cambiar de zona se empieza arriba, no a media lista.
    const zona = cual === 'pedido' ? document.getElementById('ctSeleccion') : document.getElementById('ctProductos');
    if (zona && !sinVolverArriba) zona.scrollTop = 0;
}

/** Cuántas cosas lleva el pedido, para verlo desde la pestaña de productos. */
function ctActualizarCuentaAlta() {
    const c = document.getElementById('ctCuentaPedido');
    if (!c) return;
    const n = (ctEstado.items || []).reduce(function (a, i) { return a + (Number(i.quantity) || 0); }, 0);
    c.textContent = n;
    c.classList.toggle('visible', n > 0);
}

function ctEscucharDeslizAlta(zona) {
    if (!zona || zona.dataset.ctDesliz === '1') return;
    zona.dataset.ctDesliz = '1';

    let x0 = 0, y0 = 0, siguiendo = false;

    // Un desliz no debe además agregar un producto: si el gesto acaba en desliz, se traga el
    // clic que el navegador pudiera disparar después (los productos son botones).
    zona.addEventListener('click', function (ev) {
        if (zona.dataset.ctClicBloqueado === '1') {
            ev.stopPropagation();
            ev.preventDefault();
        }
    }, true);

    zona.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) { siguiendo = false; return; }
        if (!ctAltaEnPestanas()) { siguiendo = false; return; }
        // Se ignora el gesto que empieza donde el dedo ESCRIBE o SELECCIONA (buscador,
        // cantidades, enlaces). Los botones SÍ cuentan: la rejilla de productos está llena de
        // botones y si no, el desliz no funcionaría justo en la zona donde uno lo intenta.
        // Un toque normal recorre menos de los 45 px que hacen falta, así que no hay riesgo.
        if (e.target.closest && e.target.closest('input, textarea, select, label, a')) {
            siguiendo = false;
            return;
        }
        x0 = e.touches[0].clientX;
        y0 = e.touches[0].clientY;
        siguiendo = true;
    }, { passive: true });

    zona.addEventListener('touchend', function (e) {
        if (!siguiendo) return;
        siguiendo = false;
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - x0, dy = t.clientY - y0;
        // Vertical, o apenas inclinado: era un desplazamiento de la lista, no un desliz.
        if (Math.abs(dx) < CT_ALTA_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        zona.dataset.ctClicBloqueado = '1';
        setTimeout(function () { zona.dataset.ctClicBloqueado = '0'; }, 400);
        ctPonerPestana(dx < 0 ? 'pedido' : 'productos');
    }, { passive: true });

    zona.addEventListener('touchcancel', function () { siguiendo = false; }, { passive: true });
}

function ctPrepararAlta() {
    const panel = ctPanelAlta();
    if (!panel) return;
    ctEscucharDeslizAlta(panel);
    const caja = document.getElementById('ctPestanas');
    if (caja && caja.dataset.ctListo !== '1') {
        caja.dataset.ctListo = '1';
        caja.addEventListener('click', function (ev) {
            const b = ev.target.closest('[data-ct-pestana]');
            if (b) ctPonerPestana(b.getAttribute('data-ct-pestana'));
        });
    }
}

// ============================================================
// Lector de QR: para recibir el pedido en el mostrador con el código del cliente
// ============================================================

var ctLector = null;        // instancia de Html5Qrcode mientras la cámara está abierta
var ctCodigoLeido = false;  // evita procesar el mismo código muchas veces por segundo

/** La librería del lector solo se descarga al abrir el lector (no pesa en el resto del POS). */
function ctCargarLector() {
    if (typeof Html5Qrcode === 'function') return Promise.resolve();
    return new Promise(function (res, rej) {
        const s = document.createElement('script');
        s.src = 'lib/html5-qrcode/html5-qrcode.min.js';
        s.onload = function () { res(); };
        s.onerror = function () { rej(new Error('No se pudo cargar el lector de códigos')); };
        document.head.appendChild(s);
    });
}

function ctAbrirEscaner() {
    ctCodigoLeido = false;
    const res = document.getElementById('ctEscanerResultado');
    if (res) { res.classList.add('hidden'); res.innerHTML = ''; }
    const pista = document.getElementById('ctEscanerPista');
    if (pista) {
        pista.innerHTML = '<i class="fas fa-qrcode"></i> Apunta la cámara al código del cliente.';
        pista.classList.remove('hidden');
    }
    tpAbrirModal('ctModalEscaner');
    ctCargarLector().then(ctArrancarCamara).catch(function (e) {
        const p = document.getElementById('ctEscanerPista');
        if (p) p.innerHTML = '<i class="fas fa-triangle-exclamation"></i> ' + tpEsc((e && e.message) || 'No se pudo abrir la cámara') + '. Puedes escribir el código abajo.';
    });
}

function ctArrancarCamara() {
    if (typeof Html5Qrcode !== 'function') return Promise.resolve();
    if (!ctLector) ctLector = new Html5Qrcode('ctLector', { verbose: false });
    const config = {
        fps: 10,
        qrbox: function (w, h) {
            let b = Math.floor(Math.min(w, h) * 0.72);
            if (b < 140) b = Math.max(120, Math.min(w, h) - 20);
            return { width: b, height: b };
        },
        rememberLastUsedCamera: true
    };
    return ctLector.start({ facingMode: 'environment' }, config, ctLeerCodigo, function () { /* cada frame fallido es normal */ })
        .catch(function (e) {
            const p = document.getElementById('ctEscanerPista');
            if (p) p.innerHTML = '<i class="fas fa-triangle-exclamation"></i> No se pudo abrir la cámara. Escribe el código o el enlace abajo.';
            throw new Error('No se pudo abrir la cámara. Revisa los permisos.');
        });
}

function ctDetenerCamara() {
    if (!ctLector) return;
    const l = ctLector;
    ctLector = null;
    try {
        l.stop().then(function () { return l.clear(); }).catch(function () { /* ya estaba parada */ });
    } catch (e) { /* nada que hacer */ }
}

function ctCerrarEscaner() {
    ctDetenerCamara();
    tpCerrarModal('ctModalEscaner');
}

/** Del código leído saca el token: sirve el enlace completo o el identificador suelto. */
function ctTokenDeCodigo(texto) {
    const t = String(texto || '').trim();
    if (!t) return '';
    const m = t.match(/[?&]t=([^&\s]+)/);
    if (m) return decodeURIComponent(m[1]);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return t;
    return '';
}

/** Pitido corto al leer, para no tener que mirar la pantalla. */
function ctPitar() {
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = ctEstado.audio || (ctEstado.audio = new AC());
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = 1320;
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.18);
    } catch (e) { /* sin sonido se sigue igual */ }
    try { if (navigator.vibrate) navigator.vibrate(90); } catch (e) {}
}

async function ctLeerCodigo(texto) {
    if (ctCodigoLeido) return;
    const token = ctTokenDeCodigo(texto);
    const pista = document.getElementById('ctEscanerPista');
    if (!token) {
        if (pista) pista.innerHTML = '<i class="fas fa-circle-question"></i> Ese código no es de un pedido. Prueba con el QR del cliente.';
        return;
    }
    ctCodigoLeido = true;
    ctPitar();
    try {
        const p = await tpPeticion(CT_API + '?token=' + encodeURIComponent(token));
        ctMostrarLeido(p);
    } catch (e) {
        ctCodigoLeido = false;
        if (pista) pista.innerHTML = '<i class="fas fa-triangle-exclamation"></i> ' + tpEsc(tpMensajeDeError(e));
    }
}

/** Enseña de qué pedido es el código y deja entregarlo ahí mismo. */
function ctMostrarLeido(p) {
    const pista = document.getElementById('ctEscanerPista');
    if (pista) pista.classList.add('hidden');
    const caja = document.getElementById('ctEscanerResultado');
    if (!caja) return;
    const est = CT_ETIQUETA[p.status] || ['—', ''];
    const cerrado = p.status === 'completed' || p.status === 'cancelled';

    caja.innerHTML =
        '<div class="ct-esc-pedido ' + p.status + '">' +
            '<div class="ct-esc-cab">' +
                '<span class="ct-folio">#' + p.number + '</span>' +
                '<span class="ct-nombre-cliente">' + tpEsc(p.customer_name || 'Sin nombre') + '</span>' +
                '<span class="ct-estado ' + est[1] + '">' + est[0] + '</span>' +
            '</div>' +
            '<div class="ct-articulos">' + ctArticulosHtml(p, true) + '</div>' +
            '<div class="ct-esc-pie">' +
                '<span class="ct-total">' + tpDinero(p.total) + '</span>' +
                ctPagoHtml(p) +
            '</div>' +
        '</div>' +
        '<div class="ct-esc-acciones">' +
            (cerrado
                ? '<span class="ct-esc-ya"><i class="fas fa-circle-info"></i> Este pedido ya está ' + (p.status === 'completed' ? 'entregado' : 'cancelado') + '.</span>'
                : '<button type="button" class="tp-btn primario" id="ctEscEntregar"><i class="fas fa-hand-holding-heart"></i> Entregar este pedido</button>') +
            '<button type="button" class="tp-btn" id="ctEscSeguir"><i class="fas fa-camera"></i> Escanear otro</button>' +
        '</div>';
    caja.classList.remove('hidden');

    const seguir = document.getElementById('ctEscSeguir');
    if (seguir) seguir.addEventListener('click', function () {
        ctCodigoLeido = false;
        caja.classList.add('hidden');
        if (pista) pista.classList.remove('hidden');
    });
    const entregar = document.getElementById('ctEscEntregar');
    if (entregar) entregar.addEventListener('click', async function () {
        entregar.disabled = true;
        await ctEntregar(p.counter_order_id);
        ctCerrarEscaner();
    });
}

// ============================================================
// Modo cocina (solo lectura)
// ============================================================
function ctPonerCocina(on) {
    ctEstado.cocina = on;
    document.body.classList.toggle('ct-cocina-on', on);
    const salir = document.getElementById('ctSalirCocina');
    if (salir) salir.classList.toggle('hidden', !on);
    const txt = document.getElementById('ctMenuCocinaTexto');
    if (txt) txt.textContent = on ? 'Salir de la vista cocina' : 'Vista cocina (solo lectura)';
    ctPintar();
}

// ============================================================
// Enlaces de eventos
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    const btnNuevo = document.getElementById('ctBtnNuevo');
    if (btnNuevo) btnNuevo.addEventListener('click', ctNuevo);
    const guardar = document.getElementById('ctGuardar');
    if (guardar) guardar.addEventListener('click', ctGuardar);
    const nombre = document.getElementById('ctNombre');
    if (nombre) nombre.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') ctGuardar(); });

    const buscar = document.getElementById('ctBuscar');
    if (buscar) buscar.addEventListener('input', function () { ctEstado.busqueda = this.value.trim(); ctPintarProductos(); });

    const cats = document.getElementById('ctCats');
    if (cats) cats.addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-ct-cat]');
        if (!b) return;
        ctEstado.categoria = b.getAttribute('data-ct-cat');
        ctPintarProductos();
    });

    const prods = document.getElementById('ctProductos');
    if (prods) prods.addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-ct-agregar]');
        if (b) ctAgregar(b.getAttribute('data-ct-agregar'));
    });

    const sel = document.getElementById('ctSeleccion');
    if (sel) sel.addEventListener('click', function (ev) {
        const mas = ev.target.closest('[data-ct-mas]');
        if (mas) { ctBump(mas.getAttribute('data-ct-mas'), 1); return; }
        const menos = ev.target.closest('[data-ct-menos]');
        if (menos) ctBump(menos.getAttribute('data-ct-menos'), -1);
    });

    const lista = document.getElementById('ctLista');
    if (lista) lista.addEventListener('click', function (ev) {
        // El menú de tres puntos se abre y se cierra aquí mismo.
        const kebab = ev.target.closest('[data-ct-kebab]');
        if (kebab) {
            ev.stopPropagation();
            const menu = document.querySelector('[data-ct-menu="' + kebab.getAttribute('data-ct-kebab') + '"]');
            const abierto = menu && !menu.classList.contains('hidden');
            ctCerrarMenus();
            if (menu && !abierto) menu.classList.remove('hidden');
            return;
        }
        const avisar = ev.target.closest('[data-ct-avisar]');
        if (avisar) { ctCerrarMenus(); avisar.disabled = true; ctAvisar(avisar.getAttribute('data-ct-avisar')); return; }
        const entregar = ev.target.closest('[data-ct-entregar]');
        if (entregar) { ctEntregar(entregar.getAttribute('data-ct-entregar')); return; }
        const regenerar = ev.target.closest('[data-ct-regenerar]');
        if (regenerar) { ctCerrarMenus(); ctAbrirEnlace(regenerar.getAttribute('data-ct-regenerar')); return; }
        const kiosko = ev.target.closest('[data-ct-kiosko]');
        if (kiosko) {
            ctCerrarMenus();
            const kid = kiosko.getAttribute('data-ct-kiosko');
            tpPeticion(CT_API, { method: 'POST', body: JSON.stringify({ action: 'kiosko', counter_order_id: Number(kid) }) })
                .then(function () { tpAviso('Mostrado en el kiosko', 'success'); })
                .catch(function (e) { tpAviso(tpMensajeDeError(e), 'error'); });
            return;
        }
        const cancelar = ev.target.closest('[data-ct-cancelar]');
        if (cancelar) { ctCerrarMenus(); ctCancelar(cancelar.getAttribute('data-ct-cancelar')); return; }
        const pago = ev.target.closest('[data-ct-pago]');
        if (pago) { ctCerrarMenus(); ctAbrirPago(pago.getAttribute('data-ct-pago')); return; }
    });
    // Un clic en cualquier otro lado cierra los menús abiertos.
    document.addEventListener('click', function (ev) {
        if (!ev.target.closest('[data-ct-menu]')) ctCerrarMenus();
    });

    // Modal de pago: el cobro completo se confirma dentro del mismo modal.
    document.querySelectorAll('[data-ct-pagar]').forEach(function (b) {
        b.addEventListener('click', function () {
            const estado = b.getAttribute('data-ct-pagar');
            if (estado === 'paid') { ctPagoConfirmarCompleto(); return; }
            ctGuardarPago(estado);
        });
    });
    const buscarX = document.getElementById('ctBuscarX');
    if (buscarX) buscarX.addEventListener('click', function () {
        const campo = document.getElementById('ctBuscar');
        if (!campo) return;
        campo.value = '';
        ctEstado.busqueda = '';
        ctPintarProductos();
        ctActualizarBotonBuscar();
        campo.focus();
    });
    const campoBuscar = document.getElementById('ctBuscar');
    if (campoBuscar) {
        campoBuscar.addEventListener('input', ctActualizarBotonBuscar);
        ctActualizarBotonBuscar();
    }

    const pagoSi = document.getElementById('ctPagoSi');
    if (pagoSi) pagoSi.addEventListener('click', function () { ctGuardarPago('paid'); });
    const pagoNo = document.getElementById('ctPagoNo');
    if (pagoNo) pagoNo.addEventListener('click', ctPagoVolver);

    // ── Lector de QR ──
    const btnEscaner = document.getElementById('ctBtnEscaner');
    if (btnEscaner) btnEscaner.addEventListener('click', ctAbrirEscaner);
    const menuEscaner = document.getElementById('ctMenuEscaner');
    if (menuEscaner) menuEscaner.addEventListener('click', function () { ctCerrarMenus(); ctAbrirEscaner(); });
    // Cualquier cierre del modal (Cerrar, la X, Esc) apaga la cámara.
    document.querySelectorAll('[data-cerrar="ctModalEscaner"]').forEach(function (b) {
        b.addEventListener('click', ctDetenerCamara);
    });
    const buscarCodigo = document.getElementById('ctCodigoBuscar');
    if (buscarCodigo) buscarCodigo.addEventListener('click', function () {
        const campo = document.getElementById('ctCodigoManual');
        const valor = campo ? campo.value.trim() : '';
        if (!valor) { tpAviso('Escribe o pega el código del pedido', 'error'); return; }
        ctCodigoLeido = false;
        ctLeerCodigo(valor);
    });
    const campoCodigo = document.getElementById('ctCodigoManual');
    if (campoCodigo) campoCodigo.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); if (buscarCodigo) buscarCodigo.click(); }
    });

    // Menú de tres puntos
    const menuBtn = document.getElementById('ctMenuBtn');
    const menu = document.getElementById('ctMenu');
    if (menuBtn && menu) {
        menuBtn.addEventListener('click', function (ev) { ev.stopPropagation(); menu.classList.toggle('hidden'); });
        document.addEventListener('click', function (ev) { if (!ev.target.closest('.ct-engranaje')) menu.classList.add('hidden'); });
    }
    const menuHistorico = document.getElementById('ctMenuHistorico');
    if (menuHistorico) menuHistorico.addEventListener('click', function () {
        ctEstado.historico = !ctEstado.historico;
        this.querySelector('span').textContent = ctEstado.historico ? 'Ver solo activos' : 'Ver entregados/cancelados';
        menu.classList.add('hidden');
        ctCargar(true);
    });
    const menuCocina = document.getElementById('ctMenuCocina');
    if (menuCocina) menuCocina.addEventListener('click', function () {
        menu.classList.add('hidden');
        ctPonerCocina(!ctEstado.cocina);
    });
    const salir = document.getElementById('ctSalirCocina');
    if (salir) salir.addEventListener('click', function () { ctPonerCocina(false); });

    // Tiempo real: tables.js reemite cada aviso de la tienda.
    document.addEventListener('tomodachi:realtime', function (ev) {
        const msg = ev.detail || {};
        if (msg.counter || (msg.event && String(msg.event).indexOf('counter_') === 0)) {
            ctCargar(true);
        }
    });

    // NADA de sondear cada 15 s: el mostrador ya se entera de todo por WebSocket (arriba), así que
    // esto eran llamadas repetidas y casi siempre vacías. Queda sólo una red de seguridad lenta
    // por si el socket se cae y el navegador no avisa: sirve para que el icono de "el cliente está
    // viendo" no se quede pegado para siempre. Con el socket sano no molesta a nadie.
    setInterval(function () {
        const panel = document.querySelector('[data-vista-panel="mostrador"]');
        const socket = window.WsRealtime && window.WsRealtime.estado ? window.WsRealtime.estado() : null;
        if (socket === 'conectado') return;      // el socket ya se encarga
        if (panel && !panel.classList.contains('hidden')) ctCargar(true);
    }, 90000);

    const params = new URLSearchParams(window.location.search);
    if (params.get('vista') === 'mostrador' && params.get('pantalla') === '1') {
        ctPonerCocina(true);
    }
});
