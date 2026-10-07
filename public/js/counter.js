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

function ctPresenciaHtml(p) {
    const push = (p.push_dispositivos || 0) > 0;
    if (p.cliente_presente) {
        return '<span class="ct-presencia"><i class="fas fa-mobile-screen"></i> ' +
            (push ? 'Cliente conectado · aviso por push' : 'El cliente está viendo') +
            (p.notify_granted ? ' · avisos activados' : '') + '</span>';
    }
    if (push) {
        return '<span class="ct-presencia"><i class="fas fa-paper-plane"></i> Aviso por push disponible</span>';
    }
    if (p.notified_at) {
        return '<span class="ct-presencia apagada"><i class="fas fa-bell"></i> Avisado (sin acuse del cliente)</span>';
    }
    return '<span class="ct-presencia apagada"><i class="fas fa-mobile-screen"></i> Sin abrir el enlace</span>';
}

/** Tarjeta de la cajera. */
function ctTarjeta(p) {
    const acti = p.status === 'pending' || p.status === 'ready';
    const est = CT_ETIQUETA[p.status] || ['—', ''];
    const mins = acti ? '<i class="fas fa-clock"></i> ' + p.minutos + ' min' : '';

    const articulos = (p.items || []).map(function (it) {
        return '<div class="ct-linea">' +
            '<span class="ct-cant">' + tpCantidad(it.quantity) + '×</span>' +
            '<span class="ct-nombre">' + tpEsc(it.product_name) +
                (it.promotion_name ? '<span class="ct-promo-tag"><i class="fas fa-tags"></i> ' + tpEsc(it.promotion_name) + '</span>' : '') +
                (it.notes ? '<span class="ct-nota"> — ' + tpEsc(it.notes) + '</span>' : '') + '</span>' +
            '<span class="ct-importe">' + tpDinero(it.line_total) + '</span>' +
            '</div>';
    }).join('');

    let acciones = '';
    // El aviso sale por push si el cliente ya lo autorizó; si no, igual se avisa
    // (la página del cliente se actualiza sola) — pero el botón lo dice claro.
    const puedePush = (p.push_dispositivos || 0) > 0;
    const txtAviso = puedePush ? 'Notificar por push' : 'Avisar que está listo';
    const icoAviso = puedePush ? 'fa-paper-plane' : 'fa-bell';
    if (p.status === 'pending') {
        acciones =
            '<button type="button" class="tp-btn primario" data-ct-avisar="' + p.counter_order_id + '"><i class="fas ' + icoAviso + '"></i> ' + txtAviso + '</button>' +
            '<button type="button" class="tp-btn" data-ct-pago="' + p.counter_order_id + '"><i class="fas fa-money-bill"></i> Pago</button>' +
            '<button type="button" class="tp-btn" data-ct-enlace="' + p.counter_order_id + '"><i class="fas fa-qrcode"></i> QR</button>' +
            '<button type="button" class="tp-btn peligro" data-ct-cancelar="' + p.counter_order_id + '"><i class="fas fa-ban"></i> Cancelar</button>';
    } else if (p.status === 'ready') {
        acciones =
            '<button type="button" class="tp-btn primario" data-ct-entregar="' + p.counter_order_id + '"><i class="fas fa-hand-holding-heart"></i> Entregar</button>' +
            '<button type="button" class="tp-btn" data-ct-avisar="' + p.counter_order_id + '"><i class="fas ' + icoAviso + '"></i> ' + txtAviso + '</button>' +
            '<button type="button" class="tp-btn" data-ct-pago="' + p.counter_order_id + '"><i class="fas fa-money-bill"></i> Pago</button>' +
            '<button type="button" class="tp-btn" data-ct-enlace="' + p.counter_order_id + '"><i class="fas fa-qrcode"></i> QR</button>' +
            '<button type="button" class="tp-btn peligro" data-ct-cancelar="' + p.counter_order_id + '"><i class="fas fa-ban"></i> Cancelar</button>';
    } else {
        acciones = '<button type="button" class="tp-btn" data-ct-enlace="' + p.counter_order_id + '"><i class="fas fa-qrcode"></i> QR</button>';
    }

    const descuento = p.discount > 0
        ? '<div class="ct-linea-descuento"><i class="fas fa-tags"></i> Descuento por promoción <strong>-' + tpDinero(p.discount) + '</strong></div>'
        : '';

    return '<div class="ct-pedido ' + p.status + '" data-ct="' + p.counter_order_id + '">' +
        '<div class="ct-cab">' +
            '<div class="ct-identidad">' +
                '<span class="ct-folio">#' + p.number + '</span>' +
                '<span class="ct-nombre-cliente">' + tpEsc(p.customer_name || 'Sin nombre') + '</span>' +
            '</div>' +
            '<div class="ct-meta">' +
                '<span class="ct-estado ' + est[1] + '">' + est[0] + '</span>' +
                ctPagoHtml(p) +
                '<span class="ct-min">' + mins + '</span>' +
            '</div>' +
        '</div>' +
        '<div class="ct-articulos">' + articulos + '</div>' +
        descuento +
        (p.notes ? '<div class="ct-nota-pedido"><i class="fas fa-pen"></i> ' + tpEsc(p.notes) + '</div>' : '') +
        '<div class="ct-pie">' +
            '<div class="ct-pie-info">' +
                '<span class="ct-total">Total <strong>' + tpDinero(p.total) + '</strong></span>' +
                ctPresenciaHtml(p) +
            '</div>' +
            '<span class="ct-acciones">' + acciones + '</span>' +
        '</div>' +
        '</div>';
}

/** Tarjeta de la cocina (solo lectura): grande, sin botones. */
function ctTarjetaCocina(p) {
    const articulos = (p.items || []).map(function (it) {
        return '<div class="ct-linea">' +
            '<span class="ct-cant">' + tpCantidad(it.quantity) + '×</span>' +
            '<span class="ct-nombre">' + tpEsc(it.product_name) +
                (it.notes ? '<span class="ct-nota"> — ' + tpEsc(it.notes) + '</span>' : '') + '</span>' +
            '</div>';
    }).join('');
    const listo = p.status === 'ready';
    return '<div class="ct-cocina-card' + (listo ? ' listo' : '') + '">' +
        '<div class="ct-cocina-cab"><span class="ct-folio">#' + p.number + '</span>' +
        '<span class="ct-nombre-cliente">' + tpEsc(p.customer_name || 'Sin nombre') + '</span>' +
        (listo ? '<span class="ct-cocina-listo"><i class="fas fa-bell"></i> LISTO</span>' : '') +
        '<span class="ct-min"><i class="fas fa-clock"></i> ' + p.minutos + ' min</span></div>' +
        '<div class="ct-articulos">' + articulos + '</div>' +
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
    ctPintarSeleccion();
    ctPintarProductos();
    tpAbrirModal('ctModalNuevo');
    setTimeout(function () { if (campo) campo.focus(); }, 60);
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
        return '<button type="button" class="ct-prod' + (enLista ? ' elegido' : '') + '" data-ct-agregar="' + p.product_id + '">' +
            '<div class="ct-prod-img">' +
                '<span class="ct-prod-vacia"' + (img ? ' hidden' : '') + '><i class="fas fa-utensils"></i></span>' +
                (img ? '<img src="' + tpEsc(img) + '" loading="lazy" decoding="async" alt="" onerror="this.hidden=true;this.parentElement.querySelector(\'.ct-prod-vacia\').hidden=false;">' : '') +
                (enLista ? '<span class="ct-prod-badge">' + tpCantidad(enLista.quantity) + '</span>' : '') +
            '</div>' +
            '<div class="ct-prod-nombre">' + tpEsc(p.product_name) + '</div>' +
            '<div class="ct-prod-precio">' + tpDinero(p.price) + '</div>' +
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

async function ctEntregar(id) {
    try {
        await tpPeticion(CT_API, { method: 'POST', body: JSON.stringify({ action: 'status', counter_order_id: id, status: 'completed' }) });
        tpAviso('Pedido entregado', 'success');
        await ctCargar(true);
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    }
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
        const avisar = ev.target.closest('[data-ct-avisar]');
        if (avisar) { avisar.disabled = true; ctAvisar(avisar.getAttribute('data-ct-avisar')); return; }
        const entregar = ev.target.closest('[data-ct-entregar]');
        if (entregar) { ctEntregar(entregar.getAttribute('data-ct-entregar')); return; }
        const cancelar = ev.target.closest('[data-ct-cancelar]');
        if (cancelar) { ctCancelar(cancelar.getAttribute('data-ct-cancelar')); return; }
        const pago = ev.target.closest('[data-ct-pago]');
        if (pago) { ctAbrirPago(pago.getAttribute('data-ct-pago')); return; }
        const enlace = ev.target.closest('[data-ct-enlace]');
        if (enlace) ctAbrirEnlace(enlace.getAttribute('data-ct-enlace'));
    });

    // Modal de pago: el cobro completo se confirma dentro del mismo modal.
    document.querySelectorAll('[data-ct-pagar]').forEach(function (b) {
        b.addEventListener('click', function () {
            const estado = b.getAttribute('data-ct-pagar');
            if (estado === 'paid') { ctPagoConfirmarCompleto(); return; }
            ctGuardarPago(estado);
        });
    });
    const pagoSi = document.getElementById('ctPagoSi');
    if (pagoSi) pagoSi.addEventListener('click', function () { ctGuardarPago('paid'); });
    const pagoNo = document.getElementById('ctPagoNo');
    if (pagoNo) pagoNo.addEventListener('click', ctPagoVolver);

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

    // La presencia del cliente se refresca sola cada 15 s (para que "está viendo" no se quede pegado).
    setInterval(function () {
        const panel = document.querySelector('[data-vista-panel="mostrador"]');
        if (panel && !panel.classList.contains('hidden')) ctCargar(true);
    }, 15000);

    const params = new URLSearchParams(window.location.search);
    if (params.get('vista') === 'mostrador' && params.get('pantalla') === '1') {
        ctPonerCocina(true);
    }
});
