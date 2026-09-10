# Módulo Stripe para Tomodachi POS

Módulo externo de cobro con tarjeta vía **Stripe** (Payment Intents).
El cajero cobra en el Punto de Venta con un formulario de tarjeta seguro
renderizado por Stripe.js: **los datos de la tarjeta nunca tocan el servidor
de Tomodachi** (cumplimiento PCI SAQ-A).

## Características (v1)

- Cobro con tarjeta desde el POS (método de pago "Tarjeta en línea (Stripe)").
- Configuración por tienda desde **Integraciones**: solo pegar las claves
  `pk_...` / `sk_...` y habilitar.
- Verificación de cobros del lado del servidor contra la API de Stripe antes
  de registrar la venta (estado `succeeded` + monto exacto calculado en
  servidor).
- Webhook con verificación de firma e idempotencia.
- Cancelación de cobros pendientes, historial de cobros, log de auditoría.
- Soporte de monedas (MXN por defecto) incluyendo monedas sin decimales.

## Requisitos

1. Cuenta de Stripe (https://dashboard.stripe.com/register).
2. Claves de API (Dashboard → Developers → API keys):
   - Pruebas: `pk_test_...` / `sk_test_...`
   - Producción: `pk_live_...` / `sk_live_...`
3. Docker con la imagen reconstruida (el SDK `stripe/stripe-php` se instala
   vía Composer en el build). Si actualizas una instalación existente,
   reconstruye con `docker compose up -d --build` para aplicar la migración
   `036_stripe.sql` y el SDK.

## Configuración (2 minutos)

1. Entra a **Integraciones → Cobros con tarjeta (Stripe)** (solo admin).
2. Pega la **clave pública** (`pk_...`) y la **clave secreta** (`sk_...`).
3. Elige la moneda y marca **Habilitar cobros con Stripe**.
4. (Recomendado) En Stripe → Developers → Webhooks, registra el endpoint
   `https://TU-DOMINIO/api/stripe/webhook.php` con los eventos
   `payment_intent.succeeded`, `payment_intent.payment_failed` y
   `payment_intent.canceled`, y pega la firma (`whsec_...`) en el módulo.
   - En desarrollo local el webhook no es alcanzable por Stripe; el POS
     sincroniza el estado consultando Stripe directamente tras cada cobro,
     así que no es obligatorio para cobrar.
5. Listo: en el Punto de Venta aparece el método **Tarjeta en línea
   (Stripe)**. Selecciónalo, pulsa COBRAR, captura la tarjeta y confirma.

Tarjeta de prueba de Stripe: `4242 4242 4242 4242`, cualquier fecha futura,
CVC y CP. Requiere HTTPS o `localhost` (restricción de Stripe.js).

## Arquitectura

```
stripe/
├── includes/StripeService.class.php   # Lógica del módulo (SDK stripe-php)
└── README.md

api/stripe/
├── config.php                 # GET/POST credenciales (admin; sk enmascarada)
├── public_config.php          # GET config pública para el POS (pk, moneda)
├── create_payment_intent.php  # POST crea PaymentIntent (cajero+)
├── confirm_payment.php        # POST sincroniza estado consultando Stripe
├── payments.php               # GET historial de cobros
├── cancel.php                 # POST cancelar cobro pendiente (admin/manager)
└── webhook.php                # POST webhook Stripe (firma + idempotencia)
```

Base de datos (migración `database/migrations/036_stripe.sql`, incluida en
`database/schema.sql` para instalaciones nuevas):

- `stripe_settings` — credenciales y configuración por tienda.
- `stripe_payments` — un registro por PaymentIntent (con `sale_id` ligado).
- `stripe_payment_events` — eventos de webhook (idempotencia por `evt_...`).
- `stripe_audit_log` — auditoría de operaciones (sin datos sensibles).
- `sales.stripe_payment_id` — vínculo venta ↔ cobro.

## Flujo de cobro (POS)

```
Cajero elige "Tarjeta en línea (Stripe)" → COBRAR
  → POS: POST api/stripe/create_payment_intent.php {amount: total}
      ← {client_secret, publishable_key, payment_intent_id}
  → Navegador: Stripe.js Payment Element captura la tarjeta y la confirma
  → POS: POST api/sales/create_sale.php {payment_method: "card",
         stripe_payment_intent: "pi_...", items, ...}
      ← el servidor verifica el PaymentIntent contra Stripe
        (succeeded + monto exacto + tienda + sin reuso) → 402 si falla
  → Venta registrada y ligada (sales.stripe_payment_id)
```

## Seguridad

- La clave secreta jamás sale del servidor: GET la devuelve enmascarada
  (`sk_live****1234`) y solo sirve para confirmar que existe.
- Multi-tienda: todo cobro se valida contra la tienda de la sesión/token.
- Anti-reuso: un PaymentIntent solo puede ligarse a una venta; el monto se
  compara en centavos contra el total calculado en el servidor.
- Webhook: firma verificada con `\Stripe\Webhook::constructEvent` antes de
  procesar; eventos repetidos se descartan (UNIQUE por `stripe_event_id`).
- Los endpoints siguen el patrón `ApiAuth`: sesión (roles) o token Bearer
  (scopes `read`/`write`).

## Pruebas

Con la instancia corriendo (`docker compose up -d --build`):

```bash
# Suite base del proyecto
bash docker/test_suite.sh http://localhost:8091

# Prueba del módulo Stripe (requiere sk_test_... como variable de entorno)
STRIPE_SK_TEST=sk_test_... STRIPE_PK_TEST=pk_test_... \
  bash docker/test_stripe.sh http://localhost:8091
```

## Limitaciones v1

- Devoluciones: `refund_sale.php` registra la devolución en Tomodachi pero
  NO reembolsa el cargo en Stripe (hacerlo manual desde el Dashboard).
- Terminales físicas (Stripe Terminal / lectores) no soportadas: el cobro es
  en línea con captura manual de tarjeta.
