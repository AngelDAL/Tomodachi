package dev.tabtap.tomodachi;

import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin local: pantalla siempre encendida en la caja
        registerPlugin(KeepAwakePlugin.class);

        super.onCreate(savedInstanceState);

        // Sesión persistente: aceptar cookies (necesario para que el login
        // con "mantener mi sesión activa siempre" sobreviva al cierre de la
        // app y al reinicio del teléfono).
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(getBridge().getWebView(), true);

        // NO guardar caché de páginas antiguas en RAM: al arrancar, cada
        // visita carga la versión actual del servidor (nada de contenido viejo
        // de una sesión anterior).
        WebSettings ws = getBridge().getWebView().getSettings();
        ws.setCacheMode(WebSettings.LOAD_NO_CACHE);
        ws.setDomStorageEnabled(true);

        // Forzar que TODAS las URLs se carguen dentro del WebView de la app
        // (Baburu Cloud y cualquier servidor self-hosted, incluidos IPs
        // locales), en lugar de abrir el navegador externo por defecto.
        getBridge().getWebView().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }
        });
    }
}
