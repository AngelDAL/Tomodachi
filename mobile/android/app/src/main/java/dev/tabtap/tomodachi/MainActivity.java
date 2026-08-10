package dev.tabtap.tomodachi;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

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
