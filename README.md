# Tomodachi POS — Community Edition

Sistema de Punto de Venta (POS) web, open source y self-hosted, diseñado para
pequeñas y medianas empresas. Gestión de inventarios, ventas, usuarios,
múltiples tiendas, cajas, promociones y reportes.

Esta edición (branch `community-edition`) está pensada para que **tú** lo
hospedes: sin suscripciones, sin cobros, todas las funciones desbloqueadas.

## 🚀 Características

- **Ventas**: Interfaz de caja rápida e intuitiva, venta a granel, carrito
  sincronizado y display para cliente.
- **Inventario**: Control de stock, categorías, códigos de barras, QR y
  movimientos.
- **Multitienda**: Soporte para múltiples sucursales con aislamiento de datos
  entre tiendas.
- **Usuarios**: Roles y permisos (Super Admin, Admin, Gerente, Cajero).
- **Cajas**: Apertura/cierre de caja, movimientos y arqueos.
- **Promociones**: Descuentos simples, por cantidad, paquetes y por cuenta.
- **Reportes**: Estadísticas de ventas, movimientos y gráficas.
- **IA integrada** (opcional): análisis y edición de imágenes con
  Gemini/Stability — configurable en `api/ai/config.php`.
- **Extensible**: API REST con tokens para integraciones externas y agentes IA
  (tabla `api_tokens` ya incluida en el esquema).

## 🐳 Instalación con Docker (recomendada)

Requisito: Docker y Docker Compose.

```bash
git clone https://github.com/AngelDAL/Tomodachi.git
cd Tomodachi
git checkout community-edition
cp .env.example .env   # opcional: ajusta puerto/credenciales
docker compose up -d --build
```

**Todo es automático**: el entrypoint del contenedor espera a que la base de
datos esté lista, genera `config/database.php`, crea el esquema, aplica las
migraciones pendientes y carga los datos demo (si `SEED_DEMO=true`, el
default). **No es necesario copiar ni ejecutar ningún SQL a mano.**

Accede a **http://localhost:8080**

> Demo pública en **https://tomodachi.tabtap.dev** (Community Edition, datos
> demo: admin/admin123 o demo/demo123)

Credenciales iniciales:
- **Usuario**: `admin`
- **Contraseña**: `admin123`

> ⚠️ Cambia la contraseña del administrador inmediatamente después del primer
> inicio de sesión.

### Actualizaciones

Para actualizar a una versión nueva:

```bash
git pull
docker compose up -d --build
```

El entrypoint detecta automáticamente las **migraciones pendientes** de
`database/migrations/` (por ejemplo `001_add_product_image.sql`,
`013_create_api_tokens.sql`) y las aplica en orden numérico, registrando cada
una en la tabla `schema_migrations` para no re-ejecutarlas. **No hace falta
ejecutar SQL manualmente en las actualizaciones.** Si alguna migración no se
puede aplicar (p. ej. porque su cambio ya existía), se registra igualmente con
un aviso en los logs para no bloquear el arranque.

### Configuración vía variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `8080` | Puerto del host para la web |
| `DB_NAME` | `tomodachi_pos` | Nombre de la base de datos |
| `DB_USER` | `tomodachi` | Usuario de la BD |
| `DB_PASS` | `tomodachi_secret` | Contraseña de la BD |
| `APP_MODE` | `OPEN_SOURCE` | `OPEN_SOURCE` = todo desbloqueado; `SAAS` = planes freemium |
| `SEED_DEMO` | `true` | `true` = datos demo al primer arranque; `false` = instalación limpia |
| `TZ` | `America/Mexico_City` | Zona horaria |

Los datos (base de datos e imágenes subidas) persisten en volúmenes Docker:
`db_data` y `app_uploads`.

## 🎭 Datos de demostración

Con `SEED_DEMO=true` (default), el primer arranque carga además de los datos
base una tienda de ejemplo "Cafetería Demo" (store_id 2) con productos,
usuarios y ventas históricas para que puedas explorar el sistema:

- Tienda base: **admin / admin123** (tienda 1, con productos de ejemplo)
- Tienda demo: **demo / demo123** (tienda 2, con historial de ventas)

Con `SEED_DEMO=false` obtienes solo los datos base del esquema (tienda 1 +
admin).

## 🖥️ Uso

1. Acceda a la aplicación desde su navegador (ej. `http://localhost:8080`).
   Verá un **carrusel de presentación** con las características del sistema;
   la última diapositiva permite iniciar sesión o **crear una empresa nueva**
   (al registrarte se crea una empresa independiente con su propio
   inventario, ventas y equipo).
2. Credenciales por defecto: **admin / admin123**.
3. **¡Importante!** Cambie la contraseña del administrador inmediatamente
   después del primer inicio de sesión.

## 🌎 Formato regional (números, moneda y fechas por empresa)

Cada empresa puede configurar cómo se muestran los números, la moneda y las
fechas en **todo el sistema** (pantallas, tickets, reportes y PDF). Solo
afecta la presentación; los datos se guardan igual para todas las regiones.

**Configuración:** Perfil → Configuración de Empresa → **Formato Regional**.

**Presets rápidos:** México, Colombia, Estados Unidos, España, Argentina,
Japón y Brasil — un clic rellena todo y permite ajuste manual fino:

| País | Código | Ejemplo moneda | Fecha |
|---|---|---|---|
| México | MXN | `$1,234.56` | `13/08/2026 14:30` |
| Colombia | COP | `$1.235` (0 decimales) | `13/08/2026 14:30` |
| EE. UU. | USD | `$1,234.50` | `08/13/2026 2:30 PM` |
| España | EUR | `€1.234,50` | `13/08/2026 14:30` |
| Japón | JPY | `¥1,235` (0 decimales) | `2026-08-13 14:30` |

Campos configurables: código de moneda, símbolo editable (`¥`, `€`,
`COP $`...), posición del símbolo, separador de miles, separador de
decimales, decimales (0-4), formato de fecha y hora — con vista previa en
vivo.

Las cantidades (stock, vendidos, etc.) se muestran inteligentemente: los
enteros sin decimales (`3`, nunca `3.000`) y las fracciones sin ceros
finales (`3.25`). El formato visual **jamás** altera lo que se envía al
servidor: las consultas SQL y los inputs de fecha siempre usan ISO.

## 🛠️ Instalación manual (Apache/Nginx + PHP + MySQL)

Requisitos: PHP 8.0+, MySQL 8.0 / MariaDB 10.5+, extensiones PDO, pdo_mysql,
mbstring, curl.

1. Clona el repo y haz `git checkout community-edition`.
2. Importa el esquema base:
   ```bash
   mysql -u root -p < database/schema.sql
   ```
3. Aplica las migraciones en orden numérico (solo en instalación manual; en
   Docker esto es automático):
   ```bash
   for f in database/migrations/*.sql; do
     echo "Aplicando $f..."; mysql -u root -p tomodachi_pos < "$f"
   done
   ```
4. Copia y configura:
   ```bash
   cp config/database.php.example config/database.php
   cp config/mail.php.example config/mail.php
   ```
5. Instala dependencias PHP:
   ```bash
   composer install
   ```
6. Apunta el DocumentRoot de tu servidor web a la raíz del proyecto
   (el `.htaccess` redirige a `public/` y protege `config/`, `includes/` y
   `database/`).

## 🔌 API para agentes e integraciones

La API REST está documentada en [`docs/API.md`](docs/API.md). Los agentes de
IA que trabajen en el código deben leer [`AGENTS.md`](AGENTS.md) y
[`CLAUDE.md`](CLAUDE.md).

En la Community Edition las funciones de IA (`api/ai/*`), comandos de voz y
tokens de API están **fuera del alcance** (responden 403 en modo OPEN_SOURCE).
La filosofía: los agentes integran con la API documentada y credenciales
estándar.

## 🧪 Pruebas de seguridad realizadas

- Aislamiento multi-tienda: validación de `store_id` contra la sesión en
  ventas, cajas, inventario, usuarios y tiendas (protección contra IDOR).
- Endpoints de IA y utilidades protegidos con autenticación.
- Rate limit en formulario público de contacto.

## 📄 Licencia

Apache License 2.0. Ver el archivo `LICENSE`.
