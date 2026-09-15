/**
 * Cliente de tiempo real de Tomodachi (cliente reutilizable).
 *
 * Por qué existe: las pantallas del personal (mapa de puntos de servicio, y después la
 * pantalla de preparación) no pueden botones de "actualizar" ni sondear cada pocos segundos.
 * El aviso llega por WebSocket desde la app en cuanto algo cambia.
 *
 * Cómo se conecta (y por qué así):
 *   1. Pide un token al servidor (`api/ws/token.php?canal=...`). El relay ya NO acepta los
 *      canales de cuenta ni de tienda sin token: el canal de una cuenta es su `session_id`,
 *      un entero corto que cualquiera podía adivinar para escuchar el pedido de otra mesa.
 *   2. Conecta a `/ws/?session=<canal>&token=<...>&exp=<...>` (o a `ws://localhost:8765`
 *      en desarrollo).
 *   3. Si el socket se cae, reintenta con espera creciente (1 s, 2 s, 4 s… hasta 30 s).
 *   4. Manda `{"type":"ping"}` cada 45 s: los túneles cierran los sockets ociosos y una
 *      pantalla que no cambia en 10 minutos se quedaría muda sin avisar.
 *
 * Uso:
 *   const rt = TomodachiRealtime.conectar({
 *       canal: 'store:1',
 *       onEvento: function (msg) { ... },   // {type:'order_update', session:'12', event:'...'}
 *       onEstado: function (estado) { ... } // 'conectado' | 'reconectando' | 'detenido'
 *   });
 *   rt.cerrar();
 */
window.TomodachiRealtime = (function () {
    'use strict';

    function urlBase() {
        var host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1') {
            return 'ws://localhost:8765/?';
        }
        var scheme = (window.location.protocol === 'https:') ? 'wss:' : 'ws:';
        return scheme + '//' + window.location.host + '/ws/?';
    }

    function conectar(opciones) {
        var canal = opciones.canal;
        var onEvento = opciones.onEvento || function () {};
        var onEstado = opciones.onEstado || function () {};
        var tokenUrl = opciones.tokenUrl || '../api/ws/token.php';
        var joinToken = opciones.joinToken || null;

        var socket = null;
        var detenido = false;
        var reintento = 0;
        var timerReconexion = null;
        var timerPing = null;

        function estado(nombre, detalle) {
            try { onEstado(nombre, detalle || null); } catch (e) { /* la UI no debe romper el socket */ }
        }

        function limpiar() {
            if (timerPing) { clearInterval(timerPing); timerPing = null; }
            if (timerReconexion) { clearTimeout(timerReconexion); timerReconexion = null; }
        }

        async function token() {
            var url = tokenUrl + '?canal=' + encodeURIComponent(canal)
                + (joinToken ? '&join_token=' + encodeURIComponent(joinToken) : '');
            var res = await fetch(url, { credentials: 'include' });
            var datos = await res.json();
            if (!res.ok || !datos || datos.success === false) {
                throw new Error((datos && datos.message) || 'No se pudo autorizar el canal');
            }
            return datos.data;
        }

        async function abrir() {
            if (detenido) return;
            var credencial;
            try {
                credencial = await token();
            } catch (e) {
                // Sin token (por ejemplo sesión vencida) no tiene sentido insistir rápido.
                estado('sin-autorizacion', e.message);
                programarReintento(15000);
                return;
            }
            if (detenido) return;

            var url = urlBase() + 'session=' + encodeURIComponent(credencial.canal)
                + '&token=' + encodeURIComponent(credencial.token)
                + '&exp=' + encodeURIComponent(credencial.exp);

            try {
                socket = new WebSocket(url);
            } catch (e) {
                programarReintento();
                return;
            }

            socket.onopen = function () {
                reintento = 0;
                estado('conectado');
                timerPing = setInterval(function () {
                    try {
                        if (socket && socket.readyState === 1) {
                            socket.send(JSON.stringify({ type: 'ping' }));
                        }
                    } catch (e) { /* el reintento ya está armado */ }
                }, 45000);
            };

            socket.onmessage = function (ev) {
                var msg = null;
                try { msg = JSON.parse(ev.data); } catch (e) { return; }
                if (!msg || msg.type === 'pong') return;
                try { onEvento(msg); } catch (e) { /* un error de pintado no debe cerrar el socket */ }
            };

            socket.onclose = function () {
                limpiar();
                if (detenido) return;
                estado('reconectando');
                programarReintento();
            };

            socket.onerror = function () { /* onclose se encarga */ };
        }

        function programarReintento(forzado) {
            if (detenido) return;
            var espera = forzado || Math.min(30000, 1000 * Math.pow(2, reintento));
            reintento++;
            if (timerReconexion) clearTimeout(timerReconexion);
            timerReconexion = setTimeout(abrir, espera);
        }

        function cerrar() {
            detenido = true;
            limpiar();
            try { if (socket) socket.close(); } catch (e) {}
            socket = null;
            estado('detenido');
        }

        /** Fuerza una reconexión inmediata (por ejemplo al volver a la pestaña). */
        function reconectar() {
            if (detenido) return;
            if (socket && socket.readyState === 1) return;
            reintento = 0;
            abrir();
        }

        abrir();

        return { cerrar: cerrar, reconectar: reconectar, canal: canal };
    }

    return { conectar: conectar, urlBase: urlBase };
})();
