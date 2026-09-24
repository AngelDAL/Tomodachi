/**
 * Cobro de la cuenta — pantalla del piso (js/cobro.js)
 *
 * El mesero cierra el servicio desde aquí: ve lo que hay que cobrar, decide la propina
 * (opcional, siempre), divide si hace falta y elige la forma de pago. El servidor es el
 * que decide si el cobro cuadra: esta pantalla NO calcula el importe ni valida el dinero,
 * solo arma la petición y muestra lo que contestó el servidor.
 *
 * Dos caminos, los mismos que usa el servicio:
 *   - Cobro completo: un método (efectivo con cambio, tarjeta, transferencia, mixto, fiado).
 *   - Por partes: se aplica un desglose y se va cobrando cada parte; los pagos se acumulan
 *     y se mandan juntos al final. Mientras no cubran el total, el botón no se habilita:
 *     no se cierra una cuenta con dinero faltante (lo mismo que exige el servidor).
 *
 * Nada de <select> ni de diálogos del navegador: tarjetas y chips, como el resto del
 * sistema, y áreas táctiles de 40 px para la tableta.
 */
(function () {
    'use strict';

    const cb = {
        cuenta: null,      // resumen que devuelve api/dining/charge.php
        session_id: 0,
        propinaModo: '0',
        propina: 0,
        metodo: 'cash',
        pagos: [],         // [{method, amount, reference, is_tip, share_id, etiqueta}]
        partes: [],        // [{share_id, label, amount, pagada}]
        partesCobradas: {},// share_id => true
        cliente: null,
        modoDivision: null,
        cargando: false,
    };

    const $ = function (id) { return document.getElementById(id); };

    // =========================================================
    // Abrir / cargar
    // =========================================================

    async function abrir() {
        const actual = window.tpCuentaActual;
        // Si se toca "Cobrar" antes de que la cuenta termine de cargar, no se abre nada en
        // silencio: se avisa. Un botón que no hace nada parece un botón roto.
        if (!actual || !actual.session_id) {
            tpAviso('Espera a que la cuenta termine de cargar para cobrarla.', 'error');
            return;
        }

        cb.session_id = actual.session_id;
        cb.propinaModo = '0';
        cb.propina = 0;
        cb.metodo = 'cash';
        cb.pagos = [];
        cb.partes = [];
        cb.partesCobradas = {};
        cb.cliente = null;
        cb.modoDivision = null;

        $('tpCobroRecibido').value = '';
        $('tpCobroReferencia').value = '';
        $('tpCobroMixtoEfectivo').value = '';
        $('tpCobroMixtoReferencia').value = '';
        $('tpCobroBuscarCliente').value = '';
        $('tpCobroPropina').value = '';
        $('tpCobroClientes').innerHTML = '';
        $('tpCobroClienteElegido').classList.add('hidden');
        aviso('');
        marcarChips('tpCobroPropinaChips', 'propina', '0');
        marcarChips('tpCobroMetodoChips', 'metodo', 'cash');
        marcarChips('tpCobroModoChips', 'modo', null);
        $('tpCobroPropinaCampo').classList.add('hidden');
        $('tpCobroPartesCampo').classList.add('hidden');
        $('tpCobroPartesEditor').innerHTML = '';
        cambiarMetodo('cash');

        tpAbrirModal('tpModalCobro');
        $('tpCobroCodigo').textContent = actual.code || '----';
        $('tpCobroSub').textContent = [actual.puntos, actual.personas + ' persona(s)']
            .filter(Boolean).join(' · ');
        $('tpCobroEstado').textContent = 'Cargando la cuenta…';
        $('tpCobroConfirmar').disabled = true;

        await cargar();
    }

    async function cargar() {
        cb.cargando = true;
        try {
            // tpPeticion devuelve YA el contenido de `data` (no el sobre completo).
            cb.cuenta = await tpPeticion('../api/dining/charge.php?cuenta=' + encodeURIComponent(cb.session_id));
            // El desglose GUARDADO en la cuenta (si alguien ya la dividió) se trae al estado
            // de la pantalla. Sin esto, un desglose aplicado antes se perdía de vista al
            // volver a abrir el cobro y se podía cobrar como si no estuviera dividida.
            cb.partes = (cb.cuenta.partes || []).map(function (p) {
                return {
                    share_id: Number(p.share_id),
                    label: p.label,
                    amount: Number(p.amount),
                    mode: p.mode,
                };
            });
            if (cb.partes.length) {
                cb.modoDivision = cb.partes[0].mode || cb.modoDivision;
                marcarChips('tpCobroModoChips', 'modo', cb.modoDivision);
            }
        } catch (e) {
            aviso(tpMensajeDeError(e));
            $('tpCobroEstado').textContent = '';
        } finally {
            // Se marca el fin de la carga ANTES de pintar: si no, el botón de cobrar queda
            // deshabilitado para siempre (pintar() decide con `cargando`).
            cb.cargando = false;
            pintar();
        }
    }

    // =========================================================
    // Pintar
    // =========================================================

    function pintar() {
        const c = cb.cuenta;
        if (!c) return;

        $('tpCobroConsumo').textContent = tpDinero(c.total);
        $('tpCobroPropinaVista').textContent = tpDinero(cb.propina);
        const aCobrar = redondear((Number(c.total) || 0) + cb.propina);
        $('tpCobroAPagar').textContent = tpDinero(aCobrar);

        // Aviso de platillos sin mandar a preparación: cobrarlos es válido, pero el mesero
        // tiene que saberlo (puede ser un error de captura).
        if (Number(c.sin_enviar) > 0) {
            aviso(Number(c.sin_enviar) + ' platillo(s) siguen sin enviarse a preparación. Si los cobra, salen de la cuenta igual.');
        } else if (cb.pagos.length === 0) {
            aviso('');
        }

        pintarPartes();
        pintarPagos();
        pintarEditorPartes();

        // Estado del dinero: lo que falta por cubrir con los pagos acumulados.
        const pagado = cb.pagos.reduce(function (s, p) { return s + Number(p.amount); }, 0);
        const falta = redondear(aCobrar - pagado);
        const estado = $('tpCobroEstado');
        const faltaEl = $('tpCobroFalta');

        if (cb.pagos.length > 0) {
            if (falta > 0.005) {
                estado.textContent = 'Pagado ' + tpDinero(pagado) + ' · falta ' + tpDinero(falta);
                faltaEl.textContent = 'Falta ' + tpDinero(falta) + ' de ' + tpDinero(aCobrar) + '.';
                faltaEl.classList.remove('hidden');
            } else {
                estado.textContent = 'Cubierto ' + tpDinero(pagado);
                faltaEl.classList.add('hidden');
                faltaEl.textContent = '';
            }
        } else {
            estado.textContent = '';
            faltaEl.classList.add('hidden');
        }

        // El botón solo se habilita cuando el cobro puede cerrar la cuenta:
        //  - camino completo: siempre (el servidor valida),
        //  - camino por partes: cuando los pagos cubren el total.
        const puede = cb.pagos.length === 0 ? true : Math.abs(falta) <= 0.005;
        $('tpCobroConfirmar').disabled = !puede || cb.cargando;

        // El cambio solo tiene sentido en efectivo con cobro completo.
        actualizarCambio();
    }

    function pintarPartes() {
        const cont = $('tpCobroPartes');
        const metas = { equal: 'partes iguales', by_person: 'por persona', by_amount: 'por monto', manual: 'a mano' };
        if (!cb.partes.length) {
            cont.innerHTML = '';
            return;
        }
        cont.innerHTML = cb.partes.map(function (p, i) {
            const pagada = !!cb.partesCobradas[p.share_id];
            return '<div class="tp-parte' + (pagada ? ' pagada' : '') + '">' +
                '<span class="tp-parte-nombre">' + tpEsc(p.label || ('Parte ' + (i + 1))) + '</span>' +
                '<span class="tp-parte-monto">' + tpDinero(p.amount) + '</span>' +
                (pagada
                    ? '<span class="tp-parte-acciones"><i class="fas fa-check"></i></span>'
                    : '<span class="tp-parte-acciones">' +
                        '<button type="button" class="tp-btn" data-parte-cobrar="' + i + '" data-parte-metodo="cash"><i class="fas fa-money-bill"></i> Efectivo</button>' +
                        '<button type="button" class="tp-btn" data-parte-cobrar="' + i + '" data-parte-metodo="transfer"><i class="fas fa-building-columns"></i> Transf.</button>' +
                      '</span>') +
                '</div>';
        }).join('') +
        '<div class="tp-cobro-nota">Desglose ' + (metas[cb.modoDivision] || '') + ' · guardado en la cuenta</div>';
    }

    function pintarPagos() {
        const cont = $('tpCobroPagos');
        if (!cb.pagos.length) { cont.innerHTML = ''; return; }
        const nombres = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', credit: 'Fiado', mixed: 'Mixto', codi: 'CoDi', stripe: 'Stripe' };
        cont.innerHTML = cb.pagos.map(function (p, i) {
            const etiqueta = (p.etiqueta ? p.etiqueta + ' · ' : '') + (nombres[p.method] || p.method) +
                (p.reference ? ' · ' + tpEsc(p.reference) : '');
            return '<div class="tp-pago"><i class="fas fa-circle-check"></i> ' + etiqueta +
                '<span class="monto">' + tpDinero(p.amount) + '</span>' +
                '<button type="button" data-pago-quitar="' + i + '" title="Quitar este pago"><i class="fas fa-times"></i></button></div>';
        }).join('');
    }

    /** El editor de la división cambia según la forma elegida. */
    function pintarEditorPartes() {
        const cont = $('tpCobroPartesEditor');
        const campo = $('tpCobroPartesCampo');
        if (!cb.modoDivision) { campo.classList.add('hidden'); cont.innerHTML = ''; return; }
        campo.classList.remove('hidden');

        if (cb.modoDivision === 'equal') {
            const personas = (cb.cuenta && Number(cb.cuenta.session && 1)) || 2;
            const sugerido = Math.max(2, Number(window.tpCuentaActual && window.tpCuentaActual.personas) || 2);
            cont.innerHTML = '<div class="tp-parte-editor"><label>Partes</label>' +
                '<input type="number" id="tpCobroNumPartes" min="2" step="1" value="' + sugerido + '"></div>';
        } else if (cb.modoDivision === 'by_amount') {
            cont.innerHTML = '<div class="tp-parte-editor"><label>Monto fijo</label>' +
                '<input type="number" id="tpCobroMontoFijo" min="0" step="1" placeholder="0">' +
                '<label>y el resto entre</label><input type="number" id="tpCobroRestoPartes" min="1" step="1" value="2"></div>';
        } else if (cb.modoDivision === 'manual') {
            const n = Math.max(2, Number(window.tpCuentaActual && window.tpCuentaActual.personas) || 2);
            let html = '';
            for (let i = 1; i <= n; i++) {
                html += '<div class="tp-parte-editor"><label>Parte ' + i + '</label>' +
                    '<input type="number" class="tp-manual-monto" min="0" step="1" placeholder="0"></div>';
            }
            cont.innerHTML = html;
        } else {
            cont.innerHTML = '<div class="tp-cobro-nota">Cada comensal paga lo que pidió desde su celular.</div>';
        }
    }

    // =========================================================
    // Propina (opcional, SIEMPRE)
    // =========================================================

    function elegirPropina(modo) {
        cb.propinaModo = modo;
        marcarChips('tpCobroPropinaChips', 'propina', modo);
        const total = Number((cb.cuenta && cb.cuenta.total) || 0);
        if (modo === 'otra') {
            $('tpCobroPropinaCampo').classList.remove('hidden');
            cb.propina = redondear(Number($('tpCobroPropina').value) || 0);
        } else {
            $('tpCobroPropinaCampo').classList.add('hidden');
            cb.propina = redondear(total * (Number(modo) / 100));
        }
        pintar();
    }

    // =========================================================
    // Forma de pago
    // =========================================================

    function cambiarMetodo(metodo) {
        cb.metodo = metodo;
        marcarChips('tpCobroMetodoChips', 'metodo', metodo);
        $('tpCobroCampoEfectivo').classList.toggle('hidden', metodo !== 'cash');
        $('tpCobroCampoReferencia').classList.toggle('hidden', metodo !== 'transfer' && metodo !== 'card');
        $('tpCobroCampoMixto').classList.toggle('hidden', metodo !== 'mixed');
        $('tpCobroCampoFiado').classList.toggle('hidden', metodo !== 'credit');
        if (metodo === 'transfer') $('tpCobroCampoReferencia').classList.remove('hidden');
        actualizarCambio();
    }

    function actualizarCambio() {
        const el = $('tpCobroCambio');
        if (cb.metodo !== 'cash') return;
        const total = aCobrarTotal();
        const recibido = Number($('tpCobroRecibido').value) || 0;
        if (recibido <= 0) {
            el.textContent = 'Cambio ' + tpDinero(0);
            el.classList.remove('falta');
            return;
        }
        const cambio = redondear(recibido - total);
        if (cambio < 0) {
            el.textContent = 'Faltan ' + tpDinero(Math.abs(cambio));
            el.classList.add('falta');
        } else {
            el.textContent = 'Cambio ' + tpDinero(cambio);
            el.classList.remove('falta');
        }
    }

    function aCobrarTotal() {
        const consumo = Number((cb.cuenta && cb.cuenta.total) || 0);
        return redondear(consumo + cb.propina);
    }

    // =========================================================
    // División
    // =========================================================

    async function aplicarDivision() {
        if (!cb.modoDivision) return;
        const cuerpo = { session_id: cb.session_id, mode: cb.modoDivision };

        if (cb.modoDivision === 'equal') {
            const n = Number($('tpCobroNumPartes') && $('tpCobroNumPartes').value) || 2;
            cuerpo.partes = n;
        } else if (cb.modoDivision === 'by_amount') {
            const monto = Number($('tpCobroMontoFijo') && $('tpCobroMontoFijo').value) || 0;
            const resto = Number($('tpCobroRestoPartes') && $('tpCobroRestoPartes').value) || 1;
            cuerpo.partes = [{ label: 'Monto fijo', amount: monto }];
            cuerpo.resto_partes = resto;
        } else if (cb.modoDivision === 'manual') {
            const entradas = Array.prototype.slice.call(document.querySelectorAll('.tp-manual-monto'));
            cuerpo.partes = entradas.map(function (inp, i) {
                return { label: 'Parte ' + (i + 1), amount: Number(inp.value) || 0 };
            });
        }

        $('tpCobroAplicar').disabled = true;
        try {
            const r = await tpPeticion('../api/dining/split.php', {
                method: 'POST',
                body: JSON.stringify(cuerpo),
            });
            cb.partes = (r && r.partes) || [];
            cb.partesCobradas = {};
            aviso('');
            // El desglose se acaba de guardar en la cuenta: se vuelve a leer para que la
            // pantalla muestre lo mismo que el servidor tiene guardado.
            await cargar();
        } catch (e) {
            aviso(tpMensajeDeError(e));
        } finally {
            $('tpCobroAplicar').disabled = false;
        }
    }

    /** Cobrar UNA parte: se acumula como pago y se manda junto con los demás al final. */
    function cobrarParte(indice, metodo) {
        const p = cb.partes[indice];
        if (!p || cb.partesCobradas[p.share_id]) return;
        let reference = null;
        if (metodo === 'transfer') {
            reference = prompt('Clave de rastreo de la transferencia (opcional):') || null;
        }
        cb.pagos.push({
            method: metodo,
            amount: redondear(Number(p.amount)),
            reference: reference,
            is_tip: false,
            share_id: Number(p.share_id),
            etiqueta: p.label || 'Parte',
        });
        cb.partesCobradas[p.share_id] = true;
        pintar();
    }

    // =========================================================
    // Cliente para el fiado
    // =========================================================

    let temporizadorCliente = null;
    function buscarCliente() {
        clearTimeout(temporizadorCliente);
        const q = $('tpCobroBuscarCliente').value.trim();
        if (q.length < 2) { $('tpCobroClientes').innerHTML = ''; return; }
        temporizadorCliente = setTimeout(async function () {
            try {
                const r = await tpPeticion('../api/customers/customers.php?search=' + encodeURIComponent(q));
                const lista = (r && (r.customers || r)) || [];
                $('tpCobroClientes').innerHTML = lista.slice(0, 6).map(function (c) {
                    const saldo = Number(c.balance) || 0;
                    const limite = Number(c.credit_limit) || 0;
                    return '<button type="button" data-cliente="' + c.customer_id + '">' +
                        tpEsc(c.full_name || 'Cliente') +
                        (saldo > 0 ? ' · debe ' + tpDinero(saldo) : '') +
                        (limite > 0 ? ' · límite ' + tpDinero(limite) : ' · sin límite') +
                        '</button>';
                }).join('') || '<div class="tp-cobro-nota">Sin resultados</div>';
            } catch (e) {
                $('tpCobroClientes').innerHTML = '<div class="tp-cobro-nota">' + tpEsc(tpMensajeDeError(e)) + '</div>';
            }
        }, 250);
    }

    function elegirCliente(id, nombre) {
        cb.cliente = { customer_id: Number(id), full_name: nombre };
        $('tpCobroClienteElegido').innerHTML = '<i class="fas fa-user-check"></i> ' + tpEsc(nombre);
        $('tpCobroClienteElegido').classList.remove('hidden');
        $('tpCobroClientes').innerHTML = '';
        $('tpCobroBuscarCliente').value = '';
    }

    // =========================================================
    // Cobrar
    // =========================================================

    async function cobrar() {
        const total = aCobrarTotal();
        const cuerpo = { session_id: cb.session_id, tip_amount: cb.propina };

        if (cb.pagos.length > 0) {
            // Camino por partes: los pagos acumulados, más la propina si no se cobró aparte.
            const pagos = cb.pagos.slice();
            if (cb.propina > 0) {
                const metodoPropina = metodoParaPropina(pagos);
                pagos.push({ method: metodoPropina, amount: cb.propina, is_tip: true });
            }
            cuerpo.payments = pagos;
            if (cb.propina > 0) cuerpo.tip_method = metodoParaPropina(pagos);
            if (cb.cliente) cuerpo.customer_id = cb.cliente.customer_id;
        } else if (cb.metodo === 'cash') {
            const recibido = Number($('tpCobroRecibido').value) || 0;
            cuerpo.payment_method = 'cash';
            cuerpo.cash_received = recibido > 0 ? recibido : total;
            if (cb.propina > 0) cuerpo.tip_method = 'cash';
        } else if (cb.metodo === 'mixed') {
            const efectivo = Number($('tpCobroMixtoEfectivo').value) || 0;
            if (efectivo <= 0 || efectivo >= Number(cb.cuenta.total)) {
                aviso('En un pago mixto, el efectivo tiene que ser mayor que cero y menor que el consumo (' + tpDinero(cb.cuenta.total) + ').');
                return;
            }
            const resto = redondear(Number(cb.cuenta.total) - efectivo);
            const pagos = [
                { method: 'cash', amount: efectivo },
                { method: 'transfer', amount: resto, reference: $('tpCobroMixtoReferencia').value.trim() || null },
            ];
            if (cb.propina > 0) pagos.push({ method: 'cash', amount: cb.propina, is_tip: true });
            cuerpo.payments = pagos;
        } else if (cb.metodo === 'credit') {
            if (!cb.cliente) {
                aviso('Para fiar la cuenta hay que elegir al cliente: es a quien se le carga la deuda.');
                return;
            }
            const pagos = [{ method: 'credit', amount: Number(cb.cuenta.total) }];
            if (cb.propina > 0) pagos.push({ method: 'cash', amount: cb.propina, is_tip: true });
            cuerpo.payments = pagos;
            cuerpo.customer_id = cb.cliente.customer_id;
        } else {
            // Tarjeta o transferencia: la cuenta completa con su clave de rastreo.
            const pagos = [{
                method: cb.metodo,
                amount: Number(cb.cuenta.total),
                reference: $('tpCobroReferencia').value.trim() || null,
            }];
            if (cb.propina > 0) pagos.push({ method: cb.metodo, amount: cb.propina, is_tip: true });
            cuerpo.payments = pagos;
        }

        $('tpCobroConfirmar').disabled = true;
        $('tpCobroEstado').textContent = 'Cobrando…';
        aviso('');
        try {
            const d = (await tpPeticion('../api/dining/charge.php', {
                method: 'POST',
                body: JSON.stringify(cuerpo),
            })) || {};
            let resumen = 'Cuenta ' + (window.tpCuentaActual ? window.tpCuentaActual.code : '') +
                ' cobrada. Venta #' + d.sale_id + ' por ' + tpDinero(d.total);
            if (d.tip_amount > 0) resumen += ' + ' + tpDinero(d.tip_amount) + ' de propina';
            if (d.change > 0) resumen += '. Cambio ' + tpDinero(d.change);
            tpAviso(resumen, 'ok');

            tpCerrarModal('tpModalCobro');
            tpCerrarModal('tpModalCuenta');
            // El mapa y las cuentas abiertas se vuelven a leer: la cuenta ya no está.
            if (typeof tpCargar === 'function') tpCargar(true);
        } catch (e) {
            aviso(tpMensajeDeError(e));
            $('tpCobroConfirmar').disabled = false;
            // Si el error fue porque la cuenta cambió (alguien pidió algo más), se recarga.
            await cargar();
        }
    }

    /** La propina no puede quedar fiada: si todo se fió, la propina va en efectivo. */
    function metodoParaPropina(pagos) {
        const metodos = {};
        (pagos || []).forEach(function (p) { if (!p.is_tip) metodos[p.method] = true; });
        const claves = Object.keys(metodos);
        if (claves.length === 1 && claves[0] !== 'credit') return claves[0];
        return 'cash';
    }

    // =========================================================
    // Utilidades de la pantalla
    // =========================================================

    function redondear(n) { return Math.round((Number(n) || 0) * 100) / 100; }

    function marcarChips(contenedor, atributo, valor) {
        const c = $(contenedor);
        if (!c) return;
        Array.prototype.slice.call(c.querySelectorAll('.tp-chip')).forEach(function (b) {
            b.classList.toggle('activo', b.dataset[atributo] === valor);
        });
    }

    function aviso(msg) {
        const el = $('tpCobroAviso');
        if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
        el.textContent = msg;
        el.classList.remove('hidden');
    }

    // =========================================================
    // Enganches
    // =========================================================

    document.addEventListener('DOMContentLoaded', function () {
        const btn = $('tpCuentaCobrar');
        if (btn) btn.addEventListener('click', abrir);

        const chipsPropina = $('tpCobroPropinaChips');
        if (chipsPropina) {
            chipsPropina.addEventListener('click', function (ev) {
                const b = ev.target.closest('[data-propina]');
                if (b) elegirPropina(b.dataset.propina);
            });
        }
        const inputPropina = $('tpCobroPropina');
        if (inputPropina) {
            inputPropina.addEventListener('input', function () {
                cb.propina = redondear(Number(inputPropina.value) || 0);
                pintar();
            });
        }

        const chipsMetodo = $('tpCobroMetodoChips');
        if (chipsMetodo) {
            chipsMetodo.addEventListener('click', function (ev) {
                const b = ev.target.closest('[data-metodo]');
                if (!b) return;
                // En cuanto se elige un método se descarta el desglose por partes a medias:
                // mezclar "pagué tres partes" con "cobro todo en efectivo" produciría un
                // cobro que no cuadra.
                if (cb.pagos.length) {
                    cb.pagos = [];
                    cb.partesCobradas = {};
                }
                cambiarMetodo(b.dataset.metodo);
                pintar();
            });
        }

        const chipsModo = $('tpCobroModoChips');
        if (chipsModo) {
            chipsModo.addEventListener('click', function (ev) {
                const b = ev.target.closest('[data-modo]');
                if (!b) return;
                cb.modoDivision = b.dataset.modo;
                marcarChips('tpCobroModoChips', 'modo', cb.modoDivision);
                pintar();
            });
        }

        const aplicar = $('tpCobroAplicar');
        if (aplicar) aplicar.addEventListener('click', aplicarDivision);

        const partes = $('tpCobroPartes');
        if (partes) {
            partes.addEventListener('click', function (ev) {
                const b = ev.target.closest('[data-parte-cobrar]');
                if (b) cobrarParte(Number(b.dataset.parteCobrar), b.dataset.parteMetodo);
            });
        }

        const pagos = $('tpCobroPagos');
        if (pagos) {
            pagos.addEventListener('click', function (ev) {
                const b = ev.target.closest('[data-pago-quitar]');
                if (!b) return;
                const i = Number(b.dataset.pagoQuitar);
                const p = cb.pagos[i];
                if (p && p.share_id) delete cb.partesCobradas[p.share_id];
                cb.pagos.splice(i, 1);
                pintar();
            });
        }

        const recibido = $('tpCobroRecibido');
        if (recibido) recibido.addEventListener('input', actualizarCambio);

        const buscar = $('tpCobroBuscarCliente');
        if (buscar) buscar.addEventListener('input', buscarCliente);

        const clientes = $('tpCobroClientes');
        if (clientes) {
            clientes.addEventListener('click', function (ev) {
                const b = ev.target.closest('[data-cliente]');
                if (b) elegirCliente(b.dataset.cliente, b.textContent.split('·')[0].trim());
            });
        }

        const confirmar = $('tpCobroConfirmar');
        if (confirmar) confirmar.addEventListener('click', cobrar);
    });
})();
