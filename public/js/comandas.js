/**
 * Comandas — la pantalla de la estación (cocina, barra, plancha...).
 *
 * Es la otra cara del módulo del piso: la pestaña "Comandas" de `tables.html`. La cocina
 * abre esta pantalla en una tableta —con `?vista=comandas&estacion=N`— y desde ahí mueve
 * la ronda: Por preparar -> Preparando -> Listas para servir.
 *
 * TRES DECISIONES DE ESTA PANTALLA
 *
 * 1. Se usa DE PIE y con prisa: botones de 48 px, nada que dependa de `hover` y el avance
 *    en el mismo borde donde está el dedo. El estado se mueve tocando la comanda, no
 *    entrando a un detalle y volviendo.
 * 2. Tiempo real de verdad, con respaldo: WebSocket al canal de la tienda (el mismo que el
 *    mapa del salón) y, si el socket no está, sondeo. La tira "en vivo" dice la verdad: si
 *    no hay socket, no finge que sí.
 * 3. Aviso sonoro OPCIONAL y a propósito: el navegador no deja sonar sin un gesto del
 *    usuario, así que se enciende con el botón. Un aviso que no suena porque el navegador
 *    lo bloqueó en silencio sería peor que no ofrecerlo: aquí se dice que está apagado.
 *
 * Las estaciones (dónde se prepara cada cosa y cómo sale la comanda) se administran en un
 * SOLO modal que cambia de contenido. Nunca un modal encima de otro.
 */

const KD_API = '../api/dining/comandas.php';
const KD_API_ESTACIONES = '../api/dining/stations.php';
const KD_API_PRODUCTOS = '../api/inventory/products.php';

/** Minutos a partir de los cuales una comanda se marca como urgente. */
const KD_MINUTOS_TARDE = 12;

const kdEstado = {
    comandas: [],
    estaciones: [],
    sinEstacion: 0,
    conteos: {},
    filtro: 0,                 // 0 = todas las estaciones
    historicas: false,
    sonido: false,
    sonando: null,
    cargando: false,
    conocidas: null,           // ids ya pintados (para saber qué es NUEVO)
    nuevas: {},
    tiempoReal: null,
    conectado: false,
    sondeo: null,
    audio: null,
    anulando: null,            // comanda que se está anulando
    estacionEditando: null,    // estación en el formulario
    estacionProductos: null,   // estación cuyo catálogo se está repartiendo
    catalogo: null,
    vista: 'salon',
};

// ============================================================
// Utilidades locales
// ============================================================
function kd$(id) { return document.getElementById(id); }

function kdEtiquetaEstado(estado) {
    const mapa = {
        sent: 'por preparar', preparing: 'preparando', ready: 'lista',
        served: 'entregada', cancelled: 'anulada',
        dispatched: 'en camino', delivered: 'entregada',
    };
    return mapa[estado] || estado;
}

function kdEtiquetaCanal(canal) {
    const mapa = {
        service_point: 'Punto de servicio', counter: 'Mostrador', phone: 'Teléfono',
        own_delivery: 'Reparto propio', delivery_uber: 'Uber Eats',
        delivery_didi: 'DiDi Food', delivery_rappi: 'Rappi',
        other: 'Otro', system: 'Sistema',
    };
    return mapa[canal] || 'Pedido';
}

/** El tono de aviso. Se arma al vuelo: no hay archivo de audio que se pueda no cargar. */
function kdTono() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!kdEstado.audio) kdEstado.audio = new Ctx();
        const ctx = kdEstado.audio;
        if (ctx.state === 'suspended') ctx.resume();
        const t = ctx.currentTime;
        [0, 0.2].forEach(function (desfase, i) {
            const osc = ctx.createOscillator();
            const gan = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = i === 0 ? 880 : 1245;
            gan.gain.setValueAtTime(0.0001, t + desfase);
            gan.gain.exponentialRampToValueAtTime(0.28, t + desfase + 0.02);
            gan.gain.exponentialRampToValueAtTime(0.0001, t + desfase + 0.17);
            osc.connect(gan);
            gan.connect(ctx.destination);
            osc.start(t + desfase);
            osc.stop(t + desfase + 0.2);
        });
    } catch (e) {
        // Sin audio se sigue trabajando: el aviso visual queda.
    }
}

// ============================================================
// Pestañas: salón y comandas
// ============================================================
function kdPonerVista(nombre, guardar) {
    kdEstado.vista = nombre === 'comandas' ? 'comandas' : 'salon';

    document.querySelectorAll('.tp-vista').forEach(function (b) {
        b.classList.toggle('activo', b.getAttribute('data-vista') === kdEstado.vista);
    });
    document.querySelectorAll('[data-vista-panel]').forEach(function (p) {
        p.classList.toggle('hidden', p.getAttribute('data-vista-panel') !== kdEstado.vista);
    });

    if (kdEstado.vista === 'comandas') {
        kdCargar(true);
    }

    // El estado vive en la URL para que la tableta de la cocina se abra directo:
    // tables.html?vista=comandas&estacion=2
    if (guardar && window.history && history.replaceState) {
        const url = new URL(window.location.href);
        if (kdEstado.vista === 'salon') {
            url.searchParams.delete('vista');
        } else {
            url.searchParams.set('vista', 'comandas');
        }
        history.replaceState(null, '', url.toString());
    }
}

// ============================================================
// Carga y pintado
// ============================================================
async function kdCargar(silencioso) {
    if (kdEstado.cargando) return;
    kdEstado.cargando = true;
    try {
        const url = KD_API
            + '?estacion=' + encodeURIComponent(kdEstado.filtro || 0)
            + (kdEstado.historicas ? '&historicas=1' : '');
        const datos = await tpPeticion(url);
        kdEstado.comandas = (datos && datos.comandas) || [];
        kdEstado.estaciones = (datos && datos.estaciones) || [];
        kdEstado.sinEstacion = (datos && datos.sin_estacion) || 0;
        kdEstado.conteos = (datos && datos.conteos) || {};
        kdPintar();
    } catch (e) {
        if (!silencioso) tpAviso(tpMensajeDeError(e), 'error');
        kdMarcarVivo('sin-conexion');
    } finally {
        kdEstado.cargando = false;
    }
}

function kdPintar() {
    kdPintarFiltros();

    const porEstado = { sent: [], preparing: [], ready: [] };
    const historicas = [];

    kdEstado.comandas.forEach(function (c) {
        if (porEstado[c.status]) {
            porEstado[c.status].push(c);
        } else if (c.status === 'served' || c.status === 'cancelled' || c.status === 'delivered' || c.status === 'dispatched') {
            historicas.push(c);
        }
    });

    // Lo NUEVO se detecta comparando con lo que ya estaba pintado: solo así se puede avisar
    // de que entró una comanda sin avisar de todo lo que ya había.
    const idsAhora = {};
    kdEstado.comandas.forEach(function (c) { idsAhora[c.comanda_id] = true; });

    const primeras = kdEstado.conocidas === null;
    let nuevas = 0;
    if (!primeras) {
        Object.keys(idsAhora).forEach(function (id) {
            if (!kdEstado.conocidas[id]) {
                kdEstado.nuevas[id] = Date.now();
                nuevas++;
            }
        });
        if (nuevas > 0 && kdEstado.sonido) kdTono();
    }
    kdEstado.conocidas = idsAhora;

    ['sent', 'preparing', 'ready'].forEach(function (estado) {
        const cont = kd$('kdLista' + estado.charAt(0).toUpperCase() + estado.slice(1));
        const n = kd$('kdN_' + estado);
        if (n) n.textContent = porEstado[estado].length;
        if (!cont) return;

        if (!porEstado[estado].length) {
            cont.innerHTML = '<div class="kd-vacio">' + kdVacioDe(estado) + '</div>';
            return;
        }
        cont.innerHTML = porEstado[estado].map(kdCardHTML).join('');
    });

    const activas = porEstado.sent.length + porEstado.preparing.length + porEstado.ready.length;
    const insignia = kd$('tpVistaComandasN');
    if (insignia) {
        insignia.textContent = activas;
        insignia.classList.toggle('hidden', activas === 0);
    }

    kdPintarHistorico(historicas);
}

function kdVacioDe(estado) {
    if (estado === 'sent') return 'Nada esperando. Todo lo que entró ya se está preparando.';
    if (estado === 'preparing') return 'Nadie está preparando nada ahora mismo.';
    return 'Nada listo por entregar.';
}

function kdCardHTML(c) {
    const minutos = Number(c.minutos || 0);
    const tarde = minutos >= KD_MINUTOS_TARDE && c.status !== 'ready';
    const esNueva = kdEstado.nuevas[c.comanda_id] && (Date.now() - kdEstado.nuevas[c.comanda_id] < 9000);

    // Dónde va: punto de servicio, o el canal cuando no es de un punto (mostrador, reparto).
    const donde = c.punto || kdEtiquetaCanal(c.channel);
    const quien = [];
    if (c.code) quien.push('Cuenta ' + c.code);
    if (c.personas) quien.push(c.personas);
    if (c.created_by_type === 'staff') quien.push('Anotado por el personal');

    const items = (c.items || []).map(function (it) {
        return '<li class="kd-item">' +
            '<span class="kd-item-cant">' + tpCantidad(it.quantity) + '&times;</span>' +
            '<span class="kd-item-info">' + tpEsc(it.product_name) +
                (it.notes ? '<br><span class="kd-nota"><i class="fas fa-pen"></i> ' + tpEsc(it.notes) + '</span>' : '') +
            '</span>' +
        '</li>';
    }).join('');

    // El avance es UN botón que dice el siguiente paso: no hay que elegir nada.
    const avance = {
        sent: { accion: 'start', texto: 'Empezar', icono: 'fa-fire-burner' },
        preparing: { accion: 'ready', texto: 'Lista', icono: 'fa-bell-concierge' },
        ready: { accion: 'served', texto: 'Entregar', icono: 'fa-circle-check' },
    }[c.status];

    return '<article class="kd-card' + (esNueva ? ' nueva' : '') + '" data-comanda="' + c.comanda_id + '">' +
        '<div class="kd-card-cab">' +
            '<span class="kd-folio">#' + c.folio + '</span>' +
            '<span class="kd-min' + (tarde ? ' tarde' : '') + '">' +
                '<i class="fas fa-clock"></i> ' + minutos + ' min' +
                (tarde ? ' · se está tardando' : '') +
            '</span>' +
        '</div>' +
        '<div>' +
            '<div class="kd-donde">' + tpEsc(donde) +
                (c.station_name ? ' · ' + tpEsc(c.station_name) : '') + '</div>' +
            (quien.length ? '<div class="kd-quien">' + tpEsc(quien.join(' · ')) + '</div>' : '') +
        '</div>' +
        '<ul class="kd-items">' + items + '</ul>' +
        '<div class="kd-pie">' +
            (avance
                ? '<button type="button" class="kd-btn primario" data-kd-avanzar="' + avance.accion + '" data-kd-comanda="' + c.comanda_id + '">' +
                    '<i class="fas ' + avance.icono + '"></i> ' + avance.texto + '</button>'
                : '') +
            '<button type="button" class="kd-btn icono" data-kd-imprimir="' + c.comanda_id + '" title="Imprimir el ticket (el navegador pedirá confirmación)"><i class="fas fa-print"></i></button>' +
            '<button type="button" class="kd-btn icono" data-kd-anular="' + c.comanda_id + '" title="Anular la comanda"><i class="fas fa-ban"></i></button>' +
        '</div>' +
    '</article>';
}

function kdPintarFiltros() {
    const cont = kd$('kdFiltros');
    if (!cont) return;

    let html = '<button type="button" class="kd-chip' + (kdEstado.filtro === 0 ? ' activo' : '') + '" data-kd-filtro="0">Todas</button>';
    kdEstado.estaciones.forEach(function (e) {
        const activo = String(kdEstado.filtro) === String(e.station_id);
        html += '<button type="button" class="kd-chip' + (activo ? ' activo' : '') + '" data-kd-filtro="' + e.station_id + '">' +
            tpEsc(e.name) + '</button>';
    });
    // El montón: lo que no se prepara en ningún lado. Solo aparece si de verdad hay algo.
    const sinEstacionVivas = kdEstado.comandas.filter(function (c) { return !c.station_id; }).length;
    if (sinEstacionVivas > 0) {
        html += '<span class="kd-chip" style="cursor:default"><i class="fas fa-inbox"></i> Sin estación <span class="kd-chip-n">' + sinEstacionVivas + '</span></span>';
    }
    html += '<button type="button" class="kd-chip' + (kdEstado.historicas ? ' activo' : '') + '" data-kd-historicas="1">' +
        '<i class="fas fa-clock-rotate-left"></i> Entregadas</button>';

    cont.innerHTML = html;
}

function kdPintarHistorico(lista) {
    const cont = kd$('kdHistorico');
    if (!cont) return;

    if (!kdEstado.historicas) {
        cont.classList.add('hidden');
        cont.innerHTML = '';
        return;
    }
    cont.classList.remove('hidden');

    if (!lista.length) {
        cont.innerHTML = '<h3>Entregadas de hoy</h3><div class="tp-aviso">Todavía no se ha entregado ni anulado nada hoy.</div>';
        return;
    }

    cont.innerHTML = '<h3>Entregadas y anuladas de hoy</h3><div class="kd-hist-lista">' +
        lista.map(function (c) {
            const clase = c.status === 'cancelled' ? 'anulada' : 'servida';
            return '<div class="kd-hist-item ' + clase + '">' +
                '<strong>#' + c.folio + '</strong> · ' + tpEsc(kdEtiquetaEstado(c.status)) +
                '<br>' + tpEsc(c.punto || kdEtiquetaCanal(c.channel)) +
                (c.station_name ? ' · ' + tpEsc(c.station_name) : '') +
                '<br>' + (c.items || []).length + ' platillo(s)' +
                (c.cancel_reason ? '<br><em>' + tpEsc(c.cancel_reason) + '</em>' : '') +
            '</div>';
        }).join('') + '</div>';
}

// ============================================================
// Acciones del tablero
// ============================================================
async function kdAvanzar(comandaId, accion) {
    try {
        await tpPeticion(KD_API, {
            method: 'POST',
            body: JSON.stringify({ action: accion, comanda_id: Number(comandaId) }),
        });
        await kdCargar(true);
        if (window.tpCargar) tpCargar(true);   // el mapa del salón también cambió
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
        kdCargar(true);
    }
}

function kdAbrirAnular(comandaId) {
    const c = kdEstado.comandas.filter(function (x) { return String(x.comanda_id) === String(comandaId); })[0];
    kdEstado.anulando = comandaId;

    const aviso = kd$('kdAnularAviso');
    if (aviso) {
        aviso.innerHTML = c
            ? 'Comanda <strong>#' + c.folio + '</strong> de ' + tpEsc(c.punto || kdEtiquetaCanal(c.channel)) +
              '. Al anularla, sus platillos se cancelan en la cuenta y dejan de cobrarse. No se borra nada: queda el motivo escrito.'
            : 'Los platillos de esta comanda se cancelan en la cuenta. No se borra nada: queda el motivo escrito.';
    }
    const campo = kd$('kdAnularMotivo');
    if (campo) campo.value = '';
    tpAbrirModal('kdModalAnular');
    if (campo) setTimeout(function () { campo.focus(); }, 80);
}

async function kdConfirmarAnular() {
    const campo = kd$('kdAnularMotivo');
    const motivo = (campo && campo.value || '').trim();
    if (!motivo) {
        tpAviso('Escribe por qué se anula la comanda', 'error');
        if (campo) campo.focus();
        return;
    }
    const boton = kd$('kdAnularConfirmar');
    if (boton) boton.disabled = true;
    try {
        await tpPeticion(KD_API, {
            method: 'POST',
            body: JSON.stringify({ action: 'cancel', comanda_id: Number(kdEstado.anulando), reason: motivo }),
        });
        tpCerrarModal('kdModalAnular');
        tpAviso('Comanda anulada', 'success');
        await kdCargar(true);
        if (window.tpCargar) tpCargar(true);
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    } finally {
        if (boton) boton.disabled = false;
    }
}

/**
 * Imprime el ticket de la comanda.
 *
 * Honestidad técnica: la impresión es la del NAVEGADOR, así que pide confirmación salvo que
 * se abra en modo kiosco. Por eso la pantalla es la vía principal y esto es un extra; el
 * contador de impresiones se guarda para poder auditar cuántas veces salió.
 */
async function kdImprimir(comandaId) {
    const c = kdEstado.comandas.filter(function (x) { return String(x.comanda_id) === String(comandaId); })[0];
    if (!c) return;

    const lineas = (c.items || []).map(function (it) {
        return '<tr><td style="padding:4px 6px"><strong>' + tpCantidad(it.quantity) + '&times;</strong> ' + tpEsc(it.product_name) +
            (it.notes ? '<br><small>' + tpEsc(it.notes) + '</small>' : '') + '</td></tr>';
    }).join('');

    const win = window.open('', '_blank');
    if (!win) {
        tpAviso('El navegador bloqueó la ventana de impresión', 'error');
        return;
    }
    win.document.write('<html><head><title>Comanda #' + c.folio + '</title></head>' +
        '<body style="font-family:ui-monospace,Menlo,monospace;font-size:13px">' +
        '<h2 style="margin:0 0 4px">Comanda #' + c.folio + '</h2>' +
        '<p style="margin:0 0 2px">' + tpEsc(c.punto || kdEtiquetaCanal(c.channel)) + '</p>' +
        '<p style="margin:0 0 2px">' + (c.station_name ? tpEsc(c.station_name) + ' · ' : '') + tpEsc((c.sent_at || '').slice(0, 16)) + '</p>' +
        '<hr><table style="width:100%;border-collapse:collapse">' + lineas + '</table><hr>' +
        '<small>' + (c.personas ? 'Personas: ' + tpEsc(c.personas) : '') + '</small>' +
        '<script>window.onload=function(){window.print()}<\/script></body></html>');
    win.document.close();

    try {
        await tpPeticion(KD_API, {
            method: 'POST',
            body: JSON.stringify({ action: 'print', comanda_id: Number(comandaId) }),
        });
    } catch (e) {
        // Que no se pueda dejar el rastro no invalida el ticket que ya salió.
    }
}

// ============================================================
// Estaciones: UN modal que cambia de contenido
// ============================================================
async function kdAbrirEstaciones() {
    kdEstado.estacionEditando = null;
    kdEstado.estacionProductos = null;
    kd$('kdEstTitulo').textContent = 'Estaciones';
    kd$('kdEstCuerpo').innerHTML = '<div class="tp-vacio-mini"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>';
    kd$('kdEstPie').innerHTML = '';
    tpAbrirModal('kdModalEstaciones');
    await kdRefrescarEstaciones();
}

async function kdRefrescarEstaciones() {
    await kdTraerEstaciones();
    kdPintarEstaciones();
    kdPintarFiltros();
}

/**
 * Trae los datos de estaciones SIN repintar el modal.
 *
 * Hace falta porque el modal cambia de contenido: si al marcar un producto se repintara la
 * lista de estaciones, el panel de reparto desaparecería a media tarea (le pasó a la
 * primera versión, y se veía como que el clic "no hacía nada").
 */
async function kdTraerEstaciones() {
    try {
        const d = await tpPeticion(KD_API_ESTACIONES);
        kdEstado.estaciones = (d && d.estaciones) || [];
        kdEstado.sinEstacion = (d && d.sin_estacion) || 0;
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    }
}

function kdPintarEstaciones() {
    const cuerpo = kd$('kdEstCuerpo');
    const pie = kd$('kdEstPie');
    kd$('kdEstTitulo').textContent = 'Estaciones';

    const activas = kdEstado.estaciones.filter(function (e) { return e.is_active; });
    const lista = kdEstado.estaciones.map(function (e) {
        const salidas = (e.salidas || []).length
            ? e.salidas.map(function (s) {
                return '<span class="kd-salida"><i class="fas ' + (s.kind === 'print' ? 'fa-print' : 'fa-desktop') + '"></i> ' +
                    (s.kind === 'print' ? 'Impresora' : 'Pantalla') + (s.target ? ': ' + tpEsc(s.target) : '') + '</span>';
            }).join('')
            : '<span class="kd-salida sin"><i class="fas fa-ban"></i> Sin salida</span>';

        return '<div class="kd-est-card' + (e.is_active ? '' : ' apagada') + '">' +
            '<div class="kd-est-cab">' +
                '<span class="kd-est-nombre">' + tpEsc(e.name) + (e.is_active ? '' : ' (desactivada)') + '</span>' +
                '<span class="kd-est-meta">' + e.productos + ' producto(s)</span>' +
            '</div>' +
            '<div class="kd-est-meta">' + salidas + '</div>' +
            '<div class="kd-est-acciones">' +
                '<button type="button" class="tp-btn" data-kd-est="productos" data-id="' + e.station_id + '"><i class="fas fa-list-check"></i> Qué se prepara aquí</button>' +
                '<button type="button" class="tp-btn" data-kd-est="editar" data-id="' + e.station_id + '"><i class="fas fa-pen"></i> Editar</button>' +
                '<button type="button" class="tp-btn" data-kd-est="' + (e.is_active ? 'apagar' : 'encender') + '" data-id="' + e.station_id + '">' +
                    '<i class="fas fa-power-off"></i> ' + (e.is_active ? 'Desactivar' : 'Activar') + '</button>' +
                '<button type="button" class="tp-btn" data-kd-est="borrar" data-id="' + e.station_id + '"><i class="fas fa-trash"></i> Borrar</button>' +
            '</div>' +
        '</div>';
    }).join('');

    cuerpo.innerHTML =
        '<div class="tp-aviso">Una estación es dónde se prepara (Cocina, Barra, Plancha). Cada una decide cómo le llega la comanda: ' +
            'pantalla, impresora, las dos o ninguna. Un negocio que no prepara nada no necesita estaciones: sus pedidos viven en un solo montón.</div>' +
        (lista || '<div class="tp-vacio-mini">Todavía no hay estaciones. Crea la primera con el botón de abajo.</div>') +
        (kdEstado.sinEstacion > 0
            ? '<div class="tp-aviso">' + kdEstado.sinEstacion + ' producto(s) no están en ninguna estación: sus comandas caen en el montón general y las ve cualquiera que abra el tablero.</div>'
            : '') +
        '<p class="kd-est-meta">' + activas.length + ' activa(s) de ' + kdEstado.estaciones.length + '.</p>';

    pie.innerHTML = '<button type="button" class="tp-btn" data-cerrar="kdModalEstaciones">Cerrar</button>' +
        '<button type="button" class="tp-btn primario" data-kd-est="nueva"><i class="fas fa-plus"></i> Nueva estación</button>';
}

function kdFormEstacion(estacion) {
    kdEstado.estacionEditando = estacion || null;
    kd$('kdEstTitulo').textContent = estacion ? 'Editar estación' : 'Nueva estación';

    const salidas = (estacion && estacion.salidas) || [];
    const tienePantalla = salidas.some(function (s) { return s.kind === 'screen'; });
    const tieneImpresora = salidas.some(function (s) { return s.kind === 'print'; });
    const destinoPantalla = (salidas.filter(function (s) { return s.kind === 'screen'; })[0] || {}).target || '';
    const destinoImpresora = (salidas.filter(function (s) { return s.kind === 'print'; })[0] || {}).target || '';

    // Botones conmutables, nunca selects (regla del proyecto).
    const boton = function (tipo, activo, etiqueta, icono) {
        return '<button type="button" class="tp-btn' + (activo ? ' primario' : '') + '" data-kd-salida="' + tipo + '" data-activo="' + (activo ? '1' : '0') + '" style="flex:1 1 auto;justify-content:center">' +
            '<i class="fas ' + icono + '"></i> ' + etiqueta + '</button>';
    };

    kd$('kdEstCuerpo').innerHTML =
        '<div class="tp-campo">' +
            '<label for="kdEstNombre">¿Cómo se llama?</label>' +
            '<input type="text" id="kdEstNombre" maxlength="50" placeholder="Cocina, Barra, Plancha…" autocomplete="off" value="' +
                tpEsc(estacion ? estacion.name : '') + '">' +
        '</div>' +
        '<div class="tp-campo">' +
            '<label>¿Cómo sale la comanda de aquí?</label>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                boton('screen', tienePantalla, 'Pantalla', 'fa-desktop') +
                boton('print', tieneImpresora, 'Impresora', 'fa-print') +
            '</div>' +
            '<p class="kd-est-meta">Sin ninguna marcada, la comanda existe y se ve en el tablero, pero nadie la "imprime": es lo correcto para un negocio sin preparación.</p>' +
        '</div>' +
        '<div class="tp-campo" id="kdEstDestinoPantallaW" style="' + (tienePantalla ? '' : 'display:none') + '">' +
            '<label for="kdEstDestinoPantalla">Nombre del dispositivo de la pantalla (opcional)</label>' +
            '<input type="text" id="kdEstDestinoPantalla" maxlength="120" placeholder="Tableta de la cocina" autocomplete="off" value="' + tpEsc(destinoPantalla) + '">' +
        '</div>' +
        '<div class="tp-campo" id="kdEstDestinoImpresoraW" style="' + (tieneImpresora ? '' : 'display:none') + '">' +
            '<label for="kdEstDestinoImpresora">Nombre de la impresora (opcional)</label>' +
            '<input type="text" id="kdEstDestinoImpresora" maxlength="120" placeholder="Impresora de cocina" autocomplete="off" value="' + tpEsc(destinoImpresora) + '">' +
        '</div>';

    kd$('kdEstPie').innerHTML =
        '<button type="button" class="tp-btn" data-kd-est="volver">Volver</button>' +
        '<button type="button" class="tp-btn primario" data-kd-est="guardar"><i class="fas fa-check"></i> Guardar</button>';
}

async function kdGuardarEstacion() {
    const nombre = (kd$('kdEstNombre').value || '').trim();
    if (!nombre) {
        tpAviso('Escribe el nombre de la estación', 'error');
        return;
    }

    const salidas = [];
    const pantalla = document.querySelector('[data-kd-salida="screen"][data-activo="1"]');
    const impresora = document.querySelector('[data-kd-salida="print"][data-activo="1"]');
    if (pantalla) {
        salidas.push({ kind: 'screen', target: (kd$('kdEstDestinoPantalla').value || '').trim() });
    }
    if (impresora) {
        salidas.push({ kind: 'print', target: (kd$('kdEstDestinoImpresora').value || '').trim() });
    }

    const cuerpo = {
        action: 'guardar',
        name: nombre,
        salidas: salidas,
    };
    if (kdEstado.estacionEditando) cuerpo.station_id = kdEstado.estacionEditando.station_id;

    try {
        await tpPeticion(KD_API_ESTACIONES, { method: 'POST', body: JSON.stringify(cuerpo) });
        tpAviso('Estación guardada', 'success');
        kdEstado.estacionEditando = null;
        await kdRefrescarEstaciones();
        await kdCargar(true);
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    }
}

async function kdAccionEstacion(accion, stationId) {
    const est = kdEstado.estaciones.filter(function (e) { return String(e.station_id) === String(stationId); })[0];

    if (accion === 'nueva') return kdFormEstacion(null);
    if (accion === 'volver') return kdPintarEstaciones();
    if (accion === 'editar') return kdFormEstacion(est || null);
    if (accion === 'guardar') return kdGuardarEstacion();
    if (accion === 'productos') return kdPanelProductos(est);

    try {
        if (accion === 'apagar' || accion === 'encender') {
            await tpPeticion(KD_API_ESTACIONES, {
                method: 'POST',
                body: JSON.stringify({ action: 'activar', station_id: Number(stationId), is_active: accion === 'encender' }),
            });
            tpAviso(accion === 'encender' ? 'Estación activada' : 'Estación desactivada', 'success');
        } else if (accion === 'borrar') {
            await tpPeticion(KD_API_ESTACIONES, {
                method: 'POST',
                body: JSON.stringify({ action: 'borrar', station_id: Number(stationId) }),
            });
            tpAviso('Estación borrada', 'success');
        }
        await kdRefrescarEstaciones();
        await kdCargar(true);
    } catch (e) {
        // "Ya tiene comandas: se apaga, no se borra" llega aquí tal cual.
        tpAviso(tpMensajeDeError(e), 'error');
    }
}

/** Reparto del catálogo: un clic mete un producto a la estación, otro clic lo saca. */
async function kdPanelProductos(estacion) {
    if (!estacion) return;
    kdEstado.estacionProductos = estacion;
    kd$('kdEstTitulo').textContent = 'Qué se prepara en ' + estacion.name;

    // El catálogo se vuelve a leer cada vez que se abre el panel: el reparto anterior pudo
    // mover productos a otra estación y una lista cacheada mostraría casillas que ya no son
    // verdad. Es una consulta barata y aquí la exactitud importa más.
    kdEstado.catalogo = null;
    try {
        const prods = await tpPeticion(KD_API_PRODUCTOS + '?context=pos');
        kdEstado.catalogo = (Array.isArray(prods) ? prods : []).filter(function (p) {
            return Number(p.is_ingredient) !== 1;
        });
    } catch (e) {
        kdEstado.catalogo = [];
    }

    kdPintarProductos();
    kd$('kdEstPie').innerHTML = '<button type="button" class="tp-btn" data-kd-est="volver">Volver a las estaciones</button>';
}

function kdPintarProductos() {
    const est = kdEstado.estacionProductos;
    if (!est) return;
    const cuerpo = kd$('kdEstCuerpo');

    const lista = kdEstado.catalogo.map(function (p) {
        const dentro = String(p.station_id || '') === String(est.station_id);
        return '<button type="button" class="kd-prod' + (dentro ? ' dentro' : '') + '" data-kd-prod="' + p.product_id + '">' +
            '<span class="kd-prod-marca"><i class="fas ' + (dentro ? 'fa-square-check' : 'fa-square') + '"></i></span>' +
            '<span class="kd-prod-info">' +
                '<span class="kd-prod-nombre">' + tpEsc(p.product_name) + '</span>' +
                '<span class="kd-prod-meta">' + tpDinero(p.price) + (p.category_name ? ' · ' + tpEsc(p.category_name) : '') + '</span>' +
            '</span>' +
        '</button>';
    }).join('');

    cuerpo.innerHTML =
        '<div class="tp-aviso">Lo que marques aquí se prepara en <strong>' + tpEsc(est.name) + '</strong>. ' +
            'El producto guarda UNA estación: al marcarlo en esta, deja la que tuviera. Sin marcar, va al montón general.</div>' +
        '<div class="tp-menu-buscador"><i class="fas fa-search"></i>' +
            '<input type="text" id="kdProdBuscar" placeholder="Buscar producto…" autocomplete="off"></div>' +
        '<div class="kd-lista-mini" id="kdProdLista">' + (lista || '<div class="tp-vacio-mini">Esta tienda no tiene productos vendibles todavía.</div>') + '</div>';
}

async function kdAlternarProducto(productId) {
    const est = kdEstado.estacionProductos;
    if (!est) return;
    const producto = kdEstado.catalogo.filter(function (p) { return String(p.product_id) === String(productId); })[0];
    if (!producto) return;

    const dentro = String(producto.station_id || '') === String(est.station_id);
    const cuerpo = { action: 'asignar', station_id: est.station_id };
    if (dentro) cuerpo.quitar_ids = [Number(productId)];
    else cuerpo.product_ids = [Number(productId)];

    try {
        await tpPeticion(KD_API_ESTACIONES, { method: 'POST', body: JSON.stringify(cuerpo) });
        // Se actualiza en memoria para que el siguiente clic sepa el estado real.
        producto.station_id = dentro ? null : Number(est.station_id);

        const campo = kd$('kdProdBuscar');
        const filtro = (campo && campo.value || '').toLowerCase();
        kdPintarProductos();
        if (filtro) {
            const nuevo = kd$('kdProdBuscar');
            nuevo.value = filtro;
            kdFiltrarProductos(filtro);
            nuevo.focus();
        }

        // Los datos de estaciones se refrescan SIN repintar: el panel de reparto sigue abierto.
        await kdTraerEstaciones();
        kdEstado.estacionProductos = kdEstado.estaciones.filter(function (e) {
            return String(e.station_id) === String(est.station_id);
        })[0] || est;
        kd$('kdEstTitulo').textContent = 'Qué se prepara en ' + kdEstado.estacionProductos.name;
        kd$('kdEstPie').innerHTML = '<button type="button" class="tp-btn" data-kd-est="volver">Volver a las estaciones</button>';
        kdPintarFiltros();
    } catch (e) {
        tpAviso(tpMensajeDeError(e), 'error');
    }
}

function kdFiltrarProductos(q) {
    const cont = kd$('kdProdLista');
    if (!cont) return;
    const est = kdEstado.estacionProductos;
    const lista = kdEstado.catalogo.filter(function (p) {
        return !q || String(p.product_name).toLowerCase().indexOf(q) !== -1;
    });
    if (!lista.length) {
        cont.innerHTML = '<div class="tp-vacio-mini">Nada que coincida.</div>';
        return;
    }
    cont.innerHTML = lista.map(function (p) {
        const dentro = String(p.station_id || '') === String(est.station_id);
        return '<button type="button" class="kd-prod' + (dentro ? ' dentro' : '') + '" data-kd-prod="' + p.product_id + '">' +
            '<span class="kd-prod-marca"><i class="fas ' + (dentro ? 'fa-square-check' : 'fa-square') + '"></i></span>' +
            '<span class="kd-prod-info">' +
                '<span class="kd-prod-nombre">' + tpEsc(p.product_name) + '</span>' +
                '<span class="kd-prod-meta">' + tpDinero(p.price) + (p.category_name ? ' · ' + tpEsc(p.category_name) : '') + '</span>' +
            '</span>' +
        '</button>';
    }).join('');
}

// ============================================================
// Tiempo real
// ============================================================
/**
 * Se engancha al tiempo real que YA abrió el mapa del salón.
 *
 * Un solo WebSocket por página: `tables.js` se suscribe al canal de la tienda y reemite
 * cada aviso como evento del documento. Abrir aquí un segundo socket sería duplicar el
 * aviso (y el trabajo del relay) para ver exactamente lo mismo.
 *
 * Respaldo de sondeo: si el socket está caído (o esta página no tiene tiempo real), el
 * tablero se refresca cada 20 s. La pantalla de una cocina no se puede quedar muda.
 */
function kdEscucharTiempoReal() {
    document.addEventListener('tomodachi:realtime', function () {
        // El tablero se refresca aunque estés en el salón: la insignia de la pestaña tiene
        // que decir la verdad cuando alguien mira si hay trabajo pendiente.
        kdCargar(true);
    });

    document.addEventListener('tomodachi:realtime-estado', function (ev) {
        const estado = ev.detail;
        kdMarcarVivo(estado);
        kdEstado.conectado = (estado === 'conectado');
        if (kdEstado.conectado) kdDetenerSondeo();
        else kdIniciarSondeo();
    });

    // Si nadie avisa del estado, en esta página no hay tiempo real: se sondea y se dice.
    setTimeout(function () {
        if (!kdEstado.conectado) {
            kdMarcarVivo('sin-tiempo-real');
            kdIniciarSondeo();
        }
    }, 3000);
}

function kdIniciarSondeo() {
    if (kdEstado.sondeo) return;
    kdEstado.sondeo = setInterval(function () {
        if (!document.hidden) kdCargar(true);
    }, 20000);
}

function kdDetenerSondeo() {
    if (kdEstado.sondeo) {
        clearInterval(kdEstado.sondeo);
        kdEstado.sondeo = null;
    }
}

function kdMarcarVivo(estado) {
    const etiquetas = {
        'conectado': 'en vivo',
        'reconectando': 'reconectando…',
        'sin-conexion': 'sin conexión',
        'sin-autorizacion': 'sin autorización',
        'sin-tiempo-real': 'sin tiempo real',
        'detenido': 'detenido',
    };
    const conocido = Object.prototype.hasOwnProperty.call(etiquetas, estado);
    const texto = conocido ? etiquetas[estado] : 'sin tiempo real';
    const nodo = kd$('kdVivo');
    if (!nodo) return;
    nodo.classList.toggle('desconectado', !conocido || estado !== 'conectado');
    nodo.classList.toggle('conectando', estado === 'reconectando');
    const span = nodo.querySelector('span');
    if (span) span.textContent = texto;
}

// ============================================================
// Enlaces de eventos
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    kdEscucharTiempoReal();

    // Pestañas
    const vistas = kd$('tpVistas');
    if (vistas) {
        vistas.addEventListener('click', function (ev) {
            const b = ev.target.closest('[data-vista]');
            if (b) kdPonerVista(b.getAttribute('data-vista'), true);
        });
    }

    // Tablero
    const columnas = kd$('kdColumnas');
    if (columnas) {
        columnas.addEventListener('click', function (ev) {
            const avanzar = ev.target.closest('[data-kd-avanzar]');
            if (avanzar) {
                avanzar.disabled = true;
                kdAvanzar(avanzar.getAttribute('data-kd-comanda'), avanzar.getAttribute('data-kd-avanzar'));
                return;
            }
            const imprimir = ev.target.closest('[data-kd-imprimir]');
            if (imprimir) {
                kdImprimir(imprimir.getAttribute('data-kd-imprimir'));
                return;
            }
            const anular = ev.target.closest('[data-kd-anular]');
            if (anular) kdAbrirAnular(anular.getAttribute('data-kd-anular'));
        });
    }

    const filtros = kd$('kdFiltros');
    if (filtros) {
        filtros.addEventListener('click', function (ev) {
            const b = ev.target.closest('[data-kd-filtro]');
            if (b) {
                kdEstado.filtro = Number(b.getAttribute('data-kd-filtro')) || 0;
                kdEstado.conocidas = null;   // cambió lo que se ve: no avisar de todo como nuevo
                kdCargar(true);
                return;
            }
            const h = ev.target.closest('[data-kd-historicas]');
            if (h) {
                kdEstado.historicas = !kdEstado.historicas;
                kdCargar(true);
            }
        });
    }

    const btnHistoricas = kd$('kdBtnHistoricas');
    if (btnHistoricas) {
        btnHistoricas.addEventListener('click', function () {
            kdEstado.historicas = !kdEstado.historicas;
            this.className = 'tp-btn' + (kdEstado.historicas ? ' primario' : '');
            this.innerHTML = '<i class="fas fa-clock-rotate-left"></i> ' + (kdEstado.historicas ? 'Ocultar entregadas' : 'Ver entregadas');
            kdCargar(true);
        });
    }

    const btnEstaciones = kd$('kdBtnEstaciones');
    if (btnEstaciones) btnEstaciones.addEventListener('click', kdAbrirEstaciones);

    const btnSonido = kd$('kdBtnSonido');
    if (btnSonido) {
        btnSonido.addEventListener('click', function () {
            kdEstado.sonido = !kdEstado.sonido;
            this.setAttribute('aria-pressed', kdEstado.sonido ? 'true' : 'false');
            this.className = 'tp-btn' + (kdEstado.sonido ? ' primario' : '');
            this.innerHTML = '<i class="fas ' + (kdEstado.sonido ? 'fa-volume-high' : 'fa-volume-xmark') + '"></i> ' +
                '<span id="kdSonidoTexto">' + (kdEstado.sonido ? 'Con aviso sonoro' : 'Sin aviso sonoro') + '</span>';
            // El clic es el gesto que el navegador necesita para dejar sonar: suena ahora
            // para que se compruebe, no la primera vez que entre una comanda.
            if (kdEstado.sonido) kdTono();
        });
    }

    // UN manejador para todo el modal: los botones de cada estación viven en el cuerpo y
    // los de abajo en el pie. Escuchar solo el pie dejaba muertos los de arriba.
    const modalEst = kd$('kdModalEstaciones');
    if (modalEst) {
        modalEst.addEventListener('click', function (ev) {
            // Botones conmutables de salida (pantalla / impresora)
            const salida = ev.target.closest('[data-kd-salida]');
            if (salida) {
                const activo = salida.getAttribute('data-activo') === '1';
                salida.setAttribute('data-activo', activo ? '0' : '1');
                salida.className = 'tp-btn' + (activo ? '' : ' primario');
                const tipo = salida.getAttribute('data-kd-salida');
                const destino = kd$(tipo === 'print' ? 'kdEstDestinoImpresoraW' : 'kdEstDestinoPantallaW');
                if (destino) destino.style.display = activo ? 'none' : '';
                return;
            }
            // Reparto del catálogo: un clic mete el producto, otro lo saca.
            const prod = ev.target.closest('[data-kd-prod]');
            if (prod) {
                kdAlternarProducto(prod.getAttribute('data-kd-prod'));
                return;
            }
            // Acciones de una estación y navegación del panel.
            const accion = ev.target.closest('[data-kd-est]');
            if (accion) kdAccionEstacion(accion.getAttribute('data-kd-est'), accion.getAttribute('data-id'));
        });
    }

    const cuerpoEst = kd$('kdEstCuerpo');
    if (cuerpoEst) {
        cuerpoEst.addEventListener('input', function (ev) {
            if (ev.target && ev.target.id === 'kdProdBuscar') {
                kdFiltrarProductos(ev.target.value.trim().toLowerCase());
            }
        });
    }

    const anularBtn = kd$('kdAnularConfirmar');
    if (anularBtn) anularBtn.addEventListener('click', kdConfirmarAnular);

    // Vista inicial: la tableta de la cocina entra directo con ?vista=comandas
    const params = new URLSearchParams(window.location.search);
    if (params.get('estacion')) kdEstado.filtro = Number(params.get('estacion')) || 0;
    kdPonerVista(params.get('vista') === 'comandas' ? 'comandas' : 'salon', false);

    // Al volver a la pestaña, el tablero se pone al día (una tableta de cocina pasa horas
    // abierta y puede haber perdido avisos).
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && kdEstado.vista === 'comandas') kdCargar(true);
    });
});
