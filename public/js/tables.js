/**
 * Puntos de servicio (Fase 1, T1.4) — el mapa del salón.
 *
 * Qué es un punto de servicio: "dónde se atiende". La etiqueta es libre (Mesa 1, Barra,
 * Habitación 12) porque el producto es para giros distintos, no solo restaurantes.
 *
 * Una CUENTA puede abarcar varios puntos (mesas juntadas): por eso el listado de cuentas
 * devuelve sus puntos y aquí se pueden juntar y separar.
 *
 * TIEMPO REAL: por ahora se refresca cada 5 segundos. El aviso por WebSocket llega en T1.8
 * (el relay todavía no acepta un canal de tienda ni autentica la suscripción). Cuando
 * llegue, se reemplaza el intervalo por la suscripción al canal `store:<id>` y este
 * comentario se va con él.
 */

const TP_API_TABLES = '../api/dining/tables.php';
const TP_API_SESSION = '../api/dining/session.php';
const TP_REFRESCO_MS = 5000;

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
        if (tpEstado.puntoEditando) {
            await tpPeticion(TP_API_TABLES, { method: 'PUT', body: JSON.stringify({ table_id: tpEstado.puntoEditando.table_id, label: label, zone: zone }) });
            tpAviso('Punto actualizado', 'success');
        } else {
            await tpPeticion(TP_API_TABLES, { method: 'POST', body: JSON.stringify({ label: label, zone: zone }) });
            tpAviso('Punto creado', 'success');
        }
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
    const cont = document.getElementById('tpCuentaCuerpo');
    cont.innerHTML = '<div class="tp-vacio"><i class="fas fa-spinner fa-spin"></i><p>Cargando la cuenta…</p></div>';
    try {
        const d = await tpPeticion(TP_API_SESSION + '?cuenta=' + sessionId);
        tpEstado.cuentaActual = d;
        tpPintarCuenta();
    } catch (e) {
        cont.innerHTML = '<div class="tp-vacio"><i class="fas fa-triangle-exclamation"></i><p>' + tpEsc(tpMensajeDeError(e)) + '</p></div>';
    }
}

function tpPintarCuenta() {
    if (!tpAlgunModalAbierto()) return;
    const d = tpEstado.cuentaActual;
    if (!d) return;
    const s = d.session;

    document.getElementById('tpCuentaTitulo').textContent = 'Cuenta de ' + (d.puntos || []).map(function (p) { return p.label; }).join(' + ');

    const personas = {};
    (s.participants || []).forEach(function (p) { personas[p.participant_id] = p.display_name || 'Comensal'; });

    let items = '';
    if (!(s.items || []).length) {
        items = '<div class="tp-aviso">Todavía no hay nada pedido en esta cuenta.</div>';
    } else {
        items = '<div class="tp-tabla-items">' + s.items.map(function (it) {
            const quien = it.participant_name || personas[it.participant_id] || (it.added_by === 'staff' ? 'Personal' : 'Sin asignar');
            return '<div class="tp-item">' +
                '<div><div class="tp-item-nombre">' + tpCantidad(it.quantity) + ' × ' + tpEsc(it.product_name) + '</div>' +
                '<div class="tp-item-meta">' + tpEsc(quien) + (it.notes ? ' · ' + tpEsc(it.notes) : '') + '</div></div>' +
                '<div><div class="tp-item-importe">' + tpDinero(it.line_total) + '</div>' +
                '<div class="tp-item-estado ' + tpEsc(it.status) + '">' + tpEsc(tpEtiquetaEstado(it.status)) + '</div></div>' +
                '</div>';
        }).join('') + '</div>';
    }

    const puntos = (d.puntos || []).map(function (p) {
        return '<span class="tp-punto-ficha' + (p.es_principal ? ' principal' : '') + '">' +
            '<i class="fas ' + (p.es_principal ? 'fa-location-dot' : 'fa-link') + '"></i> ' + tpEsc(p.label) +
            (p.es_principal ? ' (principal)' : '') +
            (p.es_principal ? '' : ' <button type="button" class="tp-punto-quitar" data-separar="' + p.table_id + '" title="Separar de la cuenta"><i class="fas fa-xmark"></i></button>') +
            '</span>';
    }).join('');

    const cuerpo = document.getElementById('tpCuentaCuerpo');
    cuerpo.innerHTML =
        '<div class="tp-cuenta-codigo"><div class="tp-codigo">' + tpEsc(s.code) + '</div></div>' +
        '<div class="tp-datos" style="justify-content:center">' +
            '<span><i class="fas fa-clock"></i> abierta hace ' + Number(d.minutos_abierta || 0) + ' min</span>' +
            '<span><i class="fas fa-user-group"></i> ' + (s.participants || []).length + ' persona(s)</span>' +
            '<span><i class="fas fa-toggle-' + (Number(s.ordering_enabled) === 1 ? 'on' : 'off') + '"></i> ' + (Number(s.ordering_enabled) === 1 ? 'pueden pedir' : 'pedidos en pausa') + '</span>' +
        '</div>' +
        '<div><div class="tp-persona">Puntos de servicio</div><div class="tp-puntos">' + puntos + '</div></div>' +
        (personas && Object.keys(personas).length ? '<div><div class="tp-persona">Quiénes están</div><div class="tp-datos">' +
            (s.participants || []).map(function (p) { return '<span><i class="fas fa-user"></i> ' + tpEsc(p.display_name || 'Comensal') + '</span>'; }).join('') + '</div></div>' : '') +
        '<div><div class="tp-persona">Lo pedido</div>' + items + '</div>' +
        '<div class="tp-totales">' +
            '<div class="tp-total-linea"><span>Subtotal</span><span>' + tpDinero(s.totals.subtotal) + '</span></div>' +
            '<div class="tp-total-linea grande"><span>Total</span><span>' + tpDinero(s.totals.total) + '</span></div>' +
        '</div>' +
        (d.notas ? '<div class="tp-aviso"><i class="fas fa-note-sticky"></i> ' + tpEsc(d.notas) + '</div>' : '');

    const pausado = Number(s.ordering_enabled) !== 1;
    document.getElementById('tpCuentaPie').innerHTML =
        '<button type="button" class="tp-btn" data-cuenta-accion="refrescar"><i class="fas fa-rotate"></i> Refrescar</button>' +
        '<button type="button" class="tp-btn" data-cuenta-accion="' + (pausado ? 'resume' : 'pause') + '"><i class="fas fa-' + (pausado ? 'play' : 'pause') + '"></i> ' + (pausado ? 'Reanudar pedidos' : 'Pausar pedidos') + '</button>' +
        '<button type="button" class="tp-btn peligro" data-cuenta-accion="cancelar"><i class="fas fa-ban"></i> Cancelar</button>' +
        '<button type="button" class="tp-btn primario" data-cuenta-accion="close"><i class="fas fa-flag-checkered"></i> Cerrar cuenta</button>';
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
        if (accion === 'refrescar') { await tpCargarCuenta(sessionId); return; }
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
    document.getElementById('tpBtnActualizar').addEventListener('click', function () { tpCargar(); });
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

    // Acciones del detalle de la cuenta
    document.getElementById('tpCuentaCuerpo').addEventListener('click', function (ev) {
        const s = ev.target.closest('[data-separar]');
        if (!s) return;
        const d = tpEstado.cuentaActual;
        if (!d) return;
        const id = s.getAttribute('data-separar');
        const punto = (d.puntos || []).find(function (p) { return Number(p.table_id) === Number(id); });
        if (!confirm('¿Separar ' + ((punto && punto.label) || 'el punto') + ' de la cuenta ' + d.session.code + '?')) return;
        tpSepararPunto(d.session.session_id, Number(id));
    });
    document.getElementById('tpCuentaPie').addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-cuenta-accion]');
        if (b) tpAccionCuenta(b.getAttribute('data-cuenta-accion'));
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

    // Refresco periódico (temporal: T1.8 lo cambia por el aviso del WebSocket).
    setInterval(function () {
        if (document.hidden || tpAlgunModalAbierto()) return;
        tpCargar(true);
    }, TP_REFRESCO_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tpCargar(true); });
});
