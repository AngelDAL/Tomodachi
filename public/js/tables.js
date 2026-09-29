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
    // El apartado abierto (mapa → punto): el id del punto, o null si se está en el mapa.
    // Una cosa a la vez: el apartado SUSTITUYE al mapa, no lo tapa con un modal.
    detalle: null,
    // Firma de lo último pintado en el apartado: estado + total + consumo. Sirve para no
    // rearmar la rejilla de acciones en cada aviso de tiempo real (repintar solo lo que cambió).
    detalleFirma: null,
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
        // tpPintarCuenta se protege sola: si la cuenta no está en pantalla, no pinta nada.
        if (!silencioso) tpPintarCuenta();
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
    const importe = (tpEstado.cuentas || []).reduce(function (s, c) { return s + (Number(c.total) || 0); }, 0);
    // TRES datos y nada más: es lo que se mira de reojo antes de decidir a qué mesa ir.
    // El resto (cuántos puntos hay, cuántas cuentas) se lee en el propio mapa.
    let html = '';
    html += '<div class="tp-chip"><i class="fas fa-circle-check"></i> Libres <strong>' + t.libres + '</strong></div>';
    html += '<div class="tp-chip ' + (t.ocupados ? 'ocupado' : '') + '"><i class="fas fa-circle-dot"></i> Ocupadas <strong>' + t.ocupados + '</strong></div>';
    html += '<div class="tp-chip"><i class="fas fa-sack-dollar"></i> Por cobrar <strong>' + tpDinero(importe) + '</strong></div>';
    document.getElementById('tpResumen').innerHTML = html;
}

/** La cuenta abierta de un punto, si la tiene (por su punto o porque se juntó). */
function tpCuentaDePunto(tableId) {
    return tpEstado.cuentas.find(function (c) {
        return (c.puntos || []).some(function (p) { return Number(p.table_id) === Number(tableId); });
    }) || null;
}

/**
 * ¿Se está viendo la cuenta de un punto ahora mismo?
 * Sustituye al viejo "¿hay algún modal abierto?": la cuenta ya no es un modal, es el
 * apartado del punto. Con esto se evita repintar en segundo plano.
 */
function tpCuentaVisible() {
    const panel = document.getElementById('tpCuentaPanel');
    const det = document.getElementById('tpDetalle');
    return !!(panel && det && !panel.classList.contains('hidden') && !det.classList.contains('hidden'));
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

    cont.innerHTML = aviso + '<div class="tp-grid">' + puntos.map(tpFichaDePunto).join('') + '</div>';

    // Si hay un apartado abierto se mantiene al día (o se cierra solo si su punto dejó de
    // existir en el mapa, p. ej. al desactivarlo sin "ver desactivados").
    if (tpEstado.detalle !== null) {
        if (tpPuntoPorId(tpEstado.detalle)) tpPintarDetalle();
        else tpCerrarDetalle();
    }
}

/**
 * La ficha de un punto EN EL MAPA: se lee, no se opera.
 *
 * Lleva su estado actual y los datos que importan (código, tiempo, personas, consumo y
 * total) y NINGÚN botón: toda la ficha es el botón que entra a su apartado. Así una pantalla
 * con veinte mesas no son ochenta botones, y quien no está acostumbrado no tiene que decidir
 * nada hasta que entra a la mesa que le interesa.
 */
function tpFichaDePunto(p) {
    const cuenta = tpCuentaDePunto(p.table_id);
    const apagado = Number(p.is_active) !== 1;
    const clase = 'tp-card' + (cuenta ? ' ocupado' : '') + (apagado ? ' apagado' : '');

    // Un punto PUEDE estar desactivado y con la cuenta abierta a la vez (pasa de verdad: se
    // desactiva la mesa y la cuenta sigue viva). En ese caso manda la CUENTA —es lo que hay
    // que cobrar— y lo de "desactivado" se dice al lado, sin tapar el dato.
    const insignias = [];
    if (cuenta) insignias.push('<span class="tp-estado ocupado">Ocupado</span>');
    else if (!apagado) insignias.push('<span class="tp-estado">Libre</span>');
    if (apagado) insignias.push('<span class="tp-estado apagado">Desactivado</span>');

    const flecha = '<span class="tp-card-flecha"><i class="fas fa-chevron-right"></i></span>';
    const notaApagado = '<div class="tp-datos"><span><i class="fas fa-ban"></i> Punto desactivado</span></div>';
    let cuerpo = '';
    let pie = '';

    if (cuenta) {
        cuerpo = '<div><span class="tp-codigo">' + tpEsc(cuenta.code) + '</span></div>' +
            '<div class="tp-datos">' +
                '<span><i class="fas fa-clock"></i> ' + Number(cuenta.minutos_abierta) + ' min</span>' +
                '<span><i class="fas fa-user-group"></i> ' + Number(cuenta.personas) + '</span>' +
                '<span><i class="fas fa-utensils"></i> ' + Number(cuenta.items) + '</span>' +
            '</div>' +
            ((cuenta.puntos || []).length > 1
                ? '<div class="tp-datos"><span><i class="fas fa-link"></i> ' + tpEsc(cuenta.puntos_texto) + '</span></div>'
                : '') +
            (apagado ? notaApagado : '');
        pie = '<span class="tp-card-total">' + tpDinero(cuenta.total) + '</span>' + flecha;
    } else if (apagado) {
        cuerpo = '<div class="tp-datos"><span><i class="fas fa-ban"></i> Fuera de servicio</span></div>';
        pie = '<span class="tp-datos"><span>Entra para reactivarlo</span></span>' + flecha;
    } else {
        cuerpo = '<div class="tp-datos"><span><i class="fas fa-circle-check"></i> Sin cuenta abierta</span></div>';
        pie = '<span class="tp-datos"><span>Lista para atender</span></span>' + flecha;
    }

    return '<button type="button" class="' + clase + '" data-abrir="' + p.table_id + '" ' +
        'aria-label="Abrir el apartado de ' + tpEsc(p.label) + '">' +
        '<div class="tp-card-top">' +
            '<div><h3 class="tp-nombre">' + tpEsc(p.label) + '</h3>' +
            (p.zone ? '<p class="tp-zona">' + tpEsc(p.zone) + '</p>' : '') + '</div>' +
            '<div class="tp-card-insignias">' + insignias.join('') + '</div>' +
        '</div>' +
        cuerpo +
        '<div class="tp-card-pie">' + pie + '</div>' +
        '</button>';
}

// ============================================================
// El apartado de un punto: nivel 2 del salón
// ============================================================
/**
 * Entra al apartado de un punto: sustituye al mapa.
 *
 * No es un modal: es la misma vista del salón mostrando otra cosa. Por eso dentro se puede
 * poner la cuenta completa (pedido y menú) sin que haya un modal encima de otro.
 */
function tpAbrirDetalle(tableId) {
    const p = tpPuntoPorId(tableId);
    if (!p) return;
    tpEstado.detalle = Number(p.table_id);
    tpEstado.detalleFirma = null;   // se pinta de cero la ficha y sus acciones
    document.getElementById('tpMapa').classList.add('hidden');
    document.getElementById('tpDetalle').classList.remove('hidden');

    const cuenta = tpCuentaDePunto(p.table_id);
    // Al cambiar de punto se suelta la cuenta anterior: si no, el panel enseñaría el pedido
    // de la mesa que se acaba de dejar.
    const actual = tpEstado.cuentaActual;
    if (!cuenta || !actual || Number(actual.session.session_id) !== Number(cuenta.session_id)) {
        tpEstado.cuentaActual = null;
    }
    tpPintarDetalle();

    // La cuenta se pide al servidor al entrar: el mapa trae el RESUMEN, no el pedido.
    if (cuenta) {
        // En el teléfono se ve UN panel a la vez y el que importa al llegar es el PEDIDO (qué
        // lleva la mesa); el menú se abre desde "Agregar platillo". Sin esto, el panel del menú
        // quedaba primero y había que bajar por él para ver la cuenta.
        tpMostrarLado('pedido');
        tpCargarCuenta(cuenta.session_id);
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
}

/** Alterna el panel visible de la cuenta (en escritorio se ven los dos a la vez). */
function tpMostrarLado(lado) {
    const tabs = document.getElementById('tpCuentaTabs');
    document.getElementById('tpCuentaCuerpoDos').setAttribute('data-lado', lado);
    tabs.querySelectorAll('.tp-tab').forEach(function (t) {
        t.classList.toggle('activo', t.getAttribute('data-lado') === lado);
    });
}

/** Vuelve al mapa (el botón de regresar y la tecla Esc). */
function tpCerrarDetalle() {
    tpEstado.detalle = null;
    tpEstado.detalleFirma = null;
    tpEstado.cuentaActual = null;
    document.getElementById('tpCuentaPanel').classList.add('hidden');
    document.getElementById('tpDetalle').classList.add('hidden');
    document.getElementById('tpMapa').classList.remove('hidden');
    tpPintar();   // el mapa se rearma: mientras se estaba dentro pudieron cambiar cosas
}

/**
 * Ejecuta una de las acciones del apartado del punto.
 *
 * El COBRO no pasa por aquí: js/cobro.js escucha su botón (`#tpCuentaCobrar`) por delegación
 * y se encarga del modal de cobro completo. Así el flujo de dinero sigue en un solo módulo.
 */
async function tpAccionDetalle(accion, boton) {
    const id = tpEstado.detalle;
    const p = id === null ? null : tpPuntoPorId(id);
    if (!p) return;
    const cuenta = tpCuentaDePunto(p.table_id);

    if (accion === 'qr') return tpMostrarQr(p);
    if (accion === 'editar') return tpEditarPunto(p.table_id);
    if (accion === 'desactivar') return tpDesactivarPunto(p.table_id);
    if (accion === 'reactivar') return tpReactivarPunto(p.table_id);

    // OJO con el orden: "abrir cuenta" es la acción de un punto SIN cuenta, así que va ANTES
    // del corte de abajo (si no, nunca se llega a ella: la mesa libre se queda sin hacer nada).
    if (accion === 'abrir') {
        if (boton) boton.disabled = true;
        try {
            const d = await tpPeticion(TP_API_SESSION, { method: 'POST', body: JSON.stringify({ action: 'open_table', table_id: Number(p.table_id) }) });
            tpAviso('Cuenta ' + d.code + ' abierta en ' + d.label, 'success');
            await tpCargar(true);      // el mapa ya sabe que este punto está ocupado
            await tpCargarCuenta(d.session_id);
            tpPintarDetalle();
        } catch (e) {
            tpAviso(tpMensajeDeError(e), 'error');
        } finally { if (boton) boton.disabled = false; }
        return;
    }

    // De aquí para abajo TODO es trabajo sobre la cuenta abierta del punto.
    if (!cuenta) return;
    if (accion === 'juntar') return tpJuntarPunto(p.table_id);
    if (accion === 'qr_cuenta') return tpVerQrCuenta();

    if (accion === 'anotar') {
        // Anotar ES estar en el menú: se enseña ese panel y la vista se va con él.
        tpMostrarLado('menu');
        const panel = document.getElementById('tpCuentaPanel');
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // En escritorio los dos paneles se ven a la vez: basta con dejar el cursor listo.
        const buscar = document.getElementById('tpMenuBuscar');
        if (buscar && window.matchMedia('(min-width: 901px)').matches) buscar.focus();
    }
}

/** Los desactivados no ensucian el mapa: ese interruptor vive en el menú de tres puntos. */
function tpAlternarApagados() {
    tpEstado.verApagados = !tpEstado.verApagados;
    const texto = document.getElementById('tpApagadosTexto');
    if (texto) texto.textContent = tpEstado.verApagados ? 'Ocultar desactivados' : 'Ver desactivados';
    const icono = document.querySelector('#tpMenuApagados i');
    if (icono) icono.className = 'fas fa-' + (tpEstado.verApagados ? 'eye-slash' : 'eye');
    tpCargar();
}

/**
 * Engancha un menú de tres puntos: abre y cierra con su botón, se cierra al tocar fuera y
 * delega el clic de sus opciones (el contenido se rearma según el estado del punto).
 */
function tpEngancharMenu(idBoton, idMenu, alElegir) {
    const boton = document.getElementById(idBoton);
    const menu = document.getElementById(idMenu);
    if (!boton || !menu) return;
    boton.addEventListener('click', function (ev) {
        ev.stopPropagation();
        const abierto = !menu.classList.contains('hidden');
        menu.classList.toggle('hidden', abierto);
        boton.setAttribute('aria-expanded', abierto ? 'false' : 'true');
    });
    document.addEventListener('click', function (ev) {
        if (!menu.classList.contains('hidden') && !menu.contains(ev.target) && !boton.contains(ev.target)) {
            menu.classList.add('hidden');
            boton.setAttribute('aria-expanded', 'false');
        }
    });
    menu.addEventListener('click', function (ev) {
        const b = ev.target.closest('button');
        if (!b) return;
        menu.classList.add('hidden');
        boton.setAttribute('aria-expanded', 'false');
        alElegir(b);
    });
}

/** Las acciones del punto: máximo CUATRO, cada una con su nombre a la vista. */
function tpAccionesDePunto(p, cuenta, apagado) {
    const acciones = [];
    // La cuenta manda: un punto desactivado CON cuenta abierta sigue teniendo que cobrarse.
    if (cuenta) {
        acciones.push({ accion: 'cobrar', icono: 'cash-register', texto: 'Cobrar la cuenta', clase: 'primario', id: 'tpCuentaCobrar' });
        acciones.push({ accion: 'anotar', icono: 'utensils', texto: 'Agregar platillo' });
        acciones.push({ accion: 'juntar', icono: 'link', texto: 'Juntar otra mesa' });
        acciones.push({ accion: 'qr_cuenta', icono: 'qrcode', texto: 'QR de la cuenta' });
        return acciones;
    }
    if (apagado) {
        acciones.push({ accion: 'reactivar', icono: 'power-off', texto: 'Reactivar', clase: 'primario' });
        acciones.push({ accion: 'qr', icono: 'qrcode', texto: 'Ver el QR' });
        acciones.push({ accion: 'editar', icono: 'pen', texto: 'Editar el punto' });
        return acciones;
    }
    acciones.push({ accion: 'abrir', icono: 'play', texto: 'Abrir cuenta', clase: 'primario' });
    acciones.push({ accion: 'qr', icono: 'qrcode', texto: 'Ver el QR' });
    acciones.push({ accion: 'editar', icono: 'pen', texto: 'Editar el punto' });
    acciones.push({ accion: 'desactivar', icono: 'ban', texto: 'Desactivar', clase: 'peligro' });
    return acciones;
}

/**
 * Pinta el apartado del punto abierto: nombre, estado, la ficha y sus cuatro acciones.
 *
 * La rejilla de acciones solo se rearma cuando cambia de verdad (estado, total o consumo):
 * en cada aviso de tiempo real se refrescan los TEXTOS, no el HTML. Repintar todo se siente
 * como si la pantalla parpadeara.
 */
function tpPintarDetalle() {
    const id = tpEstado.detalle;
    const p = id === null ? null : tpPuntoPorId(id);
    if (!p) { tpCerrarDetalle(); return; }

    const cuenta = tpCuentaDePunto(p.table_id);
    const apagado = Number(p.is_active) !== 1;

    document.getElementById('tpDetalleNombre').textContent = p.label;
    const zona = document.getElementById('tpDetalleZona');
    zona.textContent = p.zone || '';
    zona.classList.toggle('hidden', !p.zone);

    const badge = document.getElementById('tpDetalleEstado');
    badge.textContent = cuenta ? 'Ocupado' : (apagado ? 'Desactivado' : 'Libre');
    badge.className = 'tp-estado' + (cuenta ? ' ocupado' : (apagado ? ' apagado' : ''));

    // Un punto desactivado con la cuenta abierta (pasa de verdad) merece su explicación: su
    // cuenta sigue viva y hay que cobrarla, aunque la mesa ya no se use.
    const aviso = document.getElementById('tpDetalleAviso');
    if (cuenta && apagado) {
        aviso.classList.remove('hidden');
        aviso.innerHTML = '<i class="fas fa-triangle-exclamation"></i> Este punto está desactivado y no acepta ' +
            'pedidos nuevos, pero su cuenta sigue abierta: hay que cobrarla o cancelarla.';
    } else {
        aviso.classList.add('hidden');
        aviso.innerHTML = '';
    }

    // El panel de la cuenta solo existe si el punto tiene cuenta abierta.
    document.getElementById('tpCuentaPanel').classList.toggle('hidden', !cuenta);

    const actual = tpEstado.cuentaActual;
    const pausado = !!(cuenta && actual && actual.session &&
        Number(actual.session.session_id) === Number(cuenta.session_id) &&
        Number(actual.session.ordering_enabled) !== 1);

    const firma = [p.table_id, apagado ? 'a' : 'n', cuenta ? 'c' : 'l',
        cuenta ? Number(cuenta.total) || 0 : '', cuenta ? Number(cuenta.items) || 0 : '', pausado ? 'p' : 'o'].join('|');
    if (firma === tpEstado.detalleFirma) return;
    tpEstado.detalleFirma = firma;

    // La ficha: o está disponible, o fuera de servicio, o es la cuenta con sus datos.
    const libre = document.getElementById('tpDetalleLibre');
    const ficha = document.getElementById('tpDetalleFicha');
    if (cuenta) {
        ficha.classList.remove('hidden');
        libre.classList.add('hidden');
        // El total se adelanta del resumen del mapa; tpPintarCuenta lo confirma con el
        // detalle de la cuenta en cuanto llega.
        const total = document.getElementById('tpCuentaTotal');
        if (total) total.textContent = tpDinero(cuenta.total);
    } else {
        ficha.classList.add('hidden');
        libre.classList.remove('hidden');
        libre.innerHTML = apagado
            ? '<i class="fas fa-ban"></i><div><h3>Desactivado</h3>' +
              '<p>No aparece en el mapa del salón ni acepta pedidos. Reactívalo para volver a usarlo.</p></div>'
            : '<i class="fas fa-circle-check"></i><div><h3>Disponible</h3>' +
              '<p>Sin cuenta abierta. Al abrirla se genera el código con el que el cliente pide desde su teléfono.</p></div>';
    }

    // Las cuatro acciones.
    document.getElementById('tpDetalleAcciones').innerHTML = tpAccionesDePunto(p, cuenta, apagado)
        .map(function (a) {
            return '<button type="button" class="tp-accion' + (a.clase ? ' ' + a.clase : '') + '"' +
                (a.id ? ' id="' + a.id + '"' : '') +
                ' data-accion-detalle="' + a.accion + '">' +
                '<i class="fas fa-' + a.icono + '"></i> ' + tpEsc(a.texto) + '</button>';
        }).join('');

    // Una cuenta sin consumo no se cobra: se cancela con un motivo. El cobro
    // (js/cobro.js) lee el estado del botón, así que se le deja dicho aquí.
    const botonCobrar = document.getElementById('tpCuentaCobrar');
    if (botonCobrar && cuenta) {
        const totalNum = Number(cuenta.total) || 0;
        botonCobrar.disabled = totalNum <= 0;
        botonCobrar.title = totalNum <= 0
            ? 'La cuenta no tiene consumo: cancélela con un motivo'
            : 'Cobrar esta cuenta';
    }

    // Sin carta publicada, el QR no lleva a ninguna parte: es mejor decir por qué que dejar
    // un botón que solo puede abrir un aviso de error.
    if (tpEstado.sinCarta) {
        document.querySelectorAll('#tpDetalleAcciones [data-accion-detalle="qr"], #tpDetalleAcciones [data-accion-detalle="qr_cuenta"]')
            .forEach(function (b) {
                b.disabled = true;
                b.title = 'Todavía no hay una carta publicada: este QR no lleva a ninguna parte';
            });
    }

    // Lo que NO es flujo del día vive en el menú de tres puntos: pausar, cerrar, cancelar
    // y editar. Para un punto libre o desactivado no hace falta menú: sus tres o cuatro
    // acciones ya están a la vista.
    const engranaje = document.getElementById('tpDetalleEngranaje');
    const menu = document.getElementById('tpDetalleMenu');
    const opciones = [];
    if (cuenta) {
        opciones.push('<button type="button" data-config="' + (pausado ? 'resume' : 'pause') + '"><i class="fas fa-pause"></i> ' +
            '<span id="tpConfigPausaTexto">' + (pausado ? 'Reanudar pedidos' : 'Pausar pedidos') + '</span></button>');
        opciones.push('<button type="button" data-punto="editar"><i class="fas fa-pen"></i> Editar el punto</button>');
        if (apagado) opciones.push('<button type="button" data-punto="reactivar"><i class="fas fa-power-off"></i> Reactivar el punto</button>');
        opciones.push('<button type="button" data-config="close"><i class="fas fa-flag-checkered"></i> Cerrar la cuenta</button>');
        opciones.push('<button type="button" data-config="cancel" class="peligro"><i class="fas fa-ban"></i> Cancelar la cuenta…</button>');
    } else if (apagado) {
        opciones.push('<button type="button" data-punto="editar"><i class="fas fa-pen"></i> Editar el punto</button>');
    }
    engranaje.classList.toggle('hidden', !opciones.length);
    menu.innerHTML = opciones.join('');
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
    tpPintarChipsCarta(0);   // por defecto, la carta de la tienda
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
    tpPintarChipsCarta(p.menu_id || 0);
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
        const carta = Number(tpEstado.cartaElegida) || 0;
        if (tpEstado.puntoEditando) {
            d = await tpPeticion(TP_API_TABLES, { method: 'PUT', body: JSON.stringify({ table_id: tpEstado.puntoEditando.table_id, label: label, zone: zone, menu_id: carta }) });
            await tpCargar(true);   // el nombre y la carta del punto se ven en el mapa
        } else {
            d = await tpPeticion(TP_API_TABLES, { method: 'POST', body: JSON.stringify({ label: label, zone: zone, menu_id: carta }) });
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
/**
 * Abre el apartado de un punto con su cuenta a la vista.
 *
 * Antes esto abría el modal de la cuenta ENCIMA del mapa del salón. Ahora entra al apartado
 * del punto (nivel 2): la cuenta vive dentro, con sus cuatro acciones.
 */
function tpVerCuenta(tableId) {
    const cuenta = tpCuentaDePunto(tableId);
    if (!cuenta) return;
    tpAbrirDetalle(tableId);   // el apartado ya pide la cuenta del punto al entrar
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
    // La cuenta ya no es un modal: se pinta solo si su apartado está a la vista.
    if (!tpCuentaVisible()) return;
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

    // El cambio de pausa/reanudar vive en el menú de tres puntos del apartado.
    const pausaTexto = document.getElementById('tpConfigPausaTexto');
    if (pausaTexto) pausaTexto.textContent = pausado ? 'Reanudar pedidos' : 'Pausar pedidos';

    // El total, en la ficha de arriba y en el encabezado del pedido: es lo primero que se mira.
    const total = tpDinero(s.totals.total);
    document.getElementById('tpCuentaTotal').textContent = total;
    document.getElementById('tpCuentaTotalPedido').textContent = total;
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
    // El botón de cobrar es una de las cuatro acciones del apartado: su estado lo pinta
    // tpPintarDetalle (una cuenta sin consumo no se cobra, se cancela con un motivo).
    const btnCobrar = document.getElementById('tpCuentaCobrar');
    if (btnCobrar) {
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
        // En el teléfono no hay "menú de la izquierda": ahí el menú es una pestaña de arriba.
        const enTelefono = window.matchMedia('(max-width: 900px)').matches;
        cont.innerHTML = '<div class="tp-aviso">Todavía no hay nada pedido en esta cuenta. ' +
            (enTelefono ? 'Toca <strong>Menú</strong> aquí arriba para anotar lo que piden.' : 'Anota del menú de la izquierda.') +
            '</div>';
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
                        // La cuenta ya no está: se vuelve al mapa, que es donde se ve el salón.
                        tpCerrarDetalle();
                        await tpCargar(true);
                    } catch (e) { tpAviso(tpMensajeDeError(e), 'error'); }
                }
            });
            return;
        } else if (accion === 'cancelar') {
            const campo = document.getElementById('tpCancelarMotivo');
            campo.value = '';
            // El apartado del punto se queda detrás: el aviso de cancelar es un modal del
            // sistema, no otro nivel de la cuenta.
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
    document.getElementById('tpPuntoGuardar').addEventListener('click', tpGuardarPunto);
    document.getElementById('tpPuntoNombre').addEventListener('keydown', function (e) { if (e.key === 'Enter') tpGuardarPunto(); });

    // ── El mapa ────────────────────────────────────────────────────────────────
    // La ficha de un punto es un botón completo: se toca y se entra a su apartado. No hay
    // más acciones en el mapa a propósito.
    document.getElementById('tpContenido').addEventListener('click', function (ev) {
        const ficha = ev.target.closest('[data-abrir]');
        if (ficha) tpAbrirDetalle(ficha.getAttribute('data-abrir'));
    });

    tpEngancharMenu('tpMapaMenuBtn', 'tpMapaMenu', function (boton) {
        if (boton.id === 'tpMenuApagados') tpAlternarApagados();
    });

    // ── El apartado del punto ──────────────────────────────────────────────────
    document.getElementById('tpVolver').addEventListener('click', tpCerrarDetalle);

    // Las cuatro acciones del punto. El cobro NO se maneja aquí: js/cobro.js escucha el
    // botón `#tpCuentaCobrar` por delegación y se encarga de todo el flujo de cobro.
    document.getElementById('tpDetalleAcciones').addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-accion-detalle]');
        if (b) tpAccionDetalle(b.getAttribute('data-accion-detalle'), b);
    });

    tpEngancharMenu('tpDetalleMenuBtn', 'tpDetalleMenu', function (boton) {
        const config = boton.getAttribute('data-config');
        if (config) { tpAccionCuenta(config); return; }
        const punto = boton.getAttribute('data-punto');
        if (punto === 'editar') tpEditarPunto(tpEstado.detalle);
        if (punto === 'reactivar') tpReactivarPunto(tpEstado.detalle);
    });

    // ── La CARTA ───────────────────────────────────────────────────────────────
    // Lista de cartas: tres acciones visibles y el resto en los botones de icono.
    document.getElementById('ctaCartas').addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-carta-accion]');
        if (!b) return;
        const id = Number(b.getAttribute('data-carta'));
        const accion = b.getAttribute('data-carta-accion');
        const c = ctaPorId(id);
        if (!c) return;
        if (accion === 'abrir') return window.open(c.url_publica, '_blank');
        if (accion === 'qr') return tpMostrarQr({ label: 'Carta: ' + c.name, url: c.url_publica, esCarta: true });
        if (accion === 'productos') return ctaAbrirProductos(id);
        if (accion === 'editar') return ctaEditar(id);
        if (accion === 'activar' || accion === 'desactivar') return ctaAlternarActiva(id);
        if (accion === 'eliminar') return ctaEliminar(id);
        if (accion === 'enlace') {
            if (navigator.clipboard) navigator.clipboard.writeText(c.url_publica).then(function () { tpAviso('Enlace copiado', 'success'); });
            else tpAviso(c.url_publica, 'info');
        }
    });

    document.getElementById('ctaBtnNueva').addEventListener('click', ctaNueva);
    document.getElementById('ctaGuardar').addEventListener('click', ctaGuardar);
    document.getElementById('ctaNombre').addEventListener('keydown', function (e) { if (e.key === 'Enter') ctaGuardar(); });
    document.getElementById('ctaModos').addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-modo]');
        if (!b) return;
        ctaEstado.modo = b.getAttribute('data-modo');
        ctaPintarModal();
    });
    document.getElementById('ctaOpciones').addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-opcion]');
        if (!b) return;
        const op = b.getAttribute('data-opcion');
        ctaEstado.opciones[op] = ctaEstado.opciones[op] ? 0 : 1;
        ctaPintarModal();
    });
    document.getElementById('ctaVolver').addEventListener('click', ctaCerrarProductos);
    document.getElementById('ctaBuscar').addEventListener('input', function () {
        ctaEstado.busqueda = this.value.trim();
        ctaPintarProductos();
    });
    document.getElementById('ctaProductos').addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-producto-carta]');
        if (b) ctaAlternarProducto(b.getAttribute('data-producto-carta'));
    });

    // La carta del punto (chips del modal del punto)
    document.getElementById('tpPuntoCarta').addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-carta]');
        if (b) tpPintarChipsCarta(b.getAttribute('data-carta'));
    });

    // ── Activar (la tableta del mesero) ────────────────────────────────────────
    // El número se puede teclear o llegar por el QR del comensal (?c=47), que abre ESTA vista.
    const params = new URLSearchParams(window.location.search);
    const codigoUrl = (params.get('c') || '').replace(/\D/g, '').slice(0, 2);
    if (codigoUrl) {
        const campo = document.getElementById('actCodigo');
        campo.value = codigoUrl;
        const ayuda = document.getElementById('actAyuda');
        if (ayuda) ayuda.innerHTML = '<i class="fas fa-qrcode"></i> Escaneaste el código <strong>' + tpEsc(codigoUrl) +
            '</strong>. Toca «Activar» y ese dispositivo podrá pedir.';
    }
    document.getElementById('actBtnActivar').addEventListener('click', function () {
        const codigo = (document.getElementById('actCodigo').value || '').replace(/\D/g, '');
        if (codigo.length < 1) { actError('Escribe los dos números que te dicen'); return; }
        actAccion({ action: 'activar', code: codigo }, function (d) {
            return 'Activado: ' + (d.punto ? d.punto + ' ' : '') + 'ya puede pedir';
        });
    });
    document.getElementById('actCodigo').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') document.getElementById('actBtnActivar').click();
    });
    document.getElementById('actLista').addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-act-activar],[data-act-rechazar],[data-act-expulsar],[data-act-reiniciar]');
        if (!b) return;
        if (b.hasAttribute('data-act-activar')) {
            return actAccion({ action: 'activar', participant_id: Number(b.getAttribute('data-act-activar')) },
                function (d) { return 'Activado: ' + (d.punto ? d.punto + ' ' : '') + 'ya puede pedir'; });
        }
        if (b.hasAttribute('data-act-rechazar')) {
            return actAccion({ action: 'rechazar', participant_id: Number(b.getAttribute('data-act-rechazar')) },
                function () { return 'Solicitud rechazada'; });
        }
        if (b.hasAttribute('data-act-expulsar')) {
            const pid = Number(b.getAttribute('data-act-expulsar'));
            return tpConfirmar({
                titulo: 'Expulsar este dispositivo',
                texto: 'Deja de poder pedir en esta cuenta ahora mismo. Si es un cliente que sigue en la mesa, tendrá que pedir activación otra vez (dos toques).',
                boton: 'Expulsar',
                peligro: true,
                alConfirmar: function () {
                    actAccion({ action: 'expulsar', participant_id: pid }, function () { return 'Dispositivo expulsado'; });
                }
            });
        }
        const tableId = Number(b.getAttribute('data-act-reiniciar'));
        tpConfirmar({
            titulo: 'Reiniciar la mesa',
            texto: 'Se expulsa a TODOS los dispositivos de esta cuenta sin cerrarla: el consumo sigue y quien esté sentado vuelve a pedir su activación. Úsalo cuando la mesa cambió de gente.',
            boton: 'Reiniciar la mesa',
            peligro: true,
            alConfirmar: function () {
                actAccion({ action: 'reiniciar_mesa', table_id: tableId }, function (d) {
                    return 'Mesa reiniciada: ' + ((d && d.dispositivos) || 0) + ' dispositivo(s) fuera';
                });
            }
        });
    });

    // Esc regresa al mapa: en escritorio es lo que la mano espera. Si hay un modal abierto
    // (el cobro, juntar, cancelar, el QR) se cierra ESE, no la vista de abajo.
    document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Escape' || tpEstado.detalle === null) return;
        if (tpAlgunModalAbierto()) return;
        tpCerrarDetalle();
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
            // La cuenta ya no está: al mapa, que es donde se ve el salón.
            tpCerrarDetalle();
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
// La CARTA: lo que ve el cliente al escanear el QR de un punto
// ============================================================
/**
 * La carta vive AQUÍ, dentro del módulo del piso, porque es la otra cara de lo mismo: el QR
 * de un punto abre esta carta y el modo de la carta decide si el comensal puede pedir.
 *
 * Mismo patrón de dos niveles que el salón: la lista se LEE (nombre, modo, estado, enlace y
 * qué puntos la usan) y se entra a una para elegir qué se ve. Tres acciones a la vista y el
 * resto (editar, activar, eliminar, copiar) en el menú de tres puntos.
 */
const TP_API_MENUS = '../api/menu/menus.php';

const CTA_MODOS = [
    { id: 'menu_only',     icono: 'book-open',   texto: 'Solo consulta' },
    { id: 'open_tab',      icono: 'receipt',     texto: 'Cuenta abierta' },
    { id: 'order_and_pay', icono: 'credit-card', texto: 'Pago inmediato' },
];
const CTA_ETIQUETA_MODO = { menu_only: 'Solo consulta', open_tab: 'Pide y paga al final', order_and_pay: 'Paga por adelantado' };
const CTA_AYUDA_MODO = {
    menu_only: 'El cliente SOLO mira: sin controles de pedido. El personal anota y cobra en el punto de venta.',
    open_tab: 'El cliente pide desde su teléfono y se cobra al final. El personal abre el punto (mesa, habitación, estación) y la cuenta vive ahí.',
    order_and_pay: 'El cliente paga por adelantado desde su teléfono. Sirve de kiosko: sin personal de por medio.',
};

const ctaEstado = {
    cartas: [],
    productos: [],     // el catálogo servible (mismo filtro que la carta pública)
    carta: null,       // la carta abierta en "qué se ve"
    items: [],         // sus menu_items: lo que ordena, destaca y OCULTA
    busqueda: '',
    modo: 'open_tab',
    opciones: { activa: 1, notas: 1, promos: 1 },
    editando: null,    // carta que se está editando (null = nueva)
    cargando: false,
};

function ctaPorId(id) {
    return ctaEstado.cartas.find(function (c) { return Number(c.menu_id) === Number(id); }) || null;
}

/** Las cartas de la tienda. Se piden una vez por pantalla (forzar = volver a pedirlas). */
async function ctaTraerCartas(forzar) {
    if (ctaEstado.cartas.length && !forzar) return ctaEstado.cartas;
    const lista = await tpPeticion(TP_API_MENUS);
    ctaEstado.cartas = Array.isArray(lista) ? lista : [];
    return ctaEstado.cartas;
}

/** ¿Algún modo de la carta permite pedir? (espejo de `admitePedido` de la carta pública) */
function ctaAdmitePedido(mode) {
    return mode === 'order_and_pay' || mode === 'open_tab';
}

async function ctaCargar() {
    const cont = document.getElementById('ctaCartas');
    if (cont && !ctaEstado.cartas.length) {
        cont.innerHTML = '<div class="tp-vacio"><i class="fas fa-spinner fa-spin"></i><p>Cargando las cartas…</p></div>';
    }
    try {
        await ctaTraerCartas(true);
        // El catálogo servible: se reusa el que ya pide el menú del mesero (mismo filtro).
        if (!tpEstado.catalogo.length) await tpCargarCatalogo();
        ctaEstado.productos = tpEstado.catalogo.slice();
    } catch (e) {
        if (cont) cont.innerHTML = '<div class="tp-vacio"><i class="fas fa-triangle-exclamation"></i><h3>No se pudieron cargar las cartas</h3><p>' + tpEsc(tpMensajeDeError(e)) + '</p></div>';
        return;
    }
    ctaPintar();
}

function ctaPintar() {
    const cont = document.getElementById('ctaCartas');
    if (!cont) return;
    if (!ctaEstado.cartas.length) {
        cont.innerHTML = '<div class="tp-vacio"><i class="fas fa-book-open"></i>' +
            '<h3>Todavía no hay ninguna carta</h3>' +
            '<p>La carta es lo que el cliente ve al escanear el QR de un punto. Elige si puede pedir desde su teléfono o solo mirar.</p>' +
            '<p style="margin-top:14px"><button type="button" class="tp-btn primario" id="ctaVacioNueva"><i class="fas fa-plus"></i> Crear la primera</button></p></div>';
        const b = document.getElementById('ctaVacioNueva');
        if (b) b.addEventListener('click', ctaNueva);
        return;
    }
    cont.innerHTML = '<div class="tp-grid">' + ctaEstado.cartas.map(ctaTarjeta).join('') + '</div>';
}

/** La ficha de una carta en la lista: se lee y se entra. Tres acciones y un menú, no más. */
function ctaTarjeta(c) {
    const activa = Number(c.is_active) === 1;
    const modo = CTA_ETIQUETA_MODO[c.mode] || c.mode;
    const puntos = (tpEstado.puntos || []).filter(function (p) {
        return Number((p.carta || {}).menu_id || 0) === Number(c.menu_id);
    }).map(function (p) { return p.label; });
    // La "carta de la tienda" es la primera activa: es la que abren los puntos que no eligen.
    const esDeTienda = activa && ctaEstado.cartas.filter(function (x) { return Number(x.is_active) === 1; })[0]
        && Number(ctaEstado.cartas.filter(function (x) { return Number(x.is_active) === 1; })[0].menu_id) === Number(c.menu_id);

    const insignias = [];
    insignias.push('<span class="tp-estado' + (activa ? '' : ' apagado') + '">' + (activa ? 'Activa' : 'Desactivada') + '</span>');
    insignias.push('<span class="tp-estado' + (ctaAdmitePedido(c.mode) ? '' : ' apagado') + '">' + tpEsc(modo) + '</span>');
    if (esDeTienda) insignias.push('<span class="tp-estado apagado">La de la tienda</span>');

    return '<div class="tp-card' + (activa ? '' : ' apagado') + '">' +
        '<div class="tp-card-top">' +
            '<div><h3 class="tp-nombre">' + tpEsc(c.name) + '</h3>' +
            (c.description ? '<p class="tp-zona">' + tpEsc(c.description) + '</p>' : '') + '</div>' +
            '<div class="tp-card-insignias">' + insignias.join('') + '</div>' +
        '</div>' +
        '<div class="tp-datos">' +
            '<span><i class="fas fa-utensils"></i> ' + ctaEstado.productos.length + ' productos</span>' +
            '<span><i class="fas fa-chair"></i> ' +
                (puntos.length ? tpEsc(puntos.join(', ')) : 'ningún punto la eligió') + '</span>' +
        '</div>' +
        '<div class="tp-acciones">' +
            '<button type="button" class="tp-btn primario" data-carta-accion="abrir" data-carta="' + c.menu_id + '"><i class="fas fa-up-right-from-square"></i> Abrir la carta</button>' +
            '<button type="button" class="tp-btn" data-carta-accion="qr" data-carta="' + c.menu_id + '"><i class="fas fa-qrcode"></i> Ver el QR</button>' +
            '<button type="button" class="tp-btn" data-carta-accion="productos" data-carta="' + c.menu_id + '"><i class="fas fa-list-check"></i> Qué se ve</button>' +
            '<button type="button" class="tp-btn tp-icono" data-carta-accion="editar" data-carta="' + c.menu_id + '" title="Editar la carta"><i class="fas fa-pen"></i></button>' +
            '<button type="button" class="tp-btn tp-icono" data-carta-accion="enlace" data-carta="' + c.menu_id + '" title="Copiar el enlace público"><i class="fas fa-link"></i></button>' +
            '<button type="button" class="tp-btn tp-icono' + (activa ? ' peligro' : '') + '" data-carta-accion="' + (activa ? 'desactivar' : 'activar') + '" data-carta="' + c.menu_id + '" title="' + (activa ? 'Desactivar' : 'Activar') + '"><i class="fas fa-' + (activa ? 'eye-slash' : 'eye') + '"></i></button>' +
            '<button type="button" class="tp-btn tp-icono peligro" data-carta-accion="eliminar" data-carta="' + c.menu_id + '" title="Eliminar la carta"><i class="fas fa-trash"></i></button>' +
        '</div>' +
        '</div>';
}

// ── Modal: crear / editar ────────────────────────────────────────────────────
function ctaPintarModal() {
    const chipsModo = document.getElementById('ctaModos');
    chipsModo.innerHTML = CTA_MODOS.map(function (m) {
        return '<button type="button" class="tp-chip' + (ctaEstado.modo === m.id ? ' activo' : '') + '" data-modo="' + m.id + '">' +
            '<i class="fas fa-' + m.icono + '"></i> ' + tpEsc(m.texto) + '</button>';
    }).join('');
    document.getElementById('ctaModoAyuda').textContent = CTA_AYUDA_MODO[ctaEstado.modo] || '';

    const chipsOpc = document.getElementById('ctaOpciones');
    chipsOpc.innerHTML =
        '<button type="button" class="tp-chip' + (ctaEstado.opciones.activa ? ' activo' : '') + '" data-opcion="activa"><i class="fas fa-circle-check"></i> Activa</button>' +
        '<button type="button" class="tp-chip' + (ctaEstado.opciones.notas ? ' activo' : '') + '" data-opcion="notas"><i class="fas fa-pen"></i> Aceptar notas</button>' +
        '<button type="button" class="tp-chip' + (ctaEstado.opciones.promos ? ' activo' : '') + '" data-opcion="promos"><i class="fas fa-tags"></i> Mostrar promociones</button>';
}

function ctaNueva() {
    ctaEstado.editando = null;
    ctaEstado.modo = 'open_tab';
    ctaEstado.opciones = { activa: 1, notas: 1, promos: 1 };
    document.getElementById('ctaModalTitulo').textContent = 'Nueva carta';
    document.getElementById('ctaNombre').value = '';
    document.getElementById('ctaDescripcion').value = '';
    ctaPintarModal();
    tpAbrirModal('tpModalCarta');
    setTimeout(function () { document.getElementById('ctaNombre').focus(); }, 80);
}

function ctaEditar(id) {
    const c = ctaPorId(id);
    if (!c) return;
    ctaEstado.editando = c;
    ctaEstado.modo = c.mode || 'menu_only';
    ctaEstado.opciones = {
        activa: Number(c.is_active) === 1 ? 1 : 0,
        notas: Number(c.allow_notes) === 1 ? 1 : 0,
        promos: Number(c.show_promotions) === 1 ? 1 : 0,
    };
    document.getElementById('ctaModalTitulo').textContent = 'Editar ' + c.name;
    document.getElementById('ctaNombre').value = c.name || '';
    document.getElementById('ctaDescripcion').value = c.description || '';
    ctaPintarModal();
    tpAbrirModal('tpModalCarta');
}

async function ctaGuardar() {
    const boton = document.getElementById('ctaGuardar');
    const nombre = document.getElementById('ctaNombre').value.trim();
    if (!nombre) { tpAviso('Ponle nombre a la carta', 'error'); return; }
    const cuerpo = {
        name: nombre,
        description: document.getElementById('ctaDescripcion').value.trim(),
        mode: ctaEstado.modo,
        is_active: ctaEstado.opciones.activa ? 1 : 0,
        allow_notes: ctaEstado.opciones.notas ? 1 : 0,
        show_promotions: ctaEstado.opciones.promos ? 1 : 0,
    };
    boton.disabled = true;
    try {
        if (ctaEstado.editando) {
            cuerpo.menu_id = Number(ctaEstado.editando.menu_id);
            await tpPeticion(TP_API_MENUS, { method: 'PUT', body: JSON.stringify(cuerpo) });
        } else {
            await tpPeticion(TP_API_MENUS, { method: 'POST', body: JSON.stringify(cuerpo) });
        }
        tpAviso('Carta guardada', 'success');
        tpCerrarModal('tpModalCarta');
        await ctaTraerCartas(true);
        await ctaRefrescarPuntos();     // los puntos que la usan pueden haber cambiado de carta
        ctaPintar();
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    } finally { boton.disabled = false; }
}

/** El mapa del salón guarda la carta de cada punto: se relee para no mentir en "la usan". */
async function ctaRefrescarPuntos() {
    try {
        const d = await tpPeticion(TP_API_TABLES + (tpEstado.verApagados ? '?todas=1' : ''));
        tpEstado.puntos = d.tables || [];
        tpEstado.totales = d.totales || null;
        tpEstado.menu = d.menu || null;
        tpEstado.sinCarta = !!d.sin_carta;
    } catch (e) { /* el mapa se refresca solo por WebSocket */ }
}

async function ctaAlternarActiva(id) {
    const c = ctaPorId(id);
    if (!c) return;
    try {
        await tpPeticion(TP_API_MENUS, { method: 'PUT', body: JSON.stringify({ menu_id: Number(id), is_active: Number(c.is_active) === 1 ? 0 : 1 }) });
        tpAviso(Number(c.is_active) === 1 ? 'Carta desactivada' : 'Carta activada', 'success');
        await ctaTraerCartas(true);
        ctaPintar();
    } catch (e) { tpAviso(tpMensajeDeError(e), 'error'); }
}

function ctaEliminar(id) {
    const c = ctaPorId(id);
    if (!c) return;
    tpConfirmar({
        titulo: 'Eliminar ' + c.name,
        texto: 'Su enlace y su QR dejan de funcionar. Los puntos que la tenían asignada vuelven a la carta de la tienda. No se borra ningún producto.',
        boton: 'Eliminar la carta',
        peligro: true,
        alConfirmar: async function () {
            try {
                const d = await tpPeticion(TP_API_MENUS + '?menu_id=' + Number(id), { method: 'DELETE' });
                tpAviso((d && d.mensaje) || 'Carta eliminada', 'success');
                await ctaTraerCartas(true);
                await ctaRefrescarPuntos();
                ctaPintar();
            } catch (e) { tpAviso(tpMensajeDeError(e), 'error'); }
        }
    });
}

// ── Nivel 2: qué se ve en la carta ───────────────────────────────────────────
async function ctaAbrirProductos(id) {
    const c = ctaPorId(id);
    if (!c) return;
    const cont = document.getElementById('ctaProductos');
    cont.innerHTML = '<div class="tp-vacio-mini"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>';
    document.getElementById('ctaLista').classList.add('hidden');
    document.getElementById('ctaDetalle').classList.remove('hidden');
    document.getElementById('ctaDetalleNombre').textContent = c.name;
    document.getElementById('ctaDetalleSub').textContent = 'Lo que se ve en esta carta · ' + (CTA_ETIQUETA_MODO[c.mode] || c.mode);
    ctaEstado.busqueda = '';
    document.getElementById('ctaBuscar').value = '';
    try {
        const detalle = await tpPeticion(TP_API_MENUS + '?menu_id=' + Number(id));
        ctaEstado.carta = detalle;
        ctaEstado.items = Array.isArray(detalle.items) ? detalle.items.slice() : [];
    } catch (e) {
        cont.innerHTML = '<div class="tp-vacio-mini">' + tpEsc(tpMensajeDeError(e)) + '</div>';
        return;
    }
    ctaPintarProductos();
}

function ctaCerrarProductos() {
    ctaEstado.carta = null;
    document.getElementById('ctaDetalle').classList.add('hidden');
    document.getElementById('ctaLista').classList.remove('hidden');
    ctaPintar();
}

/** ¿Este producto está oculto en la carta abierta? */
function ctaEstaOculto(productId) {
    return ctaEstado.items.some(function (it) {
        return it.kind === 'product' && Number(it.product_id) === Number(productId) && Number(it.is_hidden) === 1;
    });
}

function ctaPintarProductos() {
    const cont = document.getElementById('ctaProductos');
    const q = ctaEstado.busqueda.toLowerCase();
    const lista = ctaEstado.productos.filter(function (p) {
        if (q && String(p.product_name).toLowerCase().indexOf(q) === -1) return false;
        return true;
    });
    if (!lista.length) {
        cont.innerHTML = '<div class="tp-vacio-mini">Nada que coincida.</div>';
        return;
    }
    const ocultos = lista.filter(function (p) { return ctaEstaOculto(p.product_id); }).length;
    cont.innerHTML = '<p class="tp-aviso" style="grid-column:1/-1">Se ven ' + (lista.length - ocultos) + ' de ' + lista.length +
        ' productos. Lo que ocultes aquí deja de salir en la carta del cliente, pero sigue vendiéndose en el punto de venta.</p>' +
        lista.map(function (p) {
            const oculto = ctaEstaOculto(p.product_id);
            return '<div class="cta-producto' + (oculto ? ' oculto' : '') + '">' +
                '<div class="cta-producto-info">' +
                    '<div class="cta-producto-nombre">' + tpEsc(p.product_name) + '</div>' +
                    '<div class="cta-producto-meta">' + tpEsc(p.category_name || 'Sin categoría') + ' · ' + tpDinero(p.price) +
                        (Number(p.current_stock) <= 0 && p.tracking_type && p.tracking_type !== 'none' ? ' · agotado' : '') + '</div>' +
                '</div>' +
                '<button type="button" class="cta-interruptor' + (oculto ? '' : ' activo') + '" data-producto-carta="' + p.product_id + '">' +
                    (oculto ? 'No se ve' : 'Se ve') + '</button>' +
                '</div>';
        }).join('');
}

/**
 * Oculta/muestra UN producto en la carta abierta.
 *
 * Se manda la lista COMPLETA de ajustes (la API reemplaza los menu_items del menú), pero se
 * conservan los renglones que no son de producto (categorías, etiquetas): si no, un ajuste
 * hecho antes se perdería al tocar un interruptor.
 */
async function ctaAlternarProducto(productId) {
    if (!ctaEstado.carta) return;
    const id = Number(productId);
    const oculto = ctaEstaOculto(id);
    const conservar = ctaEstado.items.filter(function (it) {
        return !(it.kind === 'product' && Number(it.product_id) === id);
    });
    const nuevo = conservar.slice();
    if (!oculto) nuevo.push({ kind: 'product', product_id: id, is_hidden: 1 });
    try {
        const d = await tpPeticion(TP_API_MENUS, {
            method: 'PUT',
            body: JSON.stringify({ menu_id: Number(ctaEstado.carta.menu_id), items: nuevo }),
        });
        ctaEstado.carta = d;
        ctaEstado.items = Array.isArray(d.items) ? d.items.slice() : nuevo;
        ctaPintarProductos();
        tpAviso(oculto ? 'Vuelve a salir en la carta' : 'Oculto en la carta del cliente', 'success');
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    }
}

// ── La carta de cada punto (chips del modal del punto) ───────────────────────
/**
 * Chips de "¿qué carta abre el QR de este punto?": la de la tienda (0) o una concreta.
 * Solo se ofrecen las ACTIVAS: elegir una carta apagada dejaría el QR sin carta útil.
 */
async function tpPintarChipsCarta(seleccionado) {
    const cont = document.getElementById('tpPuntoCarta');
    if (!cont) return;
    tpEstado.cartaElegida = Number(seleccionado) || 0;
    let cartas = [];
    try { cartas = await ctaTraerCartas(); } catch (e) { cartas = []; }
    const activas = cartas.filter(function (c) { return Number(c.is_active) === 1; });
    let html = '<button type="button" class="tp-chip' + (tpEstado.cartaElegida === 0 ? ' activo' : '') + '" data-carta="0">' +
        '<i class="fas fa-store"></i> La de la tienda</button>';
    activas.forEach(function (c) {
        html += '<button type="button" class="tp-chip' + (Number(tpEstado.cartaElegida) === Number(c.menu_id) ? ' activo' : '') +
            '" data-carta="' + c.menu_id + '"><i class="fas fa-book-open"></i> ' + tpEsc(c.name) + '</button>';
    });
    cont.innerHTML = html;

    const ayuda = document.getElementById('tpPuntoCartaAyuda');
    if (ayuda) {
        const carta = activas.find(function (c) { return Number(c.menu_id) === Number(tpEstado.cartaElegida); }) || activas[0] || null;
        if (!carta) {
            ayuda.innerHTML = '<i class="fas fa-triangle-exclamation"></i> No hay ninguna carta activa: el QR de este punto no llevará a ninguna parte hasta que actives una en la pestaña Carta.';
        } else if (!ctaAdmitePedido(carta.mode)) {
            ayuda.innerHTML = '<i class="fas fa-triangle-exclamation"></i> «' + tpEsc(carta.name) + '» es de <strong>solo consulta</strong>: el cliente no podrá pedir desde su teléfono. Cámbialo en la pestaña Carta.';
        } else {
            ayuda.innerHTML = '«' + tpEsc(carta.name) + '»: ' + tpEsc(CTA_ETIQUETA_MODO[carta.mode] || carta.mode) +
                (carta.mode === 'open_tab' ? '. Primero abre la cuenta del punto (o el cliente pide y el personal la abre).' : '.');
        }
    }
}

// ============================================================
// ACTIVAR: la tableta del mesero autoriza a los dispositivos
// ============================================================
/**
 * El comensal pide permiso desde su teléfono y aparece aquí. El mesero teclea los DOS NÚMEROS
 * que le dicen (o escanea el QR del comensal, que abre esta vista con el número puesto).
 *
 * Se refresca cada 5 s mientras la vista está abierta: el aviso de "hay alguien esperando" tiene
 * que llegar solo, y el WebSocket de la tienda no reparte los canales de cada cuenta.
 */
const TP_API_ACTIVACIONES = '../api/dining/activaciones.php';

const actEstado = { dispositivos: [], resumen: null, temporizador: null, enviando: false };

async function actCargar(silencioso) {
    const cont = document.getElementById('actLista');
    if (!cont) return;
    if (!silencioso && !actEstado.dispositivos.length) {
        cont.innerHTML = '<div class="tp-vacio"><i class="fas fa-spinner fa-spin"></i><p>Buscando dispositivos…</p></div>';
    }
    try {
        const d = await tpPeticion(TP_API_ACTIVACIONES);
        actEstado.dispositivos = d.dispositivos || [];
        actEstado.resumen = d.resumen || null;
    } catch (e) {
        if (!silencioso) {
            cont.innerHTML = '<div class="tp-vacio"><i class="fas fa-triangle-exclamation"></i><h3>No se pudieron leer las activaciones</h3><p>' + tpEsc(tpMensajeDeError(e)) + '</p></div>';
        }
        return;
    }
    actPintar();
}

function actPintar() {
    const insignia = document.getElementById('tpVistaActivarN');
    const esperando = (actEstado.resumen || {}).esperando || 0;
    if (insignia) {
        insignia.textContent = esperando;
        insignia.classList.toggle('hidden', esperando === 0);
    }

    const cont = document.getElementById('actLista');
    if (!cont) return;
    if (!actEstado.dispositivos.length) {
        cont.innerHTML = '<div class="tp-vacio"><i class="fas fa-user-check"></i>' +
            '<h3>Nadie está pidiendo permiso</h3>' +
            '<p>Cuando un cliente toque «Listo para pedir» en su teléfono, aparecerá aquí con sus dos números.</p></div>';
        return;
    }

    // Agrupados por punto: el mesero ve la mesa primero y luego quién está en ella.
    const grupos = {};
    actEstado.dispositivos.forEach(function (d) {
        const clave = String(d.table_id || 0) + '|' + d.punto;
        (grupos[clave] = grupos[clave] || []).push(d);
    });

    cont.innerHTML = Object.keys(grupos).map(function (clave) {
        const ds = grupos[clave];
        const primera = ds[0];
        const enEspera = ds.filter(function (d) { return d.estado === 'pendiente'; }).length;
        const activos = ds.filter(function (d) { return d.estado === 'activo'; }).length;
        const resumen = [];
        if (enEspera) resumen.push(enEspera + ' esperando');
        if (activos) resumen.push(activos + ' pueden pedir');
        return '<div class="tp-card" style="margin-bottom:14px">' +
            '<div class="tp-card-top">' +
                '<div><h3 class="tp-nombre">' + tpEsc(primera.punto) + '</h3>' +
                '<p class="tp-zona">Cuenta ' + tpEsc(primera.cuenta) + ' · ' + tpEsc(resumen.join(' · ') || 'sin dispositivos') + '</p></div>' +
                (primera.table_id ? '<button type="button" class="tp-btn" data-act-reiniciar="' + primera.table_id + '" title="Echa a TODOS los dispositivos de esta cuenta sin cerrarla"><i class="fas fa-rotate-left"></i> Reiniciar mesa</button>' : '') +
            '</div>' +
            '<div style="margin-top:10px">' + ds.map(actDispositivo).join('') + '</div>' +
            '</div>';
    }).join('');
}

/** Un renglón por dispositivo: sus números (o su estado) y las acciones del mesero. */
function actDispositivo(d) {
    const pendiente = d.estado === 'pendiente';
    const rechazado = d.estado === 'rechazado';
    const sinSenal = (d.sin_latir_min !== null && d.sin_latir_min >= 10)
        ? ' · sin señal hace ' + d.sin_latir_min + ' min' : '';

    let meta;
    if (pendiente) meta = 'Esperando hace ' + d.esperando_min + ' min' + sinSenal;
    else if (rechazado) meta = 'Rechazado';
    else meta = 'Ya puede pedir' + (d.esperando_min ? ' · se unió hace ' + d.esperando_min + ' min' : '');

    let acciones = '';
    if (pendiente) {
        acciones = '<button type="button" class="tp-accion primario" data-act-activar="' + d.participant_id + '">' +
                '<i class="fas fa-user-check"></i> Activar</button>' +
            '<button type="button" class="tp-accion" data-act-rechazar="' + d.participant_id + '">' +
                '<i class="fas fa-ban"></i> Rechazar</button>';
    } else {
        acciones = '<button type="button" class="tp-accion peligro" data-act-expulsar="' + d.participant_id + '">' +
            '<i class="fas fa-right-from-bracket"></i> Expulsar</button>';
    }

    return '<div class="act-dispositivo' + (pendiente ? ' pendiente' : '') + '">' +
        '<div class="act-par">' + (pendiente && d.codigo ? tpEsc(d.codigo) : (rechazado ? '--' : 'sí')) + '</div>' +
        '<div class="act-info">' +
            '<div class="act-nombre">' + (d.display_name ? tpEsc(d.display_name) : 'Dispositivo del cliente') + '</div>' +
            '<div class="act-meta">' + tpEsc(meta) + '</div>' +
        '</div>' +
        '<div class="act-acciones">' + acciones + '</div>' +
        '</div>';
}

function actError(msg) {
    const caja = document.getElementById('actError');
    if (!caja) return;
    caja.textContent = msg || '';
    caja.classList.toggle('hidden', !msg);
}

async function actAccion(cuerpo, exito) {
    if (actEstado.enviando) return;
    actEstado.enviando = true;
    actError('');
    try {
        const d = await tpPeticion(TP_API_SESSION, { method: 'POST', body: JSON.stringify(cuerpo) });
        tpAviso(typeof exito === 'function' ? exito(d) : (d && d.mensaje) || 'Listo', 'success');
        const campo = document.getElementById('actCodigo');
        if (campo && cuerpo.action === 'activar') campo.value = '';
        await actCargar(true);
    } catch (e) {
        actError(tpMensajeDeError(e));
        tpAviso(tpMensajeDeError(e), 'error');
    } finally { actEstado.enviando = false; }
}

/** Vigila mientras la vista está a la vista (no se deja un temporizador corriendo de fondo). */
function actVigilar(activo) {
    if (actEstado.temporizador) {
        clearInterval(actEstado.temporizador);
        actEstado.temporizador = null;
    }
    if (!activo) return;
    actEstado.temporizador = setInterval(function () {
        const panel = document.querySelector('[data-vista-panel="activar"]');
        if (!panel || panel.classList.contains('hidden')) return;
        actCargar(true);
    }, 5000);
}

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
            // Si hay una cuenta a la vista, también se refresca: el comensal pudo pedir o
            // alguien pudo cerrarla desde otro dispositivo.
            const d = tpEstado.cuentaActual;
            if (d && tpCuentaVisible()) tpCargarCuenta(d.session.session_id);

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
