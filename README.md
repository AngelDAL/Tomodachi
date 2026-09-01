# Tomodachi POS — Community Edition

Bienvenido. Tomodachi es un sistema de Punto de Venta (POS) web, open source
(Apache 2.0) y self-hosted, pensado para pequeños y medianos negocios. La rama
**Community Edition** está hecha para que **tú** lo implementes: sin
suscripciones, sin cobros y con todas las funciones desbloqueadas.

Este documento es tu guía para ponerlo en marcha con Docker, conocer sus
puntos fuertes e integrarlo con tus herramientas y con agentes de IA. Aquí
eres bienvenido a llevarlo a producción.

## Puntos fuertes

- **Caja rápida e intuitiva**: ventas por código de barras, QR o búsqueda
  instantánea; venta a granel, carrito sincronizado, múltiples métodos de pago
  y display para el cliente en tiempo real.
- **Inventario que se actualiza solo**: cada venta descuenta stock
  automáticamente; categorías, códigos de barras y QR, alertas de
  reabastecimiento y movimientos con historial completo.
- **Inventario por recetas (BOM)**: productos compuestos (recetas) con
  materias primas por presentaciones/lotes, consumo FIFO/LIFO/manual y
  disponibilidad y costo derivados de la composición.
- **Multitienda con aislamiento**: cada empresa opera con sus propios datos,
  aislada del resto (protección frente a accesos cruzados/IDOR).
- **Control por roles**: Super Admin, Admin, Gerente y Cajero, con permisos
  según la labor de cada persona.
- **Cajas con arqueo**: apertura y cierre de caja, movimientos y diferencia
  calculada al cierre.
- **Promociones**: descuento simple, por cantidad, paquete y por cuenta.
- **Reportes y dashboard en tiempo real**: ventas, ganancias, productos más
  vendidos, stock bajo y gráficas.
- **Formato regional por empresa**: números, moneda y fechas configurables
  (México, Colombia, EE. UU., España, Japón y más) en pantallas, tickets y PDF.
- **Temas claro y oscuro, diseño adaptable**: una buena experiencia en
  escritorio y en móvil.
- **API REST completa**, abierta para integraciones y agentes de IA.

## Instalación con Docker (la forma de hacerlo)

La aplicación corre en un contenedor Docker. **No existe instalación manual**:
desde el propio contenedor se monta todo — base de datos, esquema, migraciones
y servidor web — de forma automática.

Requisitos: Docker y Docker Compose.

```bash
git clone https://github.com/AngelDAL/Tomodachi.git
cd Tomodachi
cp .env.example .env        # opcional: ajusta puerto, credenciales, zona horaria
docker compose up -d --build
```

La rama por defecto del repositorio es `community-edition`, así que ya clonas
la versión correcta. En la primera subida, el contenedor:

1. Espera a que la base de datos esté lista.
2. Genera `config/database.php` a partir de las variables de entorno.
3. Crea el esquema completo.
4. Aplica las migraciones pendientes automáticamente.
5. Levanta Apache.

No hace falta copiar ni ejecutar SQL a mano: al terminar, entras a la app.

Accede a **http://localhost:8091** (o al puerto que definas en `.env`).

Credenciales iniciales:
- Usuario: `admin`
- Contraseña: `admin123`

> Cambia la contraseña del administrador justo después del primer inicio de
> sesión.

### Instalación limpia, sin datos de ejemplo

Por defecto la instalación es **limpia**: la tienda principal nace sin
productos ni categorías. Construyes el catálogo tú mismo (o con un agente de
IA a través de la API). En el primer acceso verás una breve presentación de
bienvenida, y a partir de ahí el resto de las personas van directo a la
pantalla de inicio de sesión.

Si quieres datos de ejemplo en tu máquina para explorar, usa `SEED_DEMO=true`
(ver variables de entorno).

### Configuración por variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `8091` | Puerto del host para la web |
| `DB_NAME` | `tomodachi_pos` | Nombre de la base de datos |
| `DB_USER` | `tomodachi` | Usuario de la BD |
| `DB_PASS` | `tomodachi_secret` | Contraseña de la BD |
| `APP_MODE` | `OPEN_SOURCE` | `OPEN_SOURCE` = todo desbloqueado; `SAAS` = planes freemium |
| `SEED_DEMO` | `false` | `true` = datos demo al primer arranque; `false` (default) = limpia |
| `TZ` | `America/Mexico_City` | Zona horaria |

Tu información (base de datos e imágenes) vive en los volúmenes Docker
`db_data` y `app_uploads`, por lo que sobrevive a los reconstruidos del
contenedor.

### Actualizaciones

```bash
git pull
docker compose up -d --build
```

El contenedor detecta y aplica solo las migraciones pendientes, registrándolas
en la tabla `schema_migrations`. No ejecutes SQL manual en las
actualizaciones.

## Agentes de IA e integraciones

Tomodachi expone una **API REST completa** para que la consumas desde otras
aplicaciones o desde un **agente de IA** (Claude Code, Codex, Cursor, Hermes
o el tuyo). Un agente puede leer el catálogo, crear productos, consultar
ventas o preparar reportes usando credenciales estándar, sin tocar la base de
datos.

Para empezar:

1. Genera un **API token** desde el panel Integraciones de la app (o mediante
   `api/api_tokens/create.php`), eligiendo permisos `read`, `write` o `custom`
   y su vigencia.
2. Autentica tus llamadas con el token (`Authorization: Bearer <token>`) o con
   la cookie de sesión.
3. Consulta la referencia de endpoints en [`docs/API.md`](docs/API.md): 91
   endpoints funcionales documentados.

Ejemplo:

```bash
# Crear un producto usando un token de escritura
curl -X POST ${BASE}/api/inventory/products.php \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"product_name":"Cafe","price":35.00}'
```

Las **funciones de IA de imágenes** (Stability AI y Google Gemini, `api/ai/*`)
están deshabilitadas en la Community Edition (responden 403) y se activan en
el plan gestionado (SAAS) con la clave del proveedor.

Si vas a trabajar sobre el código del repositorio, lee antes
[`AGENTS.md`](AGENTS.md) y [`CLAUDE.md`](CLAUDE.md).

## Pruebas de seguridad realizadas

- **Aislamiento multi-tienda**: validación del `store_id` contra la
  sesión/token en ventas, cajas, inventario, usuarios y tiendas (protección
  frente a IDOR).
- **Endpoints protegidos** por autenticación y por tokens con alcance.
- **Consultas parametrizadas** (PDO) para evitar inyección SQL.

## Licencia

Apache License 2.0. Consulta el archivo `LICENSE`.