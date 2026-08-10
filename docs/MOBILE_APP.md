# Tomodachi — App Android (plan)

> Estado: **propuesta para revisión** · 2026-08-10
> Objetivo: app Android que se conecta al servicio Tomodachi (Baburu
> Cloud o self-hosted), con capacidades nativas: notificaciones push,
> cámara/lector de códigos, wakelock en caja.

---

## 1. Visión

Una app **solo Android** (sin iOS: Google no cobra cuota anual; Apple
cobra $99 USD/año solo por existir). La app es un contenedor de la web
app actual dentro de un WebView nativo, con un puente hacia funciones
del teléfono que el navegador no puede dar:

| Beneficio | Por qué importa |
|---|---|
| Notificaciones push | Aviso de venta, stock bajo, cierre de caja |
| Cámara / lector de códigos | Escanear producto en ventas e inventario sin teclear |
| Wakelock | La pantalla no se apaga mientras se vende |
| Instalable real | Icono propio, sin barra del navegador, sin pasar por Play |
| Acceso directo al servicio | Un solo APK sirve para Baburu Cloud y self-hosted |

## 2. Decisión de arquitectura: Capacitor

**Capacitor** (Ionic) es el estándar de facto para empaquetar web apps
como apps nativas:

- Reutiliza el frontend 100% (cero reescritura).
- Plugins oficiales para cámara, push (FCM), wakelock, red, etc.
- Un proyecto Capacitor genera un proyecto Android real (Gradle).
- Gratis, Apache 2.0, mantenido por el equipo de Ionic.

Alternativas descartadas:

| Alternativa | Por qué no |
|---|---|
| Kotlin nativo | Reescribir toda la UI; 3x esfuerzo |
| React Native / Flutter | Reescribir; peso muerto para una app-shell |
| PWA sola | No da push fiables en Android sin FCM ni acceso pleno a cámara en WebView de terceros |
| Cordova | Legado; Capacitor lo supera en todo |

## 3. Cómo funciona (flujo)

```
┌────────────────────────────┐
│  App Android (Capacitor)   │
│  ┌──────────────────────┐  │
│  │  Pantalla de arranque │  │  1ª vez: elegir modo
│  │  [Baburu Cloud]       │  │          o URL self-hosted
│  │  [Mi servidor] → URL  │  │  (se guarda en el teléfono)
│  └──────────┬───────────┘  │
│             ▼              │
│  ┌──────────────────────┐  │
│  │  WebView → carga la   │  │  https://tomodachi.tabtap.dev
│  │  web app (URL elegida)│  │  o http://192.168.1.x:8080
│  └──────────┬───────────┘  │
│             ▼              │
│  Bridge nativo (JS)        │  window.TomodachiNative.*
│  • scanBarcode() → cámara  │  la web app lo detecta y usa
│  • getPushToken()          │  scanner nativo / push / wakelock
│  • keepAwake(on/off)       │
└────────────────────────────┘
```

El **servidor no cambia de modelo**: la web app sigue siendo la misma;
el bridge solo se activa cuando detecta `window.Capacitor`.

### Modos de conexión

1. **Baburu Cloud (default)**: apunta a `https://tomodachi.tabtap.dev`.
   Nosotros hosteamos, ellos solo instalan la app y crean su empresa.
2. **Self-hosted**: el usuario escribe su URL (ej. `http://192.168.1.50:8080`
   o `https://mi-pos.midominio.com`). Todo lo nativo funciona igual
   contra su servidor.

El APK es el mismo para ambos: solo cambia la URL guardada.

## 4. Estructura propuesta en el repo

```
mobile/                        ← nuevo (proyecto Capacitor)
├── package.json               ← @capacitor/core, cli, android
├── capacitor.config.ts        ← appId, appName "Tomodachi"
├── www/                       ← (generado) shell mínimo
├── src/
│   ├── index.html             ← pantalla de bienvenida/modo servidor
│   ├── app.js                 ← lógica: guardar URL, abrir WebView
│   └── style.css
├── android/                   ← proyecto Android (generado por cap add android)
├── hooks/                     ← (opcional) scripts de prebuild
└── README.md                  ← cómo buildear el APK

public/js/capacitor-bridge.js  ← nuevo: expone window.TomodachiNative
api/devices/register.php       ← nuevo: registrar token FCM (con API token)
database/migrations/014_device_tokens.sql  ← nuevo
docs/MOBILE_APP.md             ← este documento
.github/workflows/android-apk.yml  ← nuevo: build + release APK
```

## 5. Integración con la web app (bridge)

`public/js/capacitor-bridge.js` — se incluye en `public/index.html` /
`login.html` / todas las vistas. Detección:

```js
if (window.Capacitor && window.Capacitor.isNativePlatform()) {
  window.TomodachiNative = { isNative: true, /* ... */ };
}
```

API expuesta:

```js
window.TomodachiNative = {
  isNative: true,
  // Escáner: retorna Promise<string> con el código leído
  scanBarcode: () => BarcodeScanner.scan().then(r => r.code),
  // Push: token FCM del dispositivo
  getPushToken: () => PushNotifications.getToken(),
  // Mantener pantalla encendida en caja
  keepAwake: (on) => Wakelock.set({ enabled: on }),
  // Registrar este dispositivo para notificaciones
  registerDevice: () => /* llama a api/devices/register.php con el token */,
};
```

### Dónde se usa en el frontend (cambios puntuales)

| Vista | Hook |
|---|---|
| `public/sales.html` | En el input de código: si `TomodachiNative.isNative`, el botón abre el escáner de cámara en vez del input manual. Al escanear, autocompleta el producto. |
| `public/inventory.html` | Ícono "escanear" junto al campo de búsqueda/alta de producto. |
| `public/sales.html` | Al abrir la vista de caja: `keepAwake(true)`; al salir: `keepAwake(false)`. |
| `public/login.html` / todas | Al iniciar sesión: `registerDevice()` (si hay push configurado). |

## 6. Backend (cambios en la API)

### 6.1 Tabla `device_tokens` (migración 014)

```sql
CREATE TABLE device_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    user_id INT NOT NULL,
    platform ENUM('android') DEFAULT 'android',
    fcm_token VARCHAR(255) NOT NULL,
    app_version VARCHAR(20) DEFAULT NULL,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE KEY unique_fcm_token (fcm_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 6.2 Endpoints nuevos

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `/api/devices/register.php` | Alta/actualiza el token FCM del dispositivo | API token (scope write) o sesión |
| POST | `/api/devices/unregister.php` | Baja del dispositivo (logout/desinstalar) | API token o sesión |
| POST | `/api/devices/send_push.php` | Enviar notificación a una tienda (solo admin) | Sesión admin |

`send_push.php` usa FCM HTTP v1 API (firebase-admin PHP o REST directo
con server key). Ejemplo de payload para "stock bajo":

```json
{
  "title": "Stock bajo",
  "body": "Coca Cola 600ml: quedan 3 unidades",
  "data": { "screen": "inventory" }
}
```

Notificaciones planeadas (fase 2):

| Evento | Cuándo |
|---|---|
| Venta registrada | `create_sale` exitoso (a la tienda) |
| Stock bajo | producto cruza `min_stock` |
| Caja abierta/cerrada | aviso al admin |
| Promoción por vencer | recordatorio diario (cron) |

### 6.3 Config

- `config/firebase.php` (en `.gitignore`): `FCM_SERVER_KEY` (o credencial
  service account). Si no existe → los endpoints de push responden 501
  "Push no configurado" y la app sigue funcionando normal (sin push).

## 7. Build y distribución del APK

### 7.1 Local (opcional)

```bash
cd mobile
npm install
npx cap add android          # una vez
npx cap sync                 # sincroniza www/ con el proyecto Android
npx cap open android         # o build por Gradle:
cd android && ./gradlew assembleRelease
```

Requisito: JDK 17 (ya está en el servidor) + Android SDK (instalable
vía `sdkmanager`; ~500 MB) — solo si queremos build local.

### 7.2 CI: GitHub Actions (recomendado, gratis)

`.github/workflows/android-apk.yml`:

- Trigger: push a `mobile/` + tag `v*`, o workflow_dispatch.
- Jobs: `setup-java@17` + `setup-android` + `npm ci` + `npx cap sync`
  + `./gradlew assembleRelease` + subir `app-release.apk` al Release.
- Firma: keystore generado una vez, guardado como secret del repo
  (`KEYSTORE_BASE64`, `KEYSTORE_PASS`, `KEY_ALIAS`, `KEY_PASS`).
- El APK se publica en **GitHub Releases** (descarga directa, sin
  cuotas, sin revisión de tienda).

### 7.3 Play Store (opcional, decisión posterior)

- Cuota única $25 USD (NO anual como iOS).
- Requiere: APK/AAB firmado, política de privacidad (ya existe
  `public/privacy.html`), consola de desarrollador.
- Beneficio: actualizaciones automáticas, más confianza para vender
  el servicio Baburu Cloud.

## 8. Push: qué se necesita de tu lado (cuando lleguemos)

1. Crear proyecto en [Firebase Console](https://console.firebase.google.com) (gratis).
2. Registrar la app Android (package id propuesto: `dev.tabtap.tomodachi`).
3. Descargar `google-services.json` → `mobile/android/app/`.
4. Copiar la **server key** (o service account JSON) → secret de CI /
   `config/firebase.php`.

Sin Firebase, la app funciona completa (scanner, wakelock, modos);
solo las notificaciones quedan desactivadas hasta configurarlo.

## 9. Roadmap por fases

| Fase | Alcance | Esfuerzo | Dependencias |
|---|---|---|---|
| **1. Shell + modos** | `mobile/` con pantalla de bienvenida (Baburu Cloud / URL propia), WebView, ícono, splash. APK instalable. | 1 sesión | Ninguna |
| **2. Bridge + scanner** | `capacitor-bridge.js` + botón escáner en ventas/inventario + wakelock en caja. | 1 sesión | Ninguna |
| **3. Push** | Migración 014 + endpoints register/unregister/send + hook en login + build FCM. | 1-2 sesiones | Cuenta Firebase |
| **4. CI + Releases** | Workflow GitHub Actions + firma + APK en Releases. | 1 sesión | Secretos del repo |
| **5. Play Store (opcional)** | AAB firmado, listing, política. | 1 sesión | $25 + cuenta dev |
| **6. Notificaciones de negocio** | eventos venta/stock/caja + cron de promociones. | 1 sesión | Fase 3 |

Total estimado: **5-7 sesiones** para tener la app publicable.

## 10. Preguntas abiertas (decisiones tuyas)

1. **Package id**: propongo `dev.tabtap.tomodachi` (único y definitivo;
   cambiarlo después de publicar es doloroso).
2. **Nombre visible**: "Tomodachi POS" o "Tomodachi"? (la marca Baburu
   sería la empresa publicadora: "by Baburu").
3. **Play Store ahora o Releases primero?** Releases es gratis e
   inmediato; Play da actualizaciones automáticas.
4. **¿Quieres que el APK también apunte a un dominio propio** (ej.
   `app.tomodachi.dev` además de tabtap.dev)?
5. **Mínimo Android**: propongo Android 8 (API 26+) que cubre ~97% de
   dispositivos en 2026.

---

*Este documento evoluciona: cuando arranquemos cada fase, se marca lo
completado y se registran las decisiones tomadas.*
