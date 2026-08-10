# Tomodachi — App Android (Capacitor)

App Android que se conecta al servicio Tomodachi (Baburu Cloud o
cualquier servidor self-hosted). Fase 1: shell + pantalla de elección
de servidor.

## Requisitos

- Node 20+ / npm
- JDK 17
- Android SDK (compileSdk 36)
- Opcional: Android Studio para ejecutar en emulador/dispositivo

## Estructura

```
www/                 App shell (pantalla de bienvenida: elegir servidor)
android/             Proyecto Android generado (no editar a mano;
                     regenerar con npx cap sync)
icon.svg             Icono de la app (fuente)
icon-foreground.svg  Foreground del adaptive icon
```

## Build local (APK debug)

```bash
cd mobile
npm install
npx cap sync android
export ANDROID_HOME=~/android-sdk   # tu ruta del SDK
cd android
./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Para un APK release firmado, ver `.github/workflows/android-apk.yml`.

## Cómo se usa la app (fase 1)

1. Instalar el APK.
2. Pantalla de bienvenida: elegir **Baburu Cloud** (apunta a
   https://tomodachi.tabtap.dev) o escribir la URL de un servidor
   propio (self-hosted).
3. La elección se guarda en el teléfono y la app abre el login de
   Tomodachi dentro de su WebView.

> El botón "atrás" de Android vuelve a la pantalla de elección de
> servidor (para cambiarlo cuando quieras).

## Próximas fases (ver docs/MOBILE_APP.md)

- Fase 2: bridge nativo (scanner de cámara, wakelock)
- Fase 3: notificaciones push (FCM)
- Fase 4: CI de release firmado (ya hay workflow)
