package dev.tabtap.tomodachi;

import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Plugin local: mantiene la pantalla encendida mientras se usa la caja.
 * (Equivalente a un "wakelock" sin dependencias externas.)
 *
 * window.Capacitor.Plugins.KeepAwake.set({ enabled: true | false })
 */
@CapacitorPlugin(name = "KeepAwake")
public class KeepAwakePlugin extends Plugin {

    @PluginMethod
    public void set(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled", false);
        if (getActivity() == null) {
            call.reject("Actividad no disponible");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (Boolean.TRUE.equals(enabled)) {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
        call.resolve();
    }
}
