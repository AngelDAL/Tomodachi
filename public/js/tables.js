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
    notasAbiertas: null,       // línea del pedido cuya caja de notas está abierta
    // El pedido se pinta por TARJETAS (un platillo agrupado), no por línea suelta. Aquí
    // queda la última estructura pintada para el repintado quirúrgico: al tocar una pieza
    // se actualiza SOLO su tarjeta, nunca la lista completa.
    pedidoGrupos: null,
    pedidoCtx: null,
    repintados: 0,             // auditoría: cuántas veces se repintó la lista completa
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
// Confirmaciones propias (nunca el diálogo del navegador)
// ============================================================
/**
 * Pide confirmación con un modal DEL SISTEMA.
 *
 * Regla del proyecto: nada de `alert()`, `confirm()` ni `prompt()`. El diálogo nativo rompe
 * la identidad visual, ignora el tema y en una tableta aparece fuera de contexto. Además,
 * una confirmación destructiva merece explicar QUÉ va a pasar, y el diálogo nativo no deja.
 *
 *   tpConfirmar({titulo, texto, boton, peligro, alConfirmar: function () { ... }})
 */
const tpConfirmacion = { accion: null };

function tpConfirmar(opciones) {
    const o = opciones || {};
    tpConfirmacion.accion = typeof o.alConfirmar === 'function' ? o.alConfirmar : null;

    document.getElementById('tpConfirmaTitulo').textContent = o.titulo || 'Confirmar';
    document.getElementById('tpConfirmaTexto').innerHTML = o.texto || '';
    const boton = document.getElementById('tpConfirmaBoton');
    boton.innerHTML = (o.peligro ? '<i class="fas fa-triangle-exclamation"></i> ' : '<i class="fas fa-check"></i> ')
        + (o.boton || 'Confirmar');
    boton.className = 'tp-btn ' + (o.peligro ? 'peligro' : 'primario');
    tpAbrirModal('tpModalConfirma');
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

/** El contador de repintados completos: para no dejar crecer el número sin freno. */
function tpContarRepintado() {
    if ((tpEstado.repintados = tpEstado.repintados + 1) > 1000000) {
        tpEstado.repintados = 0;
    }
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
        rotar.addEventListener('click', function () {
            // El QR impreso deja de servir: eso se explica ANTES, con un modal del sistema.
            tpConfirmar({
                titulo: 'Rotar el QR de ' + p.label,
                texto: 'El QR que ya está impreso y pegado en ' + tpEsc(p.label) + ' dejará de funcionar. ' +
                       'Hazlo solo si el impreso se filtró o alguien de fuera lo copió.',
                boton: 'Rotar el QR',
                peligro: true,
                alConfirmar: async function () {
                    try {
                        const d = await tpPeticion(TP_API_TABLES, { method: 'PUT', body: JSON.stringify({ table_id: p.table_id, rotate_token: true }) });
                        tpAviso('QR rotado: imprime el nuevo.', 'success');
                        tpEstado.qrActual = d;
                        tpMostrarQr(p);
                        await tpCargar(true);
                    } catch (e) { tpAviso(tpMensajeDeError(e), 'error'); }
                }
            });
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
    tpConfirmar({
        titulo: 'Desactivar ' + p.label,
        texto: 'Dejará de salir en el mapa, su QR impreso ya no abrirá la carta de esta mesa y no se ' +
               'podrán abrir cuentas nuevas ahí. Lo que ya está en la cuenta no se toca.',
        boton: 'Desactivar',
        peligro: true,
        alConfirmar: async function () {
            try {
                const d = await tpPeticion(TP_API_TABLES + '?table_id=' + id, { method: 'DELETE' });
                tpAviso(d && d.borrado ? 'Punto eliminado' : 'Punto desactivado', 'success');
                await tpCargar(true);
            } catch (e) { tpAviso(tpMensajeDeError(e), 'error'); }
        }
    });
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

async function tpCargarCuenta(sessionId, opciones) {
    const o = opciones || {};
    const cont = document.getElementById('tpCuentaPedido');
    const pegar = o.pegarContenido || null;
    const scroll = o.scrollActual;
    // Pidiendo un cambio que ya se hizo en pantalla: no se borra lo que el mesero está
    // viendo (eso es justo el parpadeo que el repintado quirúrgico viene a quitar).
    if (!pegar && cont) cont.innerHTML = '<div class="tp-vacio-mini"><i class="fas fa-spinner fa-spin"></i> Cargando la cuenta…</div>';
    try {
        const d = pegar ? (o.respuesta || await tpPeticion(TP_API_SESSION + '?cuenta=' + sessionId))
                        : await tpPeticion(TP_API_SESSION + '?cuenta=' + sessionId);
        tpEstado.cuentaActual = d;
        // El catálogo se carga una vez por sesión de pantalla; luego se filtra en memoria.
        if (!tpEstado.catalogo.length) await tpCargarCatalogo();
        // Con `pegar` se toma la respuesta del servidor como estado vigente y se rearman
        // SOLO las tarjetas que cambiaron: ni parpadeo ni lista completa. `tpPintarCuenta`
        // (que sí pinta todo) queda para la carga inicial y para los cambios de fondo.
        if (pegar && pegar()) {
            // La nota que se estaba escribiendo pudo quedar cerrada al rearmar: el dato
            // de cuál pieza se separó viaja para volver a abrir SU caja.
            if (o.abrirNota) tpAbrirCajaNota(String(o.abrirNota));
            if (typeof scroll === 'number' && cont) cont.scrollTop = scroll;
            return;
        }
        tpPintarCuenta();
        if (o.abrirNota) tpAbrirCajaNota(String(o.abrirNota));
        tpContarRepintado();
    } catch (e) {
        if (cont) cont.innerHTML = '<div class="tp-vacio-mini">' + tpEsc(tpMensajeDeError(e)) + '</div>';
    }
}

/** Vuelve a abrir la caja de notas de una pieza (tras rearmar su tarjeta). */
function tpAbrirCajaNota(itemId) {
    tpEstado.notasAbiertas = String(itemId);
    const linea = tpTarjetaDe(itemId);
    if (linea) {
        const rep = tpTarjetaDeUnidad(linea.getAttribute('data-linea'));
        if (rep) linea.outerHTML = rep;
    } else {
        tpPintarPedido(tpEstado.cuentaActual || { session: {} });
    }
    const campo = document.getElementById('tpNotasLinea' + itemId);
    if (campo) setTimeout(function () { campo.focus(); }, 40);
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

/**
 * Agrega UNA pieza del platillo tocado: un clic, un platillo; otro clic, otro.
 *
 * Antes esto abría una hoja de "cantidad y notas" ENCIMA de la cuenta que ya estaba abierta
 * (dos modales encimados, y el de arriba tapando justo lo que se estaba anotando). Ahora la
 * cantidad se sube tocando el platillo otra vez —el servidor fusiona en la misma línea— y
 * las notas se escriben POR LÍNEA dentro del panel del pedido.
 */
async function tpAgregarDirecto(productId) {
    const d = tpEstado.cuentaActual;
    if (!d) return;
    await tpAgregarALaCuenta(productId, 1, '');
}

/**
 * Cambia la cantidad de un GRUPO DE NOTA (mismo platillo + mismas notas) y repinta solo
 * su tarjeta.
 *
 * Bajar a 0 en un grupo de 1 pieza quita esa pieza; en un grupo de 2 deja 1. Ese −1 es el
 * camino para separar una pieza y anotarla aparte (el grupo baja y la pieza suelta se
 * anota con `set_notes`).
 */
async function tpCambiarCantidadLinea(itemId, cantidad) {
    const d = tpEstado.cuentaActual;
    if (!d) return;
    const scroll = tpScrollPedido();
    try {
        const r = await tpPeticion(TP_API_ORDER, {
            method: 'POST',
            body: JSON.stringify({
                session_id: d.session.session_id,
                action: 'set_quantity',
                order_item_id: Number(itemId),
                quantity: Math.max(0, Number(cantidad) || 0)
            })
        });
        // El camino rápido: se rearma solo la tarjeta afectada con la respuesta, sin volver
        // a pedir ni a pintar la cuenta entera.
        await tpCargarCuenta(d.session.session_id, { pegarContenido: function () { return tpPegarRespuesta(r, null, scroll); } });
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    }
}

/** La tarjeta (`.tp-linea`) que contiene esa línea, si está en pantalla. */
function tpTarjetaDe(itemId) {
    const nodo = document.getElementById('tpNotasLinea' + itemId);
    if (nodo) return nodo.closest('.tp-linea');
    const boton = document.querySelector('[data-linea-notas="' + itemId + '"]');
    return boton ? boton.closest('.tp-linea') : null;
}

function tpScrollPedido() {
    const cont = document.getElementById('tpCuentaPedido');
    return cont ? cont.scrollTop : 0;
}

/**
 * Toma la respuesta del servidor (la cuenta completa) como estado vigente y refresca SOLO
 * las tarjetas que cambiaron y los totales. Devuelve true cuando NO hubo que repintar la
 * lista completa: es el caso normal de "el mesero tocó algo".
 */
function tpPegarRespuesta(respuesta, foto, scroll) {
    const cont = document.getElementById('tpCuentaPedido');
    if (!cont) return true;

    const d = (respuesta && respuesta.session && respuesta.session.items !== undefined)
        ? respuesta
        : null;
    if (!d) {
        // No vino la cuenta completa: repintado total (queda contado en el contador).
        return false;
    }

    try {
        tpEstado.cuentaActual = d;
        tpEstado.pedidoCtx = tpContextoPedido(d);
        tpActualizarTarjetas(d);
        tpPintarPiePedido(d.session);
        if (typeof scroll === 'number') cont.scrollTop = scroll;
        return true;
    } catch (e) {
        // Cualquier sorpresa al parchear la tarjeta: se cae al pintado completo, que nunca
        // miente, en vez de dejar la pantalla a medias.
        return false;
    }
}

/**
 * Repinta las tarjetas que cambiaron, en su lugar, y quita las que ya no existen.
 * Nunca repinta la lista completa: es el camino de cada toque.
 */
function tpActualizarTarjetas(d) {
    const est = tpEstado.pedidoGrupos;
    if (!est) return;

    const lineas = [];
    (d.session.items || []).forEach(function (it) { lineas.push(it); });
    const grupos = {};
    lineas.forEach(function (it) {
        const clave = it.participant_id ? 'p' + it.participant_id : (it.added_by === 'staff' ? 'personal' : 'sin');
        if (!grupos[clave]) grupos[clave] = [];
        grupos[clave].push(it);
    });

    // Unidades nuevas por persona, para saber cuáles cambiar y cuáles quedaron huérfanas.
    const nuevas = {};
    Object.keys(grupos).forEach(function (clave) {
        nuevas[clave] = tpUnidadesDeGrupo(grupos[clave]);
    });

    const presentes = {};
    Object.keys(nuevas).forEach(function (clave) {
        nuevas[clave].forEach(function (u) { presentes[u.id] = { clave: clave, unidad: u }; });
    });

    // 1. Se quitan las tarjetas que ya no existen (la línea se quitó, fusionó o se fue).
    document.querySelectorAll('#tpCuentaPedido [data-linea]').forEach(function (nodo) {
        if (!presentes[nodo.getAttribute('data-linea')]) nodo.remove();
    });

    // 2. Se actualizan las que cambiaron (o se insertan las nuevas en su bloque).
    Object.keys(grupos).forEach(function (clave) {
        const bloqueAntes = document.querySelector('[data-grupo-persona="' + clave + '"]');
        const unidades = nuevas[clave];
        const html = unidades.map(function (u) { return tpLineaPedido(u, tpEstado.pedidoCtx); }).join('');
        if (bloqueAntes) {
            const cuerpo = bloqueAntes.querySelector('[data-grupo-cuerpo]');
            if (cuerpo) cuerpo.innerHTML = html; else bloqueAntes.insertAdjacentHTML('beforeend', html);
        } else {
            // Apareció una persona que no estaba: se rearma el pedido completo (es el único
            // caso en que la lista entera cambia) y se repone el scroll.
            const pos = tpScrollPedido();
            tpPintarPedido(d);
            tpScrollPedidoA(pos);
            return;
        }
        // El total de la persona, en su cabecera.
        const total = (grupos[clave] || []).reduce(function (a, it) {
            return a + (it.status !== 'cancelled' ? Number(it.line_total || 0) : 0);
        }, 0);
        const cab = bloqueAntes ? bloqueAntes.querySelector('[data-grupo-total]') : null;
        if (cab) cab.textContent = tpDinero(total);

        // Estructura en memoria al día.
        const b = est.bloques.filter(function (x) { return x.clave === clave; })[0];
        if (b) { b.unidades = unidades; b.total = total; }
        else est.bloques.push({ clave: clave, titulo: '', total: total, unidades: unidades });
        est.porPersona[clave] = unidades;
    });
}

/** Repone el scroll del panel del pedido tras un repintado total. */
function tpScrollPedidoA(pos) {
    const cont = document.getElementById('tpCuentaPedido');
    if (cont && typeof pos === 'number') cont.scrollTop = pos;
}

/**
 * Separa UNA pieza de un grupo de nota y le pide su anotación.
 *
 * Es el camino táctil de "anotar una sola pieza": el grupo baja en uno (las demás piezas
 * conservan su nota) y la pieza suelta aparece como su propio grupo, con la caja de nota
 * abierta. Todo con `set_quantity` + `set_notes`; no hace falta endpoint nuevo.
 */
async function tpAnotarUnaPieza(itemId) {
    const d = tpEstado.cuentaActual;
    if (!d) return;
    const card = tpTarjetaDe(itemId);
    const cantidadDe = function () {
        const nodo = tpTarjetaDe(itemId);
        const menos = nodo ? nodo.querySelector('[data-nota-menos="' + itemId + '"]') : null;
        return menos ? Number(menos.getAttribute('data-nota-cantidad')) || 1 : 0;
    };
    let cantidad = cantidadDe();
    if (cantidad <= 1) {
        // Ya es una sola pieza: solo se abre su nota.
        tpAlternarNotasLinea(itemId);
        return;
    }
    if (cantidad >= 50) {
        // Tope de la API (MAX_LINE_QUANTITY): partir deja la pieza suelta, pero el resto
        // ya no se puede volver a agregar. Mejor avisar que fallar en silencio.
        tpAviso('Ya son 50 piezas de este platillo: anótalas por un lado', 'error');
        return;
    }
    // La pieza suelta la crea el servidor (acción `split_piece`) a partir de la línea de
    // la que se separó; aquí solo se identifica por el id que devuelve.
    const sessionId = d.session.session_id;
    const scroll = tpScrollPedido();
    try {
        // Baja el grupo en uno dejando las demás piezas con su nota (la línea ORIGINAL se
        // queda con cantidad-1 y su misma nota) y pide la pieza suelta.
        //
        // El `null` del navegador NO es un error de datos: significa "sin nota" y el
        // servidor lo acepta porque viene del personal autenticado. Además hay una trampa
        // real que no se puede resolver con `addItems`: esa acción FUSIONA la pieza nueva
        // con cualquier línea pendiente del mismo platillo y las mismas notas, así que la
        // pieza a anotar se perdería dentro del grupo. Por eso el troceo vive en el API.
        await tpPeticion(TP_API_ORDER, {
            method: 'POST',
            body: JSON.stringify({ session_id: sessionId, action: 'set_quantity', order_item_id: Number(itemId), quantity: cantidad - 1 })
        });
        const rUsuario = await tpPeticion(TP_API_ORDER, {
            method: 'POST',
            body: JSON.stringify({ session_id: sessionId, action: 'split_piece', order_item_id: Number(itemId) })
        });
        const nueva = (rUsuario && rUsuario.nueva_linea) ? rUsuario.nueva_linea : null;
        await tpCargarCuenta(sessionId, {
            pegarContenido: function () { return tpPegarRespuesta(rUsuario, null, scroll); },
            respuesta: rUsuario,
            abrirNota: nueva
        });
        const campo = document.getElementById('tpNotasLinea' + (nueva || itemId));
        if (campo) setTimeout(function () { campo.focus(); }, 60);
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    }
}

/** Abre o cierra la caja de notas de una línea, DENTRO del panel del pedido. */
function tpAlternarNotasLinea(itemId) {
    const abierta = tpEstado.notasAbiertas === String(itemId) ? null : String(itemId);
    tpEstado.notasAbiertas = abierta;
    const linea = tpTarjetaDe(itemId);
    const scroll = tpScrollPedido();
    if (linea) {
        const rep = tpTarjetaDeUnidad(linea.getAttribute('data-linea'));
        if (rep) linea.outerHTML = rep;
        tpScrollPedidoA(scroll);
    } else {
        tpPintarPedido(tpEstado.cuentaActual || { session: {} });
    }
    if (abierta) {
        const campo = document.getElementById('tpNotasLinea' + itemId);
        if (campo) setTimeout(function () { campo.focus(); }, 60);
    }
}

/** Guarda las notas de esas piezas (vacío = borrar la nota). Repinta solo la tarjeta. */
async function tpGuardarNotasLinea(itemId) {
    const d = tpEstado.cuentaActual;
    const campo = document.getElementById('tpNotasLinea' + itemId);
    if (!d || !campo) return;
    const texto = (campo.value || '').trim().slice(0, 200);
    const scroll = tpScrollPedido();
    try {
        const r = await tpPeticion(TP_API_ORDER, {
            method: 'POST',
            body: JSON.stringify({
                session_id: d.session.session_id,
                action: 'set_notes',
                order_item_id: Number(itemId),
                notes: texto
            })
        });
        tpEstado.notasAbiertas = null;
        await tpCargarCuenta(d.session.session_id, {
            pegarContenido: function () { return tpPegarRespuesta(r, null, scroll); }
        });
        tpAviso(texto ? 'Nota guardada' : 'Nota borrada', 'success');
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    }
}

/** Lo que anota el mesero entra a la MISMA cuenta que ve el cliente. */
async function tpAgregarALaCuenta(productId, cantidad, notas) {
    const d = tpEstado.cuentaActual;
    if (!d) return;
    // El id de la cuenta se fija ANTES de la petición: mientras el mesero toca, `tpCargar`
    // actualiza la lista del mapa en segundo plano y no puede llevarse la cuenta abierta.
    const sessionId = d.session.session_id;
    const item = { product_id: Number(productId), quantity: Number(cantidad) };
    if (notas) item.notes = notas;
    const scroll = tpScrollPedido();
    try {
        const r = await tpPeticion(TP_API_ORDER, { method: 'POST', body: JSON.stringify({ session_id: sessionId, items: [item] }) });
        // Ya no se pide la cuenta otra vez: la respuesta del alta es la cuenta completa.
        await tpCargarCuenta(sessionId, {
            pegarContenido: function () { return tpPegarRespuesta(r, null, scroll); }
        });
        tpAviso('Agregado a la cuenta ' + d.session.code, 'success');
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    }
}

async function tpQuitarLinea(itemId) {
    const d = tpEstado.cuentaActual;
    if (!d) return;
    const scroll = tpScrollPedido();
    try {
        const r = await tpPeticion(TP_API_ORDER, { method: 'POST', body: JSON.stringify({ session_id: d.session.session_id, action: 'remove', order_item_id: Number(itemId) }) });
        await tpCargarCuenta(d.session.session_id, {
            pegarContenido: function () { return tpPegarRespuesta(r, null, scroll); }
        });
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

    // El módulo de cobro (js/cobro.js) necesita saber QUÉ cuenta está abierta y cuánto
    // lleva. Se publica aquí, en un solo lugar, en vez de que el cobro lo adivine leyendo
    // la pantalla o pidiendo la cuenta otra vez.
    const totalNum = Number(s.totals.total) || 0;
    window.tpCuentaActual = {
        session_id: Number(s.session_id),
        code: s.code || '',
        total: totalNum,
        puntos: puntos.map(function (p) { return p.label; }).join(' + '),
        personas: (s.participants || []).length,
        sin_enviar: (s.items || []).filter(function (it) { return it.status === 'pending'; }).length,
    };
    const btnCobrar = document.getElementById('tpCuentaCobrar');
    if (btnCobrar) {
        btnCobrar.innerHTML = '<i class="fas fa-cash-register"></i> Cobrar ' + total;
        // Una cuenta sin consumo no se cobra: se cancela con motivo.
        btnCobrar.disabled = totalNum <= 0;
        btnCobrar.title = totalNum <= 0
            ? 'La cuenta no tiene consumo: cancélela con un motivo'
            : 'Cobrar esta cuenta';
    }

    tpPintarPedido(d);
}

function tpPintarPedido(d) {
    const s = d.session;
    const cont = document.getElementById('tpCuentaPedido');
    if (!cont) return;

    // El pedido se agrupa por persona; lo que anotó el personal va aparte, con su nombre.
    const grupos = {};
    const ctx = tpEstado.pedidoCtx = tpContextoPedido(d);
    (s.items || []).forEach(function (it) {
        const clave = it.participant_id ? 'p' + it.participant_id : (it.added_by === 'staff' ? 'personal' : 'sin');
        if (!grupos[clave]) {
            grupos[clave] = {
                titulo: it.participant_id
                    ? (tpEstado.pedidoCtx.personas[Number(it.participant_id)] || it.participant_name || 'Comensal')
                    : (it.added_by === 'staff' ? 'Anotado por el personal' : 'Sin asignar'),
                lineas: [],
                total: 0,
            };
        }
        grupos[clave].lineas.push(it);
        if (it.status !== 'cancelled') grupos[clave].total += Number(it.line_total || 0);
    });

    const claves = Object.keys(grupos);
    const bloques = [];
    const porClave = {};
    claves.forEach(function (k) {
        const g = grupos[k];
        // Dentro de cada persona, las líneas del MISMO platillo viven en una sola tarjeta.
        const unidades = tpUnidadesDeGrupo(g.lineas);
        const bloque = { clave: k, titulo: g.titulo, total: g.total, unidades: unidades };
        bloques.push(bloque);
        porClave[k] = unidades;
    });

    tpEstado.pedidoGrupos = { bloques: bloques, porPersona: porClave };

    if (!claves.length) {
        cont.innerHTML = '<div class="tp-aviso">Todavía no hay nada pedido en esta cuenta. Anota del menú de la izquierda.</div>';
    } else {
        cont.innerHTML = bloques.map(function (b) {
            return '<div class="tp-grupo-persona" data-grupo-persona="' + tpEsc(b.clave) + '">' +
                '<div class="tp-grupo-titulo"><span><i class="fas fa-user"></i> ' + tpEsc(b.titulo) + '</span>' +
                '<span data-grupo-total>' + tpDinero(b.total) + '</span></div>' +
                '<div data-grupo-cuerpo>' +
                b.unidades.map(function (u) { return tpLineaPedido(u, tpEstado.pedidoCtx); }).join('') +
                '</div></div>';
        }).join('');
    }

    tpPintarPiePedido(s);
}

/** El contador de "sin enviar" y el botón de mandar a preparación. */
function tpPintarPiePedido(s) {
    const pendientes = (s.items || []).filter(function (it) { return it.status === 'pending'; });
    const importe = pendientes.reduce(function (a, it) { return a + Number(it.line_total || 0); }, 0);
    document.getElementById('tpCuentaPendientes').innerHTML = pendientes.length
        ? '<i class="fas fa-clock"></i> ' + pendientes.length + ' sin enviar · ' + tpDinero(importe)
        : '<i class="fas fa-circle-check"></i> Todo enviado a preparación';
    document.getElementById('tpCuentaEnviar').disabled = pendientes.length === 0;
}

/**
 * El contexto de pintado: nombres de las personas y la cuenta donde se está anotando.
 * Las llaves de notas separan la caja abierta por persona, para que dos "Anotar" de dos
 * personas (o del mismo platillo repetido) no se pisen.
 */
function tpContextoPedido(d) {
    const personas = {};
    (d.session.participants || []).forEach(function (p) { personas[Number(p.participant_id)] = p.display_name || 'Comensal'; });
    return { personas: personas, sessionId: d.session.session_id };
}

/** Una unidad de nota: las piezas del mismo platillo con EXACTAMENTE la misma nota. */
function tpNotaClave(it) {
    return it.notes === null || it.notes === undefined || it.notes === '' ? '' : String(it.notes);
}

/**
 * Agrupa las líneas de una persona en TARJETAS por producto (no por línea).
 *
 * El modelo de datos guarda una línea por (platillo + persona + notas), así que tres
 * piezas con la misma nota ya son una línea de cantidad 3, y una con nota distinta es
 * otra línea. Sin embargo, ajustar cantidades con los botones `+`/`-` puede dejar dos
 * líneas del mismo platillo y la misma nota; aquí se juntan para la vista: una tarjeta
 * por platillo, con la cantidad total y sus grupos de nota adentro.
 */
function tpUnidadesDeGrupo(lineas) {
    const porProducto = {};
    const orden = [];
    lineas.forEach(function (it) {
        // La clave lleva el ESTADO además del platillo: agrupar una pieza que ya se sirvió
        // con otra que sigue en cocina bajo una sola etiqueta engaña al mesero ("2× en
        // cocina" cuando una ya está en la mesa). Se agrupa lo que está en el mismo paso.
        const pid = it.product_id === null || it.product_id === undefined
            ? 'n' + it.order_item_id
            : 'p' + it.product_id + '-' + (it.status || 'pending');
        if (!porProducto[pid]) {
            porProducto[pid] = { id: pid, product_id: it.product_id, nombre: it.product_name, lineas: [] };
            orden.push(pid);
        }
        porProducto[pid].lineas.push(it);
    });

    return orden.map(function (pid) {
        const u = porProducto[pid];
        const canceladas = [];
        const vivas = [];
        u.lineas.forEach(function (it) { (it.status === 'cancelled' ? canceladas : vivas).push(it); });

        const porNota = {};
        const notasOrden = [];
        vivas.forEach(function (it) {
            const k = tpNotaClave(it);
            if (!porNota[k]) { porNota[k] = { notas: k, items: [], cantidad: 0, total: 0, enviadas: 0 }; notasOrden.push(k); }
            const n = porNota[k];
            n.items.push(it);
            n.cantidad += Number(it.quantity) || 0;
            n.total += Number(it.line_total) || 0;
            if (it.status !== 'pending') n.enviadas++;
        });

        let cantidad = 0, total = 0, pendientes = 0, enviadas = 0;
        const estados = {};
        vivas.forEach(function (it) {
            cantidad += Number(it.quantity) || 0;
            total += Number(it.line_total) || 0;
            if (it.status === 'pending') pendientes++; else enviadas++;
            estados[it.status] = true;
        });

        // Solo se puede ajustar en la pantalla lo que todavía no se mandó a preparación.
        const estadoVista = pendientes === 0 ? 'enviado'
            : (Object.keys(estados).length === 1 ? 'pendiente' : 'mixto');

        return {
            id: u.id,
            product_id: u.product_id,
            nombre: u.nombre,
            lineas: u.lineas,
            notas: notasOrden.map(function (k) { return porNota[k]; }),
            canceladas: canceladas,
            cantidad: cantidad,
            total: total,
            pendientes: pendientes,
            enviadas: enviadas,
            estadoVista: estadoVista,
            // El estado real del grupo cuando todas sus piezas van en el mismo paso:
            // sirve para etiquetar "listo" o "servido" en vez del genérico "en cocina".
            estadoUnico: (Object.keys(estados).length === 1 ? Object.keys(estados)[0] : null),
        };
    });
}

/** Pinta (o repinta) UNA tarjeta en su lugar. Es el camino normal al tocar algo. */
function tpPintarTarjeta(linea) {
    if (!linea) return;
    const id = linea.getAttribute('data-linea');
    const reemplazo = tpTarjetaDeUnidad(id);
    if (reemplazo) linea.outerHTML = reemplazo;
}

function tpTarjetaDeUnidad(id) {
    const est = tpEstado.pedidoGrupos;
    if (!est) return '';
    for (let i = 0; i < est.bloques.length; i++) {
        const u = est.bloques[i].unidades.filter(function (x) { return x.id === id; })[0];
        if (u) return tpLineaPedido(u, tpEstado.pedidoCtx || {});
    }
    return '';
}

function tpLineaPedido(u, ctx) {
    ctx = ctx || {};
    const cant = Number(u.cantidad) || 0;
    const variasNotas = u.notas.length > 1;
    const unicaNota = u.notas.length === 1 ? u.notas[0] : null;
    const puedePartir = u.pendientes > 0 && u.notas.some(function (n) { return n.cantidad > 1; });

    let lineasNota = '';
    u.notas.forEach(function (n) {
        const items = n.items;
        const pendientes = items.filter(function (it) { return it.status === 'pending'; });
        const todasPendientes = pendientes.length === items.length;
        const itemId = String(items[0].order_item_id);
        // La caja de notas se identifica por LÍNEA (no por grupo): partir una pieza abre la
        // de esa pieza exacta y la de al lado no se contamina.
        const abiertaEsta = tpEstado.notasAbiertas === String(itemId);
        const etiqueta = (n.notas === '' ? 'Sin nota' : tpEsc(n.notas));

        const notaCambiar = pendientes.length
            ? '<button type="button" class="tp-linea-btn' + (abiertaEsta ? ' activo' : '') + '" data-linea-notas="' + itemId + '" title="Anotar estas piezas"><i class="fas fa-pen"></i> ' + (n.notas ? 'Cambiar nota' : 'Anotar') + '</button>'
            : '<span class="tp-linea-btn bloqueado" title="Estas piezas ya se enviaron: para cambiarlas pídelo al personal"><i class="fas fa-lock"></i> ' + (n.notas ? '' : 'Sin nota') + '</span>';

        // Lo pendiente se ajusta POR GRUPO DE NOTA: subir, bajar o anotar esas piezas.
        const accionesNota = todasPendientes
            ? '<div class="tp-linea-acciones">' +
                  '<button type="button" class="tp-linea-btn" data-nota-menos="' + itemId + '" data-nota-cantidad="' + n.cantidad + '" aria-label="Una menos de estas piezas"><i class="fas fa-minus"></i></button>' +
                  '<button type="button" class="tp-linea-btn" data-nota-mas="' + itemId + '" data-nota-cantidad="' + n.cantidad + '" aria-label="Una más de estas piezas"><i class="fas fa-plus"></i></button>' +
                  notaCambiar +
              '</div>'
            : '<div class="tp-linea-acciones">' + notaCambiar + '</div>';

        const caja = abiertaEsta
            ? '<div class="tp-linea-notas-caja">' +
                  '<input type="text" id="tpNotasLinea' + itemId + '" class="tp-notas-input" maxlength="200"' +
                      ' placeholder="Sin cebolla, sin salsa, término medio…" value="' + tpEsc(n.notas) + '" data-nota-origen="' + itemId + '">' +
                  '<button type="button" class="tp-btn primario" data-linea-guardar-notas="' + itemId + '">Guardar</button>' +
              '</div>'
            : '';

        // Con UNA sola nota, el renglón se ve como siempre: "3× Hamburguesa · sin cebolla".
        // Con notas distintas, cada grupo se lista adentro con su "2×".
        if (variasNotas) {
            lineasNota += '<div class="tp-nota-grupo">' +
                '<div class="tp-nota-head"><span class="tp-nota-cant">' + tpCantidad(n.cantidad) + '×</span>' +
                '<span class="tp-nota-texto"><i class="fas fa-pen"></i> ' + etiqueta + '</span></div>' +
                accionesNota + caja +
                '</div>';
        } else {
            lineasNota += accionesNota + caja;
        }
    });

    u.canceladas.forEach(function (it) {
        lineasNota += '<div class="tp-nota-grupo tp-nota-cancelada">' +
            '<div class="tp-nota-head"><span class="tp-nota-cant">' + tpCantidad(it.quantity) + '×</span>' +
            '<span class="tp-nota-texto"><i class="fas fa-ban"></i> ' + (it.notes ? tpEsc(it.notes) : 'cancelado') + '</span></div></div>';
    });

    // Anotar UNA pieza del grupo sin separarla a mano: parte la cantidad, deja el resto
    // con su nota y abre la caja de esa pieza. Es el camino táctil del caso del dueño.
    if (puedePartir) {
        // Se separa la pieza del grupo MÁS GRANDE para no dejar un renglón huérfano de 1.
        const enNota = u.notas.filter(function (n) { return n.cantidad > 1; })
            .sort(function (a, b) { return b.cantidad - a.cantidad; })[0];
        lineasNota += '<div class="tp-linea-acciones">' +
            '<button type="button" class="tp-linea-btn" data-partir-pieza="' + String(enNota.items[0].order_item_id) + '" title="Anotar una sola pieza de este platillo"><i class="fas fa-pen"></i> Anotar una pieza</button>' +
            '</div>';
    }

    // La nota única se ve junto al nombre, como antes; con varias, se lista adentro.
    const notaJunto = (!variasNotas && unicaNota && unicaNota.notas)
        ? '<div class="tp-linea-notas"><i class="fas fa-pen"></i> ' + tpEsc(unicaNota.notas) + '</div>'
        : '';

    // El borde de la izquierda dice el estado de un vistazo, sin leer.
    const clase = { pendiente: 'pendiente', enviado: 'enviado', mixto: 'mixto' }[u.estadoVista] || 'pendiente';
    const etiquetaEstado = (u.estadoVista === 'mixto' ? 'parte en cocina'
        : tpEtiquetaEstado(u.estadoVista === 'enviado'
            ? (u.estadoUnico || 'sent')
            : 'pending'));

    const quitarLineas = [];
    if (u.estadoVista === 'pendiente') {
        u.notas.forEach(function (n) {
            if (n.items.every(function (it) { return it.status === 'pending'; })) {
                quitarLineas.push('<button type="button" class="tp-linea-quitar" data-quitar-linea="' + n.items[0].order_item_id + '" title="Quitar estas piezas de la cuenta"><i class="fas fa-xmark"></i></button>');
            }
        });
    }

    return '<div class="tp-linea ' + clase + '" data-linea="' + tpEsc(u.id) + '">' +
        '<div class="tp-linea-cant">' + tpCantidad(cant) + '×</div>' +
        '<div class="tp-linea-info">' +
            '<div class="tp-linea-nombre">' + tpEsc(u.nombre) + '</div>' +
            notaJunto +
            '<div class="tp-linea-estado">' + tpEsc(etiquetaEstado) + '</div>' +
            lineasNota +
        '</div>' +
        '<div class="tp-linea-importe">' + tpDinero(u.total) +
            (quitarLineas.length ? '<div class="tp-linea-quitar-caja">' + quitarLineas.join('') + '</div>' : '') +
        '</div>' +
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
            // Cerrar la cuenta sin cobrarla es una decisión con consecuencias: se explica.
            tpConfirmar({
                titulo: 'Cerrar la cuenta',
                texto: 'La cuenta se cierra y sale del mapa del salón. El cobro se hace aparte: ' +
                       'cerrar aquí NO genera la venta ni toca la caja.',
                boton: 'Cerrar la cuenta',
                peligro: true,
                alConfirmar: async function () {
                    try {
                        await tpPeticion(TP_API_SESSION, { method: 'POST', body: JSON.stringify({ action: 'close', session_id: sessionId }) });
                        tpAviso('Cuenta cerrada', 'success');
                        tpCerrarModal('tpModalCuenta');
                        await tpCargar(true);
                    } catch (e) { tpAviso(tpMensajeDeError(e), 'error'); }
                }
            });
            return;
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

    // Acciones DENTRO de la cuenta: cada grupo de nota del platillo se ajusta y se anota
    // por separado. Al tocar algo se repinta SOLO esa tarjeta.
    document.getElementById('tpCuentaPedido').addEventListener('click', function (ev) {
        const menos = ev.target.closest('[data-nota-menos]');
        if (menos) {
            tpCambiarCantidadLinea(menos.getAttribute('data-nota-menos'), Number(menos.getAttribute('data-nota-cantidad')) - 1);
            return;
        }
        const mas = ev.target.closest('[data-nota-mas]');
        if (mas) {
            tpCambiarCantidadLinea(mas.getAttribute('data-nota-mas'), Number(mas.getAttribute('data-nota-cantidad')) + 1);
            return;
        }
        const notas = ev.target.closest('[data-linea-notas]');
        if (notas) {
            tpAlternarNotasLinea(notas.getAttribute('data-linea-notas'));
            return;
        }
        const guardar = ev.target.closest('[data-linea-guardar-notas]');
        if (guardar) {
            tpGuardarNotasLinea(guardar.getAttribute('data-linea-guardar-notas'));
            return;
        }
        const partir = ev.target.closest('[data-partir-pieza]');
        if (partir) {
            tpAnotarUnaPieza(partir.getAttribute('data-partir-pieza'));
            return;
        }
        const q = ev.target.closest('[data-quitar-linea]');
        if (q) tpQuitarLinea(q.getAttribute('data-quitar-linea'));
    });

    // Enter en la caja de notas guarda (en una tableta el teclado estorba).
    document.getElementById('tpCuentaPedido').addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        const campo = ev.target.closest('[id^="tpNotasLinea"]');
        if (!campo) return;
        ev.preventDefault();
        tpGuardarNotasLinea(campo.id.replace('tpNotasLinea', ''));
    });

    // La confirmación propia (nunca confirm() del navegador)
    document.getElementById('tpConfirmaBoton').addEventListener('click', function () {
        const accion = tpConfirmacion.accion;
        tpConfirmacion.accion = null;
        tpCerrarModal('tpModalConfirma');
        if (accion) accion();
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
    // El menú: UN toque agrega una pieza. Otro toque, otra. Sin pasos intermedios.
    document.getElementById('tpMenuProductos').addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-producto]');
        if (!b || b.disabled) return;
        b.disabled = true;
        Promise.resolve(tpAgregarDirecto(b.getAttribute('data-producto'))).then(function () {
            b.disabled = false;
        });
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
