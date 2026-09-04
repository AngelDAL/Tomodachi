# Módulo CoDi para Tomodachi POS

## Qué es

Módulo de pagos **CoDi (Cobro Digital)** del Banco de México para Tomodachi POS. Permite a los negocios aceptar pagos instantáneos con **cero comisiones** mediante códigos QR o notificaciones push a aplicaciones bancarias.

## Características

- ✅ **Pagos QR**: Genera códigos QR para que los clientes escaneen con su app bancaria
- ✅ **Notificaciones Push**: Envía solicitudes de pago directamente al celular del cliente
- ✅ **Confirmación en tiempo real**: Webhooks para recibir confirmaciones de Banxico
- ✅ **Modo Sandbox**: Funciona sin credenciales para pruebas
- ✅ **Auditoría completa**: Log de todas las transacciones
- ✅ **Multi-tenant**: Cada tienda tiene su propia configuración
- ✅ **Idempotencia**: Los webhooks no duplican pagos

## Endpoints API

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/codi/create_qr.php` | Generar pago QR |
| POST | `/api/codi/create_push.php` | Generar pago por push notification |
| GET | `/api/codi/check_status.php` | Consultar estado de pago |
| POST | `/api/codi/webhook.php` | Webhook para confirmaciones de Banxico |
| GET | `/api/codi/payments.php` | Listar pagos con filtros |
| POST | `/api/codi/cancel.php` | Cancelar un pago |
| GET/POST | `/api/codi/configure.php` | Configurar módulo |
| GET | `/api/codi/stats.php` | Estadísticas de pagos |

## Flujo de pago

```
1. Cajero selecciona "Pagar con CoDi" en el POS
2. Tomodachi solicita generar QR/Push → CoDi API
3. Cliente escanea QR o recibe notificación en su app bancaria
4. Cliente autoriza el pago desde su banco
5. Banxico notifica vía webhook → Tomodachi confirma el pago
6. (Opcional) Venta se marca como pagada automáticamente
```

## Instalación

### 1. Migración de base de datos

```bash
mysql -u root -p tomodachi_pos < codi/database/migrations/001_codi_tables.sql
```

### 2. Crear tablas

El script crea las siguientes tablas:
- `codi_payments` — Pagos CoDi
- `codi_payment_events` — Eventos del webhook
- `codi_settings` — Configuración por tienda
- `codi_audit_log` — Log de auditoría

### 3. Habilitar para una tienda

```bash
curl -X POST http://tu-dominio/api/codi/configure.php \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_TOKEN" \
  -d '{"enabled":true,"environment":"sandbox"}'
```

## Uso

### Generar pago QR

```bash
curl -X POST http://localhost:8091/api/codi/create_qr.php \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_TOKEN" \
  -d '{"amount":150.50,"concept":"Pago de tamales"}'
```

### Generar pago Push

```bash
curl -X POST http://localhost:8091/api/codi/create_push.php \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_TOKEN" \
  -d '{"amount":250.00,"concept":"Pago","phone":"5512345678"}'
```

## Estados de pago

| Estado | Significado |
|--------|-------------|
| `pending` | Solicitud creada, esperando generación |
| `generated` | QR/Push generado, esperando pago del cliente |
| `paid` | Pago confirmado por Banxico |
| `expired` | El pago expiró (default: 30 min) |
| `cancelled` | Cancelado por el comercio |
| `failed` | Error en el proceso de pago |

## Configuración en Producción

Para usar con Banxico real:

1. Registrarse en el [Portal de Desarrolladores CoDi de Banxico](https://www.codi.org.mx/)
2. Obtener certificados digitales (clave privada + certificado público)
3. Configurar proveedor de CoDi en `codi_settings`
4. Cambiar ambiente a `production`

### Usando la API de portfedh

```php
// En codi_settings o configuración
$codiConfig = [
    'provider' => 'portfedh',
    'provider_api_key' => 'tu_api_key',
    'provider_endpoint' => 'https://api.bite-size.mx',
];
```

## Seguridad

- Todas las peticiones API requieren token Bearer válido
- Los webhooks validan firma HMAC-SHA256
- Los datos sensibles (QR, folios) no se exponen en respuestas de error
- Auditoría completa de todas las operaciones
- Protección contra idempotencia en webhooks

## Estructura de archivos

```
codi/
├── includes/
│   └── CodiService.class.php    # Servicio principal
├── database/
│   └── migrations/
│       └── 001_codi_tables.sql  # Esquema de BD
└── README.md                    # Este archivo

api/codi/
├── create_qr.php                # POST - Generar QR
├── create_push.php              # POST - Generar push
├── check_status.php             # GET - Consultar estado
├── webhook.php                  # POST - Webhook Banxico
├── payments.php                 # GET - Listar pagos
├── cancel.php                   # POST - Cancelar pago
├── configure.php                # GET/POST - Configurar
└── stats.php                    # GET - Estadísticas
```

## Licencia

Apache License 2.0 (compatible con Tomadachi POS)
