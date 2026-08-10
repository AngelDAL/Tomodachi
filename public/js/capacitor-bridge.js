/**
 * Puente con la app Android (Capacitor).
 *
 * Cuando Tomodachi corre dentro de la app nativa, expone
 * window.TomodachiNative con capacidades que el navegador no tiene:
 *   - scanBarcode(): abre la cámara del sistema y lee un código
 *   - keepAwake(on): evita que la pantalla se apague (caja)
 *   - isNative: true solo dentro de la app
 *
 * En navegador normal, window.TomodachiNative no existe y la web app
 * usa sus mecanismos habituales (escáner HTML, etc.).
 */
(function () {
    'use strict';

    function isNative() {
        return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    }

    function plugins() {
        return (window.Capacitor && window.Capacitor.Plugins) || {};
    }

    function boot() {
        if (!isNative()) return;
        // La página remota se carga dentro del WebView de la app;
        // el bridge nativo (window.Capacitor) ya está disponible aquí.
        const P = plugins();

        window.TomodachiNative = {
            isNative: true,
            platform: (window.Capacitor.getPlatform && window.Capacitor.getPlatform()) || 'android',

            /** Escanea un código de barras/QR con la cámara del sistema. */
            scanBarcode: function () {
                return new Promise(function (resolve, reject) {
                    const B = P.BarcodeScanner;
                    if (!B || !B.scan) {
                        reject(new Error('Escáner no disponible en esta versión de la app.'));
                        return;
                    }
                    const doScan = function () {
                        B.scan()
                            .then(function (result) {
                                const first = result && result.barcodes && result.barcodes[0];
                                resolve(first ? String(first.rawValue || '') : null);
                            })
                            .catch(reject);
                    };
                    // Pedir permiso de cámara antes de escanear (ML Kit)
                    if (B.requestPermissions) {
                        B.requestPermissions()
                            .then(function (perm) {
                                const status = perm && perm.camera;
                                if (status === 'denied' || status === 'denied_forever') {
                                    reject(new Error('Para escanear, permite el acceso a la cámara en los ajustes de la app (Ajustes > Tomodachi > Permisos > Cámara).'));
                                } else {
                                    doScan();
                                }
                            })
                            .catch(doScan); // si falla el permiso, intentar igual
                    } else {
                        doScan();
                    }
                });
            },

            /** Mantiene (o libera) la pantalla encendida. */
            keepAwake: function (on) {
                const W = P.KeepAwake || P.Wakelock;
                if (!W || !W.set) return Promise.resolve(false);
                return W.set({ enabled: !!on }).then(function () { return true; }).catch(function () { return false; });
            }
        };

        document.dispatchEvent(new CustomEvent('tomodachi-native-ready'));
    }

    // El bridge nativo (window.Capacitor) se inyecta al cargar la página;
    // si aún no está listo, reintentar unas veces antes de rendirse.
    let attempts = 0;
    function tryBoot() {
        if (window.Capacitor && window.Capacitor.isNativePlatform) {
            boot();
        } else if (attempts < 8) {
            attempts += 1;
            setTimeout(tryBoot, 250);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(tryBoot, 0); });
    } else {
        setTimeout(tryBoot, 0);
    }
})();
