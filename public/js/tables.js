/**
 * Puntos de servicio y cuentas — el mapa del salón y la herramienta del mesero.
 *
 * Qué es un punto de servicio: "dónde se atiende". La etiqueta es libre (Mesa 1, Barra,
 * Habitación 12) porque el producto es para giros distintos, no solo restaurantes.
 *
 * Una CUENTA puede abarcar varios puntos (mesas juntadas): por eso el listado de cuentas
 * devuelve sus puntos y aquí se pueden juntar y separar.
 *
 * TIEMPO REAL: el mapa y la cuenta abierta se suscriben al canal `store:<id>` del relay
 * (con token firmado). No hay botón de actualizar a propósito: lo que cambia en el salón
 * llega por WebSocket. Si el socket se cae, se reconecta solo y, mientras tanto, la tira
 * "en vivo" lo dice con todas sus letras.
 *
 * EL MESERO ANOTA: el panel izquierdo es el menú completo de la tienda. Lo que agrega
 * entra a la MISMA cuenta que ve el cliente, atribuido al personal.
 */

const TP_API_TABLES = '../api/dining/tables.php';
const TP_API_SESSION = '../api/dining/session.php';
const TP_API_ORDER = '../api/dining/order.php';
const TP_API_PRODUCTOS = '../api/inventory/products.php';
const TP_API_CATEGORIAS = '../api/inventory/categories.php';

const tpEstado = {
    puntos: [],
    cuentas: [],
    totales: null,
    menu: null,
    sinCarta: false,
    verApagados: false,
    puntoEditando: null,
    cuentaActual: null,
    qrActual: null,
    // Menú del panel izquierdo (para anotar). Se carga una vez y se filtra en memoria.
    catalogo: [],
    categorias: [],
    categoria: 'todas',
    busqueda: '',
    productoParaAgregar: null,
    tiempoReal: null,
    vivo: true,
};

// ============================================================
// Utilidades
// ============================================================
function tpEsc(v) {
    return String(v === null || v === undefined ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function tpDinero(n) {
    if (window.FormatUtils && FormatUtils.currency) return FormatUtils.currency(Number(n) || 0);
    return '$' + (Number(n) || 0).toFixed(2);
}

function tpCantidad(n) {
    if (window.FormatUtils && FormatUtils.qty) return FormatUtils.qty(n);
    return String(n);
}

function tpAviso(msg, tipo) {
    if (window.showNotification) window.showNotification(msg, tipo || 'info');
}

async function tpPeticion(url, opciones) {
    const cfg = Object.assign({ credentials: 'include', headers: { 'Content-Type': 'application/json' } }, opciones || {});
    const res = await fetch(url, cfg);
    let datos = null;
    try { datos = await res.json(); } catch (e) { datos = null; }
    if (!res.ok || !datos || datos.success === false) {
        const error = new Error((datos && datos.message) || 'No se pudo completar la operación');
        error.detalles = (datos && datos.error) || null;
        error.status = res.status;
        throw error;
    }
    return datos.data;
}

function tpMensajeDeError(err) {
    // Los errores de validación vienen como {campo: mensaje}.
    if (err && err.detalles && typeof err.detalles === 'object') {
        const primero = Object.values(err.detalles)[0];
        if (typeof primero === 'string' && primero) return primero;
    }
    return (err && err.message) || 'Ocurrió un error';
}

function tpAbrirModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('hidden'); }
function tpCerrarModal(id) { const m = document.getElementById(id); if (m) m.classList.add('hidden'); }
function tpAlgunModalAbierto() {
    return !!document.querySelector('.tp-overlay:not(.hidden)');
}

// ============================================================
// Cargar y pintar
// ============================================================
async function tpCargar(silencioso) {
    try {
        const urlPuntos = TP_API_TABLES + (tpEstado.verApagados ? '?todas=1' : '');
        const [puntos, cuentas] = await Promise.all([
            tpPeticion(urlPuntos),
            tpPeticion(TP_API_SESSION + '?abiertas=1'),
        ]);
        tpEstado.puntos = puntos.tables || [];
        tpEstado.totales = puntos.totales || null;
        tpEstado.menu = puntos.menu || null;
        tpEstado.sinCarta = !!puntos.sin_carta;
        tpEstado.cuentas = cuentas.checks || [];
        tpPintarResumen();
        tpPintar();
        if (!silencioso && !tpAlgunModalAbierto()) tpPintarCuenta();
    } catch (e) {
        if (!silencioso) {
            document.getElementById('tpContenido').innerHTML =
                '<div class="tp-vacio"><i class="fas fa-triangle-exclamation"></i><h3>No se pudieron cargar los puntos</h3><p>' +
                tpEsc(tpMensajeDeError(e)) + '</p></div>';
        }
    }
}

function tpPintarResumen() {
    const t = tpEstado.totales || { puntos: 0, ocupados: 0, libres: 0 };
    const abiertas = tpEstado.cuentas.length;
    const importe = (tpEstado.cuentas || []).reduce((s, c) => s + (Number(c.total) || 0), 0);
    let html = '';
    html += '<div class="tp-chip"><i class="fas fa-chair"></i> Puntos <strong>' + t.puntos + '</strong></div>';
    html += '<div class="tp-chip ' + (t.ocupados ? 'ocupado' : '') + '"><i class="fas fa-circle-dot"></i> Ocupados <strong>' + t.ocupados + '</strong></div>';
    html += '<div class="tp-chip"><i class="fas fa-circle-check"></i> Libres <strong>' + t.libres + '</strong></div>';
    html += '<div class="tp-chip"><i class="fas fa-receipt"></i> Cuentas abiertas <strong>' + abiertas + '</strong></div>';
    html += '<div class="tp-chip"><i class="fas fa-sack-dollar"></i> Por cobrar <strong>' + tpDinero(importe) + '</strong></div>';
    document.getElementById('tpResumen').innerHTML = html;
}

/** La cuenta abierta de un punto, si la tiene (por su punto o porque se juntó). */
function tpCuentaDePunto(tableId) {
    return tpEstado.cuentas.find(function (c) {
        return (c.puntos || []).some(function (p) { return Number(p.table_id) === Number(tableId); });
    }) || null;
}

function tpPintar() {
    const cont = document.getElementById('tpContenido');
    const puntos = tpEstado.puntos;

    if (!puntos.length) {
        cont.innerHTML =
            '<div class="tp-vacio">' +
            '<i class="fas fa-chair"></i>' +
            '<h3>Todavía no hay puntos de servicio</h3>' +
            '<p>Crea tu primer punto para empezar: “Mesa 1”, “Barra”, “Habitación 12”… lo que uses para saber dónde está cada cliente.</p>' +
            '<p style="margin-top:14px"><button type="button" class="tp-btn primario" id="tpVacioNuevo"><i class="fas fa-plus"></i> Crear el primero</button></p>' +
            '</div>';
        const b = document.getElementById('tpVacioNuevo');
        if (b) b.addEventListener('click', tpNuevoPunto);
        return;
    }

    let aviso = '';
    if (tpEstado.sinCarta) {
        aviso = '<div class="tp-aviso" style="margin-bottom:14px"><i class="fas fa-triangle-exclamation"></i> ' +
            'No hay ninguna carta publicada, así que el QR de los puntos todavía no lleva a ninguna parte. Se arregla publicando una carta.</div>';
    }

    const tarjetas = puntos.map(function (p) {
        const cuenta = tpCuentaDePunto(p.table_id);
        const apagado = Number(p.is_active) !== 1;
        const clase = 'tp-card' + (cuenta ? ' ocupado' : '') + (apagado ? ' apagado' : '');
        const estado = apagado
            ? '<span class="tp-estado apagado">Desactivado</span>'
            : (cuenta ? '<span class="tp-estado ocupado">Ocupado</span>' : '<span class="tp-estado">Libre</span>');

        let datos = '';
        if (cuenta) {
            datos += '<div class="tp-codigo">' + tpEsc(cuenta.code) + '</div>';
            datos += '<div class="tp-datos">' +
                '<span><i class="fas fa-clock"></i> ' + Number(cuenta.minutos_abierta) + ' min</span>' +
                '<span><i class="fas fa-user-group"></i> ' + Number(cuenta.personas) + '</span>' +
                '<span><i class="fas fa-utensils"></i> ' + Number(cuenta.items) + '</span>' +
                '<span><i class="fas fa-sack-dollar"></i> ' + tpDinero(cuenta.total) + '</span>' +
                '</div>';
            if ((cuenta.puntos || []).length > 1) {
                datos += '<div class="tp-datos"><span><i class="fas fa-link"></i> ' + tpEsc(cuenta.puntos_texto) + '</span></div>';
            }
        } else if (!apagado) {
            datos += '<div class="tp-datos"><span><i class="fas fa-circle-check"></i> Sin cuenta abierta</span></div>';
        }

        let acciones = '';
        if (apagado) {
            acciones += '<button type="button" class="tp-btn primario" data-accion="reactivar" data-id="' + p.table_id + '"><i class="fas fa-power-off"></i> Reactivar</button>';
        } else if (cuenta) {
            acciones += '<button type="button" class="tp-btn primario" data-accion="ver" data-id="' + p.table_id + '"><i class="fas fa-receipt"></i> Ver cuenta</button>';
            acciones += '<button type="button" class="tp-btn" data-accion="juntar" data-id="' + p.table_id + '"><i class="fas fa-link"></i> Juntar</button>';
        } else {
            acciones += '<button type="button" class="tp-btn primario" data-accion="abrir" data-id="' + p.table_id + '"><i class="fas fa-play"></i> Abrir cuenta</button>';
        }
        acciones += '<button type="button" class="tp-btn tp-icono" data-accion="qr" data-id="' + p.table_id + '" title="Ver el QR"><i class="fas fa-qrcode"></i></button>';
        acciones += '<button type="button" class="tp-btn tp-icono" data-accion="editar" data-id="' + p.table_id + '" title="Editar"><i class="fas fa-pen"></i></button>';
        if (!apagado) {
            acciones += '<button type="button" class="tp-btn tp-icono peligro" data-accion="desactivar" data-id="' + p.table_id + '" title="Desactivar"><i class="fas fa-ban"></i></button>';
        }

        return '<div class="' + clase + '">' +
            '<div class="tp-card-top">' +
                '<div><h3 class="tp-nombre">' + tpEsc(p.label) + '</h3>' +
                (p.zone ? '<p class="tp-zona">' + tpEsc(p.zone) + '</p>' : '') + '</div>' +
                estado +
            '</div>' +
            datos +
            '<div class="tp-acciones">' + acciones + '</div>' +
            '</div>';
    }).join('');

    cont.innerHTML = aviso + '<div class="tp-grid">' + tarjetas + '</div>';
}

// ============================================================
// Acciones sobre el punto
// ============================================================
function tpPuntoPorId(id) {
    return tpEstado.puntos.find(function (p) { return Number(p.table_id) === Number(id); }) || null;
}

function tpNuevoPunto() {
    tpEstado.puntoEditando = null;
    document.getElementById('tpPuntoTitulo').textContent = 'Nuevo punto de servicio';
    document.getElementById('tpPuntoNombre').value = '';
    document.getElementById('tpPuntoZona').value = '';
    document.getElementById('tpPuntoAviso').textContent = 'El QR de este punto se genera al guardarlo.';
    tpAbrirModal('tpModalPunto');
    setTimeout(function () { document.getElementById('tpPuntoNombre').focus(); }, 80);
}

function tpEditarPunto(id) {
    const p = tpPuntoPorId(id);
    if (!p) return;
    tpEstado.puntoEditando = p;
    document.getElementById('tpPuntoTitulo').textContent = 'Editar ' + p.label;
    document.getElementById('tpPuntoNombre').value = p.label;
    document.getElementById('tpPuntoZona').value = p.zone || '';
    document.getElementById('tpPuntoAviso').innerHTML = 'Se puede rotar el token del QR si el impreso se filtró, pero dejará de funcionar el que ya pegaste.' +
        ' <button type="button" class="tp-btn" id="tpRotarToken" style="margin-top:8px"><i class="fas fa-rotate"></i> Rotar el QR</button>';
    tpAbrirModal('tpModalPunto');

    const rotar = document.getElementById('tpRotarToken');
    if (rotar) {
        rotar.addEventListener('click', async function () {
            if (!confirm('¿Rotar el QR de ' + p.label + '? El QR que ya está impreso dejará de funcionar.')) return;
            try {
                const d = await tpPeticion(TP_API_TABLES, { method: 'PUT', body: JSON.stringify({ table_id: p.table_id, rotate_token: true }) });
                tpAviso('QR rotado: imprime el nuevo.', 'success');
                tpEstado.qrActual = d;
                tpMostrarQr(p);
                await tpCargar(true);
            } catch (e) { tpAviso(tpMensajeDeError(e), 'error'); }
        });
    }
}

async function tpGuardarPunto() {
    const label = document.getElementById('tpPuntoNombre').value.trim();
    const zone = document.getElementById('tpPuntoZona').value.trim();
    if (!label) { tpAviso('Escribe cómo se llama este punto', 'error'); return; }
    try {
        let d;
        if (tpEstado.puntoEditando) {
            d = await tpPeticion(TP_API_TABLES, { method: 'PUT', body: JSON.stringify({ table_id: tpEstado.puntoEditando.table_id, label: label, zone: zone }) });
        } else {
            d = await tpPeticion(TP_API_TABLES, { method: 'POST', body: JSON.stringify({ label: label, zone: zone }) });
        }
        // El mensaje lo pone el servidor: si el punto existía desactivado, avisa que lo
        // reactivó en vez de crear otro (y que su QR impreso sigue sirviendo).
        tpAviso((d && d.mensaje) || 'Punto guardado', 'success');
        tpCerrarModal('tpModalPunto');
        await tpCargar(true);
    } catch (e) { tpAviso(tpMensajeDeError(e), 'error'); }
}

async function tpDesactivarPunto(id) {
    const p = tpPuntoPorId(id);
    if (!p) return;
    if (!confirm('¿Desactivar ' + p.label + '? Su QR dejará de funcionar y saldrá del mapa.')) return;
    try {
        const d = await tpPeticion(TP_API_TABLES + '?table_id=' + id, { method: 'DELETE' });
        tpAviso(d && d.borrado ? 'Punto eliminado' : 'Punto desactivado', 'success');
        await tpCargar(true);
    } catch (e) { tpAviso(tpMensajeDeError(e), 'error'); }
}

async function tpReactivarPunto(id) {
    try {
        await tpPeticion(TP_API_TABLES, { method: 'PUT', body: JSON.stringify({ table_id: id, is_active: 1 }) });
        tpAviso('Punto reactivado', 'success');
        await tpCargar(true);
    } catch (e) { tpAviso(tpMensajeDeError(e), 'error'); }
}

// ============================================================
// QR
// ============================================================
function tpMostrarQr(punto) {
    const url = (tpEstado.qrActual && tpEstado.qrActual.url) || punto.url;
    const lienzo = document.getElementById('tpQrLienzo');
    lienzo.innerHTML = '';
    document.getElementById('tpQrTitulo').textContent = 'QR de ' + punto.label;
    document.getElementById('tpQrUrl').value = url || '';
    document.getElementById('tpQrAviso').innerHTML = url
        ? 'Imprímelo y pégalo en el punto. Al escanearlo, la carta se abre sabiendo que el cliente está en ' + tpEsc(punto.label) + '.'
        : 'Todavía no hay una carta publicada, así que este punto no tiene un QR útil. Publica una carta y vuelve aquí.';
    tpEstado.qrActual = Object.assign({}, tpEstado.qrActual, { punto: punto });

    if (url && window.QRCode) {
        new QRCode(lienzo, { text: url, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
    } else if (url) {
        lienzo.innerHTML = '<div class="tp-aviso">No se pudo dibujar el QR (falta la librería). El enlace sigue estando arriba.</div>';
    }
    tpAbrirModal('tpModalQr');
}

function tpQrImagen() {
    const nodo = document.getElementById('tpQrLienzo');
    const canvas = nodo.querySelector('canvas');
    if (canvas) return canvas.toDataURL('image/png');
    const img = nodo.querySelector('img');
    if (img && img.src) return img.src;
    return null;
}

function tpNombreArchivoQr() {
    const p = (tpEstado.qrActual && tpEstado.qrActual.punto) || {};
    return 'qr-' + String(p.label || 'punto').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.png';
}

// ============================================================
// Cuenta: detalle y acciones
// ============================================================
async function tpVerCuenta(tableId) {
    const cuenta = tpCuentaDePunto(tableId);
    if (!cuenta) return;
    // El modal se abre ANTES de cargar: tpPintarCuenta no pinta si no hay modal abierto
    // (para no repintar en segundo plano), así que abrirlo después dejaba el "Cargando…".
    tpAbrirModal('tpModalCuenta');
    await tpCargarCuenta(cuenta.session_id);
}

async function tpCargarCuenta(sessionId) {
    const cont = document.getElementById('tpCuentaPedido');
    if (cont) cont.innerHTML = '<div class="tp-vacio-mini"><i class="fas fa-spinner fa-spin"></i> Cargando la cuenta…</div>';
    try {
        const d = await tpPeticion(TP_API_SESSION + '?cuenta=' + sessionId);
        tpEstado.cuentaActual = d;
        // El catálogo se carga una vez por sesión de pantalla; luego se filtra en memoria.
        if (!tpEstado.catalogo.length) await tpCargarCatalogo();
        tpPintarCuenta();
    } catch (e) {
        if (cont) cont.innerHTML = '<div class="tp-vacio-mini">' + tpEsc(tpMensajeDeError(e)) + '</div>';
    }
}

// ============================================================
// El menú del panel izquierdo: con esto el mesero anota por los clientes
// ============================================================
async function tpCargarCatalogo() {
    try {
        const cats = await tpPeticion(TP_API_CATEGORIAS);
        tpEstado.categorias = Array.isArray(cats) ? cats : [];
    } catch (e) { tpEstado.categorias = []; }

    try {
        const prods = await tpPeticion(TP_API_PRODUCTOS + '?context=pos');
        // Lo que no se vende no se anota: ingredientes y lo oculto del POS quedan fuera.
        tpEstado.catalogo = (Array.isArray(prods) ? prods : []).filter(function (p) {
            return Number(p.is_ingredient) !== 1 && Number(p.hidden_in_pos) !== 1;
        });
    } catch (e) { tpEstado.catalogo = []; }

    tpPintarCategorias();
    tpPintarCatalogo();
}

function tpPintarCategorias() {
    const cont = document.getElementById('tpMenuCategorias');
    if (!cont) return;
    const usadas = {};
    tpEstado.catalogo.forEach(function (p) { if (p.category_id) usadas[Number(p.category_id)] = true; });

    let html = '<button type="button" class="tp-chip' + (tpEstado.categoria === 'todas' ? ' activo' : '') + '" data-cat="todas">Todo</button>';
    tpEstado.categorias.forEach(function (c) {
        if (!usadas[Number(c.category_id)]) return;   // no inventes categorías vacías
        html += '<button type="button" class="tp-chip' + (String(tpEstado.categoria) === String(c.category_id) ? ' activo' : '') +
            '" data-cat="' + c.category_id + '">' + tpEsc(c.category_name) + '</button>';
    });
    cont.innerHTML = html;
}

function tpPintarCatalogo() {
    const cont = document.getElementById('tpMenuProductos');
    if (!cont) return;
    const q = tpEstado.busqueda.toLowerCase();
    const lista = tpEstado.catalogo.filter(function (p) {
        if (tpEstado.categoria !== 'todas' && String(p.category_id) !== String(tpEstado.categoria)) return false;
        if (q && String(p.product_name).toLowerCase().indexOf(q) === -1) return false;
        return true;
    });

    if (!lista.length) {
        cont.innerHTML = '<div class="tp-vacio-mini">Nada que coincida con la búsqueda.</div>';
        return;
    }
    cont.innerHTML = lista.slice(0, 300).map(function (p) {
        return '<button type="button" class="tp-producto" data-producto="' + p.product_id + '">' +
            '<div class="tp-producto-info">' +
                '<div class="tp-producto-nombre">' + tpEsc(p.product_name) + '</div>' +
                '<div class="tp-producto-meta">' + tpEsc(p.category_name || 'Sin categoría') + '</div>' +
            '</div>' +
            '<div class="tp-producto-precio">' + tpDinero(p.price) + '</div>' +
            '<i class="fas fa-plus" style="color:var(--primary-color, #39C5BB);margin-left:6px"></i>' +
            '</button>';
    }).join('');
}

/** Abre la hoja de cantidad y notas para el producto tocado. */
function tpAbrirAgregar(productId) {
    const p = tpEstado.catalogo.filter(function (x) { return String(x.product_id) === String(productId); })[0];
    if (!p) return;
    tpEstado.productoParaAgregar = p;
    document.getElementById('tpAgregarTitulo').textContent = p.product_name + ' · ' + tpDinero(p.price);
    document.getElementById('tpAgregarCantidad').value = 1;
    document.getElementById('tpAgregarNotas').value = '';
    tpAbrirModal('tpModalAgregar');
    // El foco en la cantidad deja agregarlo varias veces sin tocar el ratón.
    setTimeout(function () { document.getElementById('tpAgregarCantidad').focus(); }, 80);
}

/** Lo que anota el mesero entra a la MISMA cuenta que ve el cliente. */
async function tpAgregarALaCuenta(productId, cantidad, notas) {
    const d = tpEstado.cuentaActual;
    if (!d) return;
    const item = { product_id: Number(productId), quantity: Number(cantidad) };
    if (notas) item.notes = notas;
    try {
        await tpPeticion(TP_API_ORDER, { method: 'POST', body: JSON.stringify({ session_id: d.session.session_id, items: [item] }) });
        await tpCargarCuenta(d.session.session_id);
        await tpCargar(true);
        tpAviso('Agregado a la cuenta ' + d.session.code, 'success');
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    }
}

async function tpQuitarLinea(itemId) {
    const d = tpEstado.cuentaActual;
    if (!d) return;
    try {
        await tpPeticion(TP_API_ORDER, { method: 'POST', body: JSON.stringify({ session_id: d.session.session_id, action: 'remove', order_item_id: Number(itemId) }) });
        await tpCargarCuenta(d.session.session_id);
        await tpCargar(true);
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    }
}

/** Manda a preparación lo pendiente (el mesero cierra la ronda). */
async function tpEnviarACocina() {
    const d = tpEstado.cuentaActual;
    if (!d) return;
    const boton = document.getElementById('tpCuentaEnviar');
    boton.disabled = true;
    try {
        await tpPeticion(TP_API_ORDER, { method: 'POST', body: JSON.stringify({ session_id: d.session.session_id, action: 'send' }) });
        await tpCargarCuenta(d.session.session_id);
        tpAviso('Enviado a preparación', 'success');
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
        boton.disabled = false;
    }
}

function tpVerQrCuenta() {
    const d = tpEstado.cuentaActual;
    if (!d) return;
    if (!d.url_cuenta) {
        tpAviso('La tienda no tiene una carta activa: todavía no hay enlace para el cliente', 'error');
        return;
    }
    tpMostrarQr({ label: 'Cuenta ' + d.session.code, url: d.url_cuenta, esCuenta: true });
    document.getElementById('tpQrTitulo').textContent = 'QR de la cuenta ' + d.session.code;
    document.getElementById('tpQrAviso').innerHTML =
        'El cliente escanea y entra DIRECTO a esta cuenta: solo pone su nombre y pide. ' +
        'El QR impreso del punto sirve igual, pero ahí el código lo autoriza el personal a mano.';
}

function tpPintarCuenta() {
    if (!tpAlgunModalAbierto()) return;
    const d = tpEstado.cuentaActual;
    if (!d) return;
    const s = d.session;
    const pausado = Number(s.ordering_enabled) !== 1;

    document.getElementById('tpCuentaCodigo').textContent = s.code || '----';
    const puntos = d.puntos || [];
    document.getElementById('tpCuentaTitulo').textContent = 'Cuenta de ' +
        (puntos.map(function (p) { return p.label; }).join(' + ') || 'sin punto de servicio');
    document.getElementById('tpCuentaSub').innerHTML =
        '<i class="fas fa-clock"></i> ' + Number(d.minutos_abierta || 0) + ' min' +
        ' · <i class="fas fa-user-group"></i> ' + (s.participants || []).length + ' persona(s)' +
        ' · ' + (pausado ? 'pedidos en pausa' : 'pueden pedir');

    document.getElementById('tpConfigPausaTexto').textContent = pausado ? 'Reanudar pedidos' : 'Pausar pedidos';

    // El total, arriba y en el listado: es lo primero que se mira.
    const total = tpDinero(s.totals.total);
    document.getElementById('tpCuentaTotal').textContent = total;
    document.getElementById('tpTabTotal').textContent = total;

    tpPintarPedido(d);
}

function tpPintarPedido(d) {
    const s = d.session;
    const cont = document.getElementById('tpCuentaPedido');
    if (!cont) return;

    const personas = {};
    (s.participants || []).forEach(function (p) { personas[Number(p.participant_id)] = p.display_name || 'Comensal'; });

    // El pedido se agrupa por persona; lo que anotó el personal va aparte, con su nombre.
    const grupos = {};
    (s.items || []).forEach(function (it) {
        const clave = it.participant_id ? 'p' + it.participant_id : (it.added_by === 'staff' ? 'personal' : 'sin');
        if (!grupos[clave]) {
            grupos[clave] = {
                titulo: it.participant_id
                    ? (personas[Number(it.participant_id)] || it.participant_name || 'Comensal')
                    : (it.added_by === 'staff' ? 'Anotado por el personal' : 'Sin asignar'),
                lineas: [],
                total: 0,
            };
        }
        grupos[clave].lineas.push(it);
        if (it.status !== 'cancelled') grupos[clave].total += Number(it.line_total || 0);
    });

    const claves = Object.keys(grupos);
    if (!claves.length) {
        cont.innerHTML = '<div class="tp-aviso">Todavía no hay nada pedido en esta cuenta. Anota del menú de la izquierda.</div>';
    } else {
        cont.innerHTML = claves.map(function (k) {
            const g = grupos[k];
            return '<div class="tp-grupo-persona">' +
                '<div class="tp-grupo-titulo"><span><i class="fas fa-user"></i> ' + tpEsc(g.titulo) + '</span><span>' + tpDinero(g.total) + '</span></div>' +
                g.lineas.map(tpLineaPedido).join('') +
                '</div>';
        }).join('');
    }

    const pendientes = (s.items || []).filter(function (it) { return it.status === 'pending'; });
    const importe = pendientes.reduce(function (a, it) { return a + Number(it.line_total || 0); }, 0);
    document.getElementById('tpCuentaPendientes').innerHTML = pendientes.length
        ? '<i class="fas fa-clock"></i> ' + pendientes.length + ' sin enviar · ' + tpDinero(importe)
        : '<i class="fas fa-circle-check"></i> Todo enviado a preparación';
    document.getElementById('tpCuentaEnviar').disabled = pendientes.length === 0;
}

function tpLineaPedido(it) {
    const cancelada = it.status === 'cancelled';
    // El borde de la izquierda dice el estado de un vistazo, sin leer.
    const clase = { pending: 'pendiente', sent: 'enviado', preparing: 'enviado', ready: 'listo', served: 'listo', cancelled: 'cancelada' }[it.status] || 'pendiente';
    return '<div class="tp-linea ' + clase + '">' +
        '<div class="tp-linea-cant">' + tpCantidad(it.quantity) + '×</div>' +
        '<div class="tp-linea-info">' +
            '<div class="tp-linea-nombre"' + (cancelada ? ' style="text-decoration:line-through;opacity:.55"' : '') + '>' + tpEsc(it.product_name) + '</div>' +
            (it.notes ? '<div class="tp-linea-notas"><i class="fas fa-pen"></i> ' + tpEsc(it.notes) + '</div>' : '') +
            '<div class="tp-linea-estado">' + tpEsc(tpEtiquetaEstado(it.status)) + '</div>' +
        '</div>' +
        '<div class="tp-linea-importe">' + tpDinero(it.line_total) + '</div>' +
        (it.status === 'pending'
            ? '<button type="button" class="tp-linea-quitar" data-quitar-linea="' + it.order_item_id + '" title="Quitar de la cuenta"><i class="fas fa-xmark"></i></button>'
            : '') +
        '</div>';
}

function tpEtiquetaEstado(estado) {
    const mapa = {
        pending: 'por enviar', sent: 'en cocina', preparing: 'preparando',
        ready: 'listo', served: 'servido', cancelled: 'cancelado',
    };
    return mapa[estado] || estado;
}

async function tpAccionCuenta(accion) {
    const d = tpEstado.cuentaActual;
    if (!d) return;
    const sessionId = d.session.session_id;
    try {
        if (accion === 'pause' || accion === 'resume') {
            await tpPeticion(TP_API_SESSION, { method: 'POST', body: JSON.stringify({ action: accion, session_id: sessionId }) });
            tpAviso(accion === 'pause' ? 'Pedidos en pausa' : 'Pedidos reanudados', 'success');
        } else if (accion === 'close') {
            if (!confirm('¿Cerrar la cuenta? El cobro se hace aparte (por ahora no genera la venta).')) return;
            await tpPeticion(TP_API_SESSION, { method: 'POST', body: JSON.stringify({ action: 'close', session_id: sessionId }) });
            tpAviso('Cuenta cerrada', 'success');
            tpCerrarModal('tpModalCuenta');
        } else if (accion === 'cancelar') {
            const campo = document.getElementById('tpCancelarMotivo');
            campo.value = '';
            tpCerrarModal('tpModalCuenta');
            tpAbrirModal('tpModalCancelar');
            setTimeout(function () { campo.focus(); }, 80);
            return;
        }
        await tpCargarCuenta(sessionId);
        await tpCargar(true);
    } catch (e) { tpAviso(tpMensajeDeError(e), 'error'); }
}

async function tpSepararPunto(sessionId, tableId) {
    try {
        const d = await tpPeticion(TP_API_SESSION, { method: 'POST', body: JSON.stringify({ action: 'remove_point', session_id: sessionId, table_id: tableId }) });
        tpAviso(d.mensaje || 'Punto separado', 'success');
        await tpCargarCuenta(sessionId);
        await tpCargar(true);
    } catch (e) { tpAviso(tpMensajeDeError(e), 'error'); }
}

function tpJuntarPunto(tableId) {
    const cuenta = tpCuentaDePunto(tableId);
    if (!cuenta) return;
    const yaEnCuenta = (cuenta.puntos || []).map(function (p) { return Number(p.table_id); });
    const libres = tpEstado.puntos.filter(function (p) {
        return Number(p.is_active) === 1 && yaEnCuenta.indexOf(Number(p.table_id)) === -1;
    });

    const cuerpo = document.getElementById('tpJuntarCuerpo');
    if (!libres.length) {
        cuerpo.innerHTML = '<div class="tp-aviso">No hay otros puntos que se puedan juntar. Crea otro punto primero.</div>';
        tpAbrirModal('tpModalJuntar');
        return;
    }
    cuerpo.innerHTML = '<div class="tp-aviso">La cuenta ' + tpEsc(cuenta.code) + ' quedará con los dos puntos: un solo folio y un solo cobro.</div>' +
        libres.map(function (p) {
            const ocupado = tpCuentaDePunto(p.table_id);
            return '<button type="button" class="tp-punto-opcion" data-juntar="' + p.table_id + '"' + (ocupado ? ' disabled title="Ese punto ya tiene una cuenta abierta"' : '') + '>' +
                tpEsc(p.label) + (p.zone ? ' <span style="color:var(--text-muted)">· ' + tpEsc(p.zone) + '</span>' : '') +
                (ocupado ? ' <span style="color:var(--danger-color)">· ocupado por ' + tpEsc(ocupado.code) + '</span>' : '') +
                '</button>';
        }).join('');
    tpAbrirModal('tpModalJuntar');
}

// ============================================================
// Eventos
// ============================================================
document.addEventListener('DOMContentLoaded', async function () {
    // Cualquier modal se cierra con su X o con el botón de cancelar.
    document.querySelectorAll('[data-cerrar]').forEach(function (b) {
        b.addEventListener('click', function () { tpCerrarModal(b.getAttribute('data-cerrar')); });
    });
    document.querySelectorAll('.tp-overlay').forEach(function (o) {
        o.addEventListener('click', function (ev) { if (ev.target === o) o.classList.add('hidden'); });
    });

    document.getElementById('tpBtnNuevo').addEventListener('click', tpNuevoPunto);
    document.getElementById('tpBtnApagados').addEventListener('click', function () {
        tpEstado.verApagados = !tpEstado.verApagados;
        this.className = 'tp-btn' + (tpEstado.verApagados ? ' primario' : '');
        this.innerHTML = '<i class="fas fa-eye' + (tpEstado.verApagados ? '-slash' : '') + '"></i> ' + (tpEstado.verApagados ? 'Ocultar desactivados' : 'Ver desactivados');
        tpCargar();
    });
    document.getElementById('tpPuntoGuardar').addEventListener('click', tpGuardarPunto);
    document.getElementById('tpPuntoNombre').addEventListener('keydown', function (e) { if (e.key === 'Enter') tpGuardarPunto(); });

    // Acciones de cada tarjeta
    document.getElementById('tpContenido').addEventListener('click', async function (ev) {
        const b = ev.target.closest('[data-accion]');
        if (!b) return;
        const id = b.getAttribute('data-id');
        const accion = b.getAttribute('data-accion');
        const punto = tpPuntoPorId(id);
        if (accion === 'nuevo') return tpNuevoPunto();
        if (accion === 'editar') return tpEditarPunto(id);
        if (accion === 'qr') return tpMostrarQr(punto);
        if (accion === 'desactivar') return tpDesactivarPunto(id);
        if (accion === 'reactivar') return tpReactivarPunto(id);
        if (accion === 'ver') return tpVerCuenta(id);
        if (accion === 'juntar') return tpJuntarPunto(id);
        if (accion === 'abrir') {
            b.disabled = true;
            try {
                const d = await tpPeticion(TP_API_SESSION, { method: 'POST', body: JSON.stringify({ action: 'open_table', table_id: Number(id) }) });
                tpAviso('Cuenta ' + d.code + ' abierta en ' + d.label, 'success');
                await tpCargar(true);
                tpAbrirModal('tpModalCuenta');
                await tpCargarCuenta(d.session_id);
            } catch (e) {
                tpAviso(tpMensajeDeError(e), 'error');
            } finally { b.disabled = false; }
        }
    });

    // Acciones dentro de la cuenta: quitar una línea, el engranaje, el QR, enviar.
    document.getElementById('tpCuentaPedido').addEventListener('click', function (ev) {
        const q = ev.target.closest('[data-quitar-linea]');
        if (q) tpQuitarLinea(q.getAttribute('data-quitar-linea'));
    });

    document.getElementById('tpCuentaEnviar').addEventListener('click', tpEnviarACocina);
    document.getElementById('tpCuentaQr').addEventListener('click', tpVerQrCuenta);

    // El engranaje es para lo que NO es flujo: pausar, cerrar, cancelar.
    const engranaje = document.getElementById('tpCuentaEngranaje');
    const menuConfig = document.getElementById('tpCuentaConfig');
    engranaje.addEventListener('click', function (ev) {
        ev.stopPropagation();
        const abierto = !menuConfig.classList.contains('hidden');
        menuConfig.classList.toggle('hidden', abierto);
        engranaje.setAttribute('aria-expanded', abierto ? 'false' : 'true');
    });
    document.addEventListener('click', function (ev) {
        if (!menuConfig.classList.contains('hidden') && !menuConfig.contains(ev.target) && ev.target !== engranaje) {
            menuConfig.classList.add('hidden');
            engranaje.setAttribute('aria-expanded', 'false');
        }
    });
    menuConfig.addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-config]');
        if (!b) return;
        menuConfig.classList.add('hidden');
        engranaje.setAttribute('aria-expanded', 'false');
        tpAccionCuenta(b.getAttribute('data-config'));
    });

    // El menú: buscar, filtrar por categoría y agregar lo que el cliente pide.
    document.getElementById('tpMenuBuscar').addEventListener('input', function () {
        tpEstado.busqueda = this.value.trim();
        tpPintarCatalogo();
    });
    document.getElementById('tpMenuCategorias').addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-cat]');
        if (!b) return;
        tpEstado.categoria = b.getAttribute('data-cat');
        tpPintarCategorias();
        tpPintarCatalogo();
    });
    document.getElementById('tpMenuProductos').addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-producto]');
        if (b) tpAbrirAgregar(b.getAttribute('data-producto'));
    });

    // Cantidad y notas del platillo que se va a anotar
    document.getElementById('tpAgregarMenos').addEventListener('click', function () {
        const i = document.getElementById('tpAgregarCantidad');
        i.value = Math.max(1, Number(i.value || 1) - 1);
    });
    document.getElementById('tpAgregarMas').addEventListener('click', function () {
        const i = document.getElementById('tpAgregarCantidad');
        i.value = Number(i.value || 1) + 1;
    });
    document.getElementById('tpAgregarConfirmar').addEventListener('click', async function () {
        const p = tpEstado.productoParaAgregar;
        if (!p) return;
        const cantidad = Math.max(1, Number(document.getElementById('tpAgregarCantidad').value || 1));
        const notas = document.getElementById('tpAgregarNotas').value.trim();
        tpCerrarModal('tpModalAgregar');
        await tpAgregarALaCuenta(p.product_id, cantidad, notas);
    });

    // En móvil se alterna entre el pedido y el menú: una cosa a la vez, a pantalla completa.
    document.getElementById('tpCuentaTabs').addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-lado]');
        if (!b) return;
        const lado = b.getAttribute('data-lado');
        document.getElementById('tpCuentaCuerpoDos').setAttribute('data-lado', lado);
        this.querySelectorAll('.tp-tab').forEach(function (t) {
            t.classList.toggle('activo', t.getAttribute('data-lado') === lado);
        });
    });

    // Junta un punto
    document.getElementById('tpJuntarCuerpo').addEventListener('click', async function (ev) {
        const b = ev.target.closest('[data-juntar]');
        if (!b) return;
        const d = tpEstado.cuentaActual;
        if (!d) return;
        b.disabled = true;
        try {
            const r = await tpPeticion(TP_API_SESSION, { method: 'POST', body: JSON.stringify({ action: 'add_point', session_id: d.session.session_id, table_id: Number(b.getAttribute('data-juntar')) }) });
            tpAviso(r.mensaje || 'Punto juntado', 'success');
            tpCerrarModal('tpModalJuntar');
            await tpCargarCuenta(d.session.session_id);
            await tpCargar(true);
        } catch (e) {
            tpAviso(tpMensajeDeError(e), 'error');
            b.disabled = false;
        }
    });

    // Cancelar con motivo
    document.getElementById('tpCancelarConfirmar').addEventListener('click', async function () {
        const d = tpEstado.cuentaActual;
        const motivo = document.getElementById('tpCancelarMotivo').value.trim();
        if (!d) return;
        if (!motivo) { tpAviso('Escribe por qué se cancela', 'error'); return; }
        try {
            await tpPeticion(TP_API_SESSION, { method: 'POST', body: JSON.stringify({ action: 'cancel', session_id: d.session.session_id, reason: motivo }) });
            tpAviso('Cuenta cancelada', 'success');
            tpCerrarModal('tpModalCancelar');
            await tpCargar();
        } catch (e) { tpAviso(tpMensajeDeError(e), 'error'); }
    });

    // QR: copiar, descargar, imprimir
    document.getElementById('tpQrCopiar').addEventListener('click', function () {
        const campo = document.getElementById('tpQrUrl');
        campo.select();
        if (navigator.clipboard) navigator.clipboard.writeText(campo.value).then(function () { tpAviso('Enlace copiado', 'success'); });
        else { document.execCommand('copy'); tpAviso('Enlace copiado', 'success'); }
    });
    document.getElementById('tpQrDescargar').addEventListener('click', function () {
        const src = tpQrImagen();
        if (!src) { tpAviso('No hay QR que descargar', 'error'); return; }
        const a = document.createElement('a');
        a.href = src; a.download = tpNombreArchivoQr(); a.click();
    });
    document.getElementById('tpQrImprimir').addEventListener('click', function () {
        const src = tpQrImagen();
        const p = (tpEstado.qrActual && tpEstado.qrActual.punto) || {};
        if (!src) { tpAviso('No hay QR que imprimir', 'error'); return; }
        const win = window.open('', '_blank');
        win.document.write('<html><head><title>QR ' + tpEsc(p.label || '') + '</title></head><body style="text-align:center;font-family:sans-serif">' +
            '<h2>' + tpEsc(p.label || '') + '</h2><img src="' + src + '" style="width:320px"><p>' + tpEsc(document.getElementById('tpQrUrl').value) + '</p>' +
            '<script>window.onload=function(){window.print()}<\/script></body></html>');
        win.document.close();
    });

    await tpCargar();

    // Tiempo real: se acabó el sondeo y el botón de refrescar.
    tpConectarTiempoReal();
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) { tpCargar(true); tpReconectarTiempoReal(); }
    });
});

// ============================================================
// Tiempo real (WebSocket, canal de la tienda)
// ============================================================
/**
 * Se suscribe al canal de la tienda: CUALQUIER cambio del salón (se abrió una cuenta, el
 * comensal pidió, se mandó a preparación, se cerró una mesa) llega aquí y la pantalla se
 * pone al día sola. Sin botón de actualizar y sin sondear.
 */
function tpConectarTiempoReal() {
    if (!window.TomodachiRealtime) {
        tpMarcarVivo('sin-tiempo-real');
        return;
    }
    tpEstado.tiempoReal = window.TomodachiRealtime.conectar({
        // "store" a secas: el servidor resuelve la tienda del que está conectado.
        canal: 'store',
        onEvento: function (msg) {
            tpCargar(true);
            // Si hay una cuenta abierta en pantalla, también se refresca: el comensal pudo
            // pedir o alguien pudo cerrarla desde otro dispositivo.
            const d = tpEstado.cuentaActual;
            if (d && tpAlgunModalAbierto()) tpCargarCuenta(d.session.session_id);

            // El tablero de comandas vive en esta misma página y se alimenta de ESTE socket:
            // abrir un segundo WebSocket para lo mismo sería duplicar el aviso y el trabajo
            // del relay. Se reemite como evento del documento y cada vista hace lo suyo.
            document.dispatchEvent(new CustomEvent('tomodachi:realtime', { detail: msg || null }));
        },
        onEstado: tpMarcarVivo,
    });
}

function tpReconectarTiempoReal() {
    if (tpEstado.tiempoReal && typeof tpEstado.tiempoReal.reconectar === 'function') {
        tpEstado.tiempoReal.reconectar();
    }
}

/** La tira "en vivo" dice la verdad: si no hay socket, no se finge que sí. */
function tpMarcarVivo(estado) {
    const etiquetas = {
        'conectado': 'en vivo',
        'reconectando': 'reconectando…',
        'sin-conexion': 'sin conexión',
        'sin-autorizacion': 'sin autorización',
        'sin-tiempo-real': 'sin tiempo real',
        'detenido': 'detenido',
    };
    // Un estado que no conocemos NO es "en vivo": se avisa y se marca como caído. Un
    // indicador que miente es peor que no tener indicador.
    const conocido = Object.prototype.hasOwnProperty.call(etiquetas, estado);
    const texto = conocido ? etiquetas[estado] : 'sin tiempo real';
    const caido = !conocido || estado !== 'conectado';

    ['tpMapaVivo', 'tpCuentaVivo', 'kdVivo'].forEach(function (id) {
        const nodo = document.getElementById(id);
        if (!nodo) return;
        nodo.classList.toggle('desconectado', caido && estado !== 'reconectando');
        nodo.classList.toggle('conectando', estado === 'reconectando');
        const span = nodo.querySelector('span');
        if (span) span.textContent = texto;
    });

    // El tablero de comandas decide con esto si sondea: si el socket está vivo, sondear es
    // trabajo tirado; si no, callarse sería peor.
    document.dispatchEvent(new CustomEvent('tomodachi:realtime-estado', { detail: estado }));
}
