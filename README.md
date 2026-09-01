# Tomodachi POS

Bienvenido. Tomodachi es un sistema de Punto de Venta (POS) web, open source
(Apache 2.0) y self-hosted, pensado para pequeños y medianos negocios. Está
listo para que lo pongas en marcha con Docker y lo dejes trabajando para tu
negocio.

## Qué ofrece

- **Caja rápida e intuitiva**: ventas por código de barras, QR o búsqueda
  instantánea; venta a granel, carrito sincronizado, múltiples métodos de pago
  y display para el cliente en tiempo real.
- **Inventario que se actualiza solo**: cada venta descuenta stock
  automáticamente; categorías, códigos de barras y QR, alertas de
  reabastecimiento y movimientos con historial completo.
- **Inventario por recetas (BOM)**: productos compuestos (recetas) con
  materias primas por presentaciones/lotes, consumo FIFO/LIFO/manual y
  disponibilidad y costo derivados de la composición.
- **Multitienda con aislamiento**: cada negocio opera con sus propios datos,
  aislado del resto (protección frente a accesos cruzados).
- **Control por roles**: Super Admin, Admin, Gerente y Cajero, con permisos
  según la labor de cada persona.
- **Cajas con arqueo**: apertura y cierre de caja, movimientos y diferencia
  calculada al cierre.
- **Promociones**: descuento simple, por cantidad, paquete y por cuenta.
- **Reportes y dashboard en tiempo real**: ventas, ganancias, productos más
  vendidos, stock bajo y gráficas.
- **Formato regional por empresa**: números, moneda y fechas configurables
  (México, Colombia, EE. UU., España, Japón y más) en pantallas, tickets y PDF.
- **Temas claro y oscuro, diseño adaptable**: buena experiencia en escritorio
  y en móvil.
- **API REST completa**, abierta para integraciones y agentes de IA.

## Instalación con Docker

Requisitos: Docker y Docker Compose.

```bash
git clone https://github.com/AngelDAL/Tomodachi.git
cd Tomodachi
cp .env.example .env        # opcional: puerto, credenciales, zona horaria
docker compose up -d --build
```

El contenedor prepara la base de datos, el esquema, las migraciones y el
servidor web automáticamente. Cuando termine, abre **http://localhost:8091** y
regístrate para crear tu negocio.

### Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `8091` | Puerto del host para la web |
| `DB_NAME` | `tomodachi_pos` | Nombre de la base de datos |
| `DB_USER` | `tomodachi` | Usuario de la BD |
| `DB_PASS` | `tomodachi_secret` | Contraseña de la BD |
| `APP_MODE` | `OPEN_SOURCE` | `OPEN_SOURCE` = todo habilitado; `SAAS` = planes freemium |
| `SEED_DEMO` | `false` | `true` = carga semilla inicial de prueba; `false` (default) = catálogo vacío |
| `TZ` | `America/Mexico_City` | Zona horaria |

Tu información (base de datos e imágenes) vive en los volúmenes Docker
`db_data` y `app_uploads`, por lo que sobrevive a los reconstruidos del
contenedor.

### Actualizaciones

```bash
git pull
docker compose up -d --build
```

El contenedor detecta y aplica automáticamente las migraciones pendientes,
registrándolas en la tabla `schema_migrations`. No hay que ejecutar SQL a
mano.

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
están apagadas por defecto y se habilitan con la clave del proveedor en el
despliegue gestionado.

Si vas a trabajar sobre el código del repositorio, lee antes
[`AGENTS.md`](AGENTS.md) y [`CLAUDE.md`](CLAUDE.md).

## Pruebas de seguridad realizadas

- **Aislamiento multi-tienda**: validación del `store_id` contra la sesión o
  token en ventas, cajas, inventario, usuarios y tiendas (protección frente a
  accesos cruzados).
- **Endpoints protegidos** por autenticación y por tokens con alcance.
- **Consultas parametrizadas** (PDO) para evitar inyección SQL.

## Licencia

Apache License 2.0. Consulta el archivo `LICENSE`.