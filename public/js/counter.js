/**
 * Mostrador — pedidos de clientes de paso (sin mesa).
 *
 * La cajera anota lo que pide una persona (a nombre de quién), la cocina lo ve en una
 * pantalla de SOLO LECTURA y el cliente sigue su pedido por un QR/enlace. El estado lo cambia
 * la cajera: pendiente -> completado, o cancelado.
 *
 * Se apoya en los helpers globales de tables.js (tpPeticion, tpAviso, tpConfirmar, tpEsc,
 * tpDinero, tpAbrirModal/tpCerrarModal) y en su catálogo ya cargado (tpEstado.catalogo).
 * El tiempo real llega por el MISMO WebSocket de la tienda: tables.js reemite cada aviso
 * como `tomodachi:realtime` y aquí se refresca cuando cambia un pedido de mostrador.
 */

const CT_API = '../api/dining/counter.php';

const ctEstado = {
    pedidos: [],
    historico: false,
    cocina: false,
    // formulario de alta
    nombre: '',
    items: [],                 // [{product_id, product_name, price, quantity}]
    busqueda: '',
    categoria: 'todas',
    guardando: false,
    ordenEnlace: null,         // pedido cuyo QR/enlace se está mostrando
};

const CT_ETIQUETA = {
    pending: 'Pendiente',
    completed: 'Completado',
    cancelled: 'Cancelado',
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
    const pendientes = ctEstado.pedidos.filter(function (p) { return p.status === 'pending'; });

    // El tope del encabezado ("Mostrador"): cuántos están por entregar.
    const badge = document.getElementById('ctPendientes');
    if (badge) {
        badge.textContent = pendientes.length;
        badge.classList.toggle('hidden', pendientes.length === 0);
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
        cont.innerHTML = pendientes.map(ctTarjetaCocina).join('')
            || '<div class="tp-vacio"><i class="fas fa-check"></i><h3>Todo listo por ahora</h3></div>';
        return;
    }

    cont.innerHTML = ctEstado.pedidos.map(ctTarjeta).join('');
}

/** Tarjeta de la cajera: folio, nombre, artículos, estado y las acciones. */
function ctTarjeta(p) {
    const clases = p.status === 'pending' ? 'ct-pedido pendiente'
        : p.status === 'completed' ? 'ct-pedido completado' : 'ct-pedido cancelado';
    const mins = p.status === 'pending' ? '<i class="fas fa-clock"></i> ' + p.minutos + ' min' : '';

    const articulos = (p.items || []).map(function (it) {
        return '<div class="ct-linea">' +
            '<span class="ct-cant">' + tpCantidad(it.quantity) + '×</span>' +
            '<span class="ct-nombre">' + tpEsc(it.product_name) +
                (it.notes ? '<span class="ct-nota"> — ' + tpEsc(it.notes) + '</span>' : '') + '</span>' +
            '<span class="ct-importe">' + tpDinero(it.line_total) + '</span>' +
            '</div>';
    }).join('');

    let acciones = '';
    if (p.status === 'pending') {
        acciones =
            '<button type="button" class="tp-btn primario" data-ct-completar="' + p.counter_order_id + '"><i class="fas fa-check"></i> Completar</button>' +
            '<button type="button" class="tp-btn" data-ct-enlace="' + p.counter_order_id + '"><i class="fas fa-qrcode"></i> Enlace</button>' +
            '<button type="button" class="tp-btn peligro" data-ct-cancelar="' + p.counter_order_id + '"><i class="fas fa-ban"></i> Cancelar</button>';
    } else {
        acciones =
            '<button type="button" class="tp-btn" data-ct-enlace="' + p.counter_order_id + '"><i class="fas fa-qrcode"></i> Enlace</button>';
    }

    return '<div class="ct-pedido ' + clases + '" data-ct="' + p.counter_order_id + '">' +
        '<div class="ct-cab">' +
            '<div class="ct-identidad">' +
                '<span class="ct-folio">#' + p.number + '</span>' +
                '<span class="ct-nombre-cliente">' + tpEsc(p.customer_name || 'Sin nombre') + '</span>' +
            '</div>' +
            '<div class="ct-meta">' +
                '<span class="ct-estado ct-estado-' + p.status + '">' + CT_ETIQUETA[p.status] + '</span>' +
                '<span class="ct-min">' + mins + '</span>' +
            '</div>' +
        '</div>' +
        '<div class="ct-articulos">' + articulos + '</div>' +
        (p.notes ? '<div class="ct-nota-pedido"><i class="fas fa-pen"></i> ' + tpEsc(p.notes) + '</div>' : '') +
        '<div class="ct-pie">' +
            '<span class="ct-total">Total <strong>' + tpDinero(p.total) + '</strong></span>' +
            '<span class="ct-acciones">' + acciones + '</span>' +
        '</div>' +
        '</div>';
}

/** Tarjeta de la cocina (solo lectura): grande, sin botones, para verse a un metro. */
function ctTarjetaCocina(p) {
    const articulos = (p.items || []).map(function (it) {
        return '<div class="ct-linea">' +
            '<span class="ct-cant">' + tpCantidad(it.quantity) + '×</span>' +
            '<span class="ct-nombre">' + tpEsc(it.product_name) +
                (it.notes ? '<span class="ct-nota"> — ' + tpEsc(it.notes) + '</span>' : '') + '</span>' +
            '</div>';
    }).join('');
    return '<div class="ct-cocina-card">' +
        '<div class="ct-cocina-cab"><span class="ct-folio">#' + p.number + '</span>' +
        '<span class="ct-nombre-cliente">' + tpEsc(p.customer_name || 'Sin nombre') + '</span>' +
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
    const campo = document.getElementById('ctNombre');
    if (campo) campo.value = '';
    const buscar = document.getElementById('ctBuscar');
    if (buscar) buscar.value = '';

    if (!tpEstado.catalogo.length) {
        try { await tpCargarCatalogo(); } catch (e) { /* el modal muestra el error si no hay catálogo */ }
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

    // Chips de categoría
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
        return '<button type="button" class="tp-producto' + (enLista ? ' elegido' : '') + '" data-ct-agregar="' + p.product_id + '">' +
            '<div class="tp-producto-info">' +
                '<div class="tp-producto-nombre">' + tpEsc(p.product_name) + '</div>' +
                '<div class="tp-producto-meta">' + tpEsc(p.category_name || 'Sin categoría') + (enLista ? ' · ' + tpCantidad(enLista.quantity) + ' en el pedido' : '') + '</div>' +
            '</div>' +
            '<div class="tp-producto-precio">' + tpDinero(p.price) + '</div>' +
            '<i class="fas fa-plus" style="color:var(--primary-color, #39C5BB);margin-left:6px"></i>' +
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
        ctEstado.items.push({ product_id: Number(p.product_id), product_name: p.product_name, price: Number(p.price) || 0, quantity: 1 });
    }
    ctPintarSeleccion();
    ctPintarProductos();
}

function ctBump(product_id, delta) {
    const i = ctEstado.items.findIndex(function (x) { return Number(x.product_id) === Number(product_id); });
    if (i < 0) return;
    ctEstado.items[i].quantity += delta;
    if (ctEstado.items[i].quantity <= 0) ctEstado.items.splice(i, 1);
    ctPintarSeleccion();
    ctPintarProductos();
}

function ctTotal() {
    return ctEstado.items.reduce(function (a, i) { return a + i.price * i.quantity; }, 0);
}

function ctPintarSeleccion() {
    const cont = document.getElementById('ctSeleccion');
    if (!cont) return;
    const total = document.getElementById('ctTotal');
    if (total) total.textContent = tpDinero(ctTotal());

    if (!ctEstado.items.length) {
        cont.innerHTML = '<div class="tp-vacio-mini">Toca los productos para agregarlos al pedido.</div>';
        return;
    }
    cont.innerHTML = ctEstado.items.map(function (i) {
        return '<div class="ct-sel">' +
            '<div class="ct-sel-nombre">' + tpEsc(i.product_name) + '</div>' +
            '<div class="ct-sel-controles">' +
                '<button type="button" class="tp-btn tp-icono" data-ct-menos="' + i.product_id + '" aria-label="Quitar uno"><i class="fas fa-minus"></i></button>' +
                '<span class="ct-sel-cant">' + tpCantidad(i.quantity) + '</span>' +
                '<button type="button" class="tp-btn tp-icono" data-ct-mas="' + i.product_id + '" aria-label="Agregar uno"><i class="fas fa-plus"></i></button>' +
            '</div>' +
            '<div class="ct-sel-importe">' + tpDinero(i.price * i.quantity) + '</div>' +
            '</div>';
    }).join('');
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
        // Al registrarse se muestra el QR/enlace para que el cliente lo escanee al momento.
        ctMostrarEnlace(pedido);
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    } finally {
        ctEstado.guardando = false;
        if (btn) btn.disabled = false;
    }
}

// ============================================================
// Cambiar estado y enlace/QR
// ============================================================
async function ctCompletar(id) {
    try {
        await tpPeticion(CT_API, { method: 'POST', body: JSON.stringify({ action: 'status', counter_order_id: id, status: 'completed' }) });
        tpAviso('Pedido completado', 'success');
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

function ctMostrarEnlace(pedido) {
    if (!pedido || !pedido.tracking_url) { tpAviso('Este pedido no tiene enlace de seguimiento', 'error'); return; }
    ctEstado.ordenEnlace = pedido;
    document.getElementById('ctEnlaceFolio').textContent = 'Pedido #' + pedido.number + (pedido.customer_name ? ' · ' + pedido.customer_name : '');
    document.getElementById('ctEnlaceEstado').textContent = CT_ETIQUETA[pedido.status] || pedido.status;
    document.getElementById('ctEnlaceUrl').value = pedido.tracking_url;

    const qr = document.getElementById('ctEnlaceQR');
    qr.innerHTML = '';
    if (typeof QRCode === 'function') {
        new QRCode(qr, {
            text: pedido.tracking_url,
            width: 180,
            height: 180,
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
        const completar = ev.target.closest('[data-ct-completar]');
        if (completar) { ctCompletar(completar.getAttribute('data-ct-completar')); return; }
        const cancelar = ev.target.closest('[data-ct-cancelar]');
        if (cancelar) { ctCancelar(cancelar.getAttribute('data-ct-cancelar')); return; }
        const enlace = ev.target.closest('[data-ct-enlace]');
        if (enlace) ctAbrirEnlace(enlace.getAttribute('data-ct-enlace'));
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
        this.querySelector('span').textContent = ctEstado.historico ? 'Ver solo pendientes' : 'Ver completados/cancelados';
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

    const copiar = document.getElementById('ctEnlaceCopiar');
    if (copiar) copiar.addEventListener('click', function () {
        const campo = document.getElementById('ctEnlaceUrl');
        if (!campo) return;
        if (navigator.clipboard) navigator.clipboard.writeText(campo.value).then(function () { tpAviso('Enlace copiado', 'success'); });
        else { campo.select(); document.execCommand('copy'); tpAviso('Enlace copiado', 'success'); }
    });

    // Tiempo real: tables.js reemite cada aviso de la tienda. Un pedido de mostrador que
    // cambia en otra pantalla se refleja aquí sin recargar ni sondear.
    document.addEventListener('tomodachi:realtime', function (ev) {
        const msg = ev.detail || {};
        if (msg.counter || (msg.event && String(msg.event).indexOf('counter_') === 0)) {
            ctCargar(true);
        }
    });

    // Vista inicial de la cocina: tables.html?vista=mostrador&pantalla=1
    const params = new URLSearchParams(window.location.search);
    if (params.get('vista') === 'mostrador' && params.get('pantalla') === '1') {
        ctPonerCocina(true);
    }
});
