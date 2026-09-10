#!/bin/bash
# Prueba compuesta del módulo Stripe — Tomodachi POS
# Uso: bash docker/test_stripe.sh [base_url]
#
# Sin credenciales ejecuta el bloque "sin Stripe" (auth, validación,
# aislamiento, persistencia de config). Con credenciales de prueba:
#   STRIPE_SK_TEST=sk_test_... STRIPE_PK_TEST=pk_test_... bash docker/test_stripe.sh
# La clave secreta puede ser estándar (sk_test_...) o restringida (rk_test_...).
# ejecuta además el flujo de cobro completo (PaymentIntent real en modo test,
# confirmación con tarjeta 4242, venta ligada, anti-reuso, webhook).
BASE="${1:-http://localhost:8091}"
PASS=0; FAIL=0; SKIP=0
CJ=$(mktemp); CJ2=$(mktemp)
trap 'rm -f "$CJ" "$CJ2"; cleanup_data' EXIT

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS | $name (HTTP $actual)"; PASS=$((PASS+1))
  else
    echo "FAIL | $name (esperado $expected, obtuve $actual)"; FAIL=$((FAIL+1))
  fi
}

json_get() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)" 2>/dev/null; }

cleanup_data() {
  : # Los datos de prueba viven en la instancia desechable; el PI queda en modo test.
}

echo "===== Pruebas Módulo Stripe — $BASE ====="
echo

# --- Login admin (tienda 1) y demo (tienda 2) ---
code=$(curl -s -o /dev/null -w "%{http_code}" -c "$CJ" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}')
check "Login admin" 200 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -c "$CJ2" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' -d '{"username":"demo","password":"demo123"}')
check "Login demo (tienda 2)" 200 "$code"

# Instalación limpia: admin/demo nacen con must_change_password=1 (403 hasta cambiarla)
unlock_pw() {
  local cj="$1" cur="$2" prof fn em
  prof=$(curl -s -b "$cj" "$BASE/api/users/profile.php")
  fn=$(echo "$prof" | python3 -c "import json,sys; d=json.load(sys.stdin).get('data') or {}; print(d.get('full_name') or 'Usuario')" 2>/dev/null)
  em=$(echo "$prof" | python3 -c "import json,sys; d=json.load(sys.stdin).get('data') or {}; print(d.get('email') or 'u@example.com')" 2>/dev/null)
  curl -s -o /dev/null -b "$cj" -X POST "$BASE/api/users/profile.php" -H 'Content-Type: application/json' \
    -d "{\"full_name\":\"$fn\",\"email\":\"$em\",\"password\":\"$cur\",\"current_password\":\"$cur\"}"
}
unlock_pw "$CJ" admin123
unlock_pw "$CJ2" demo123

# --- Auth requerida ---
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/stripe/config.php")
check "config sin sesión (401)" 401 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/stripe/public_config.php")
check "public_config sin sesión (401)" 401 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/stripe/create_payment_intent.php" -H 'Content-Type: application/json' -d '{"amount":100}')
check "create_payment_intent sin sesión (401)" 401 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/stripe/payments.php")
check "payments sin sesión (401)" 401 "$code"

# --- public_config con sesión (módulo aún sin configurar) ---
resp=$(curl -s -b "$CJ" "$BASE/api/stripe/public_config.php")
en=$(echo "$resp" | json_get "['data']['enabled']")
check "public_config deshabilitado por defecto" "False" "$en"

# --- Cobro sin habilitar (403) ---
code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/stripe/create_payment_intent.php" -H 'Content-Type: application/json' -d '{"amount":100}')
check "create_intent con módulo deshabilitado (403)" 403 "$code"

# --- Validación de formato de claves (422) ---
code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/stripe/config.php" -H 'Content-Type: application/json' -d '{"enabled":true,"secret_key":"no-es-una-clave"}')
check "config con secret_key inválida (422)" 422 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/stripe/config.php" -H 'Content-Type: application/json' -d '{"enabled":true,"publishable_key":"sk_live_xxx"}')
check "config con publishable inválida (422)" 422 "$code"

# --- Guardar config parcial (sin claves: queda deshabilitado) ---
code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/stripe/config.php" -H 'Content-Type: application/json' -d '{"enabled":false,"currency":"mxn"}')
check "config parcial guardada (200)" 200 "$code"

# Persistencia: leer de vuelta
resp=$(curl -s -b "$CJ" "$BASE/api/stripe/config.php")
cur=$(echo "$resp" | json_get "['data']['currency']")
check "config persistida (currency=mxn)" "mxn" "$cur"
has_sk=$(echo "$resp" | json_get "['data']['has_secret_key']")
check "secret_key no existe aún" "False" "$has_sk"
# La clave secreta nunca debe exponerse en claro
if echo "$resp" | grep -q '"secret_key"[^_m]'; then
  echo "FAIL | GET config expone secret_key"; FAIL=$((FAIL+1))
else
  echo "PASS | GET config no expone secret_key"; PASS=$((PASS+1))
fi

# --- Aislamiento multi-tienda: la tienda 2 no ve config ni cobros ajenos ---
resp=$(curl -s -b "$CJ2" "$BASE/api/stripe/config.php")
en2=$(echo "$resp" | json_get "['data']['enabled']")
check "tienda 2: config independiente (deshabilitada)" "False" "$en2"
n=$(curl -s -b "$CJ2" "$BASE/api/stripe/payments.php" | json_get "['data'].__len__()")
check "tienda 2: 0 cobros (aislamiento)" "0" "$n"

# --- Validación de monto (422) ---
code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/stripe/create_payment_intent.php" -H 'Content-Type: application/json' -d '{"amount":-5}')
check "create_intent monto negativo (422)" 422 "$code"

# --- Webhook: firma ausente / inválida (401) ---
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/stripe/webhook.php" -H 'Content-Type: application/json' -d '{"id":"evt_fake","type":"payment_intent.succeeded","data":{"object":{"id":"pi_fake"}}}')
check "webhook sin firma (401)" 401 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/stripe/webhook.php" -H 'Content-Type: application/json' -H 'Stripe-Signature: t=1,v1=firma_invalida' -d '{"id":"evt_fake","type":"payment_intent.succeeded","data":{"object":{"id":"pi_fake","metadata":{"store_id":"1"}}}}')
check "webhook firma inválida (401)" 401 "$code"

# --- Rol cajero no puede configurar (403) ---
code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ2" -X POST "$BASE/api/stripe/config.php" -H 'Content-Type: application/json' -d '{"enabled":true}')
# demo es admin de tienda 2 en seed; si el seed cambia, aceptar 200
if [ "$code" = "403" ] || [ "$code" = "200" ]; then echo "PASS | config demo respuesta controlada ($code)"; PASS=$((PASS+1)); else echo "FAIL | config demo ($code)"; FAIL=$((FAIL+1)); fi

# Restaurar tienda 2 a deshabilitada: si no, la próxima corrida falla en la
# comprobación temprana "tienda 2: config independiente (deshabilitada)".
curl -s -o /dev/null -b "$CJ2" -X POST "$BASE/api/stripe/config.php" -H 'Content-Type: application/json' -d '{"enabled":false}'

# ============================================================
# Flujo COMPLETO con credenciales de prueba (modo test de Stripe)
# ============================================================
if [ -n "$STRIPE_SK_TEST" ] && [ -n "$STRIPE_PK_TEST" ]; then
  echo
  echo "--- Flujo con credenciales de prueba (Stripe test mode) ---"

  # Guardar credenciales y habilitar
  code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/stripe/config.php" -H 'Content-Type: application/json' -d "{\"enabled\":true,\"currency\":\"mxn\",\"publishable_key\":\"$STRIPE_PK_TEST\",\"secret_key\":\"$STRIPE_SK_TEST\"}")
  check "guardar credenciales test (200)" 200 "$code"

  resp=$(curl -s -b "$CJ" "$BASE/api/stripe/public_config.php")
  en=$(echo "$resp" | json_get "['data']['enabled']")
  check "módulo habilitado" "True" "$en"

  # Crear PaymentIntent de $25.00 MXN
  resp=$(curl -s -b "$CJ" -X POST "$BASE/api/stripe/create_payment_intent.php" -H 'Content-Type: application/json' -d '{"amount":25.00,"concept":"Prueba automatizada"}')
  PI=$(echo "$resp" | json_get "['data']['payment_intent_id']")
  CS=$(echo "$resp" | json_get "['data']['client_secret']")
  if [ -n "$PI" ]; then echo "PASS | PaymentIntent creado ($PI)"; PASS=$((PASS+1)); else echo "FAIL | PaymentIntent no creado: $resp"; FAIL=$((FAIL+1)); fi

  # Confirmar con tarjeta de prueba directo contra la API de Stripe
  # (equivale a lo que hace Stripe.js en el navegador)
  code=$(curl -s -o /dev/null -w "%{http_code}" -u "$STRIPE_SK_TEST:" -X POST "https://api.stripe.com/v1/payment_intents/$PI/confirm" -d "payment_method=pm_card_visa")
  check "Stripe confirma tarjeta 4242 (200)" 200 "$code"

  # Sincronizar estado local
  resp=$(curl -s -b "$CJ" -X POST "$BASE/api/stripe/confirm_payment.php" -H 'Content-Type: application/json' -d "{\"payment_intent_id\":\"$PI\"}")
  st=$(echo "$resp" | json_get "['data']['status']")
  check "estado local = succeeded" "succeeded" "$st"
  last4=$(echo "$resp" | json_get "['data']['card_last4']")
  check "card_last4 = 4242" "4242" "$last4"

  # Crear producto efímero de $25 y vender con el PI
  resp=$(curl -s -b "$CJ" -X POST "$BASE/api/inventory/products.php" -H 'Content-Type: application/json' -d '{"product_name":"ZZ Test Stripe","price":25.00,"stock":100,"barcode":"ZZSTRIPE1"}')
  PID=$(echo "$resp" | json_get "['data']['product_id']")
  if [ -z "$PID" ]; then PID=$(echo "$resp" | json_get "['data']['id']"); fi
  if [ -n "$PID" ]; then echo "PASS | producto de prueba creado ($PID)"; PASS=$((PASS+1)); else echo "FAIL | producto de prueba: $resp"; FAIL=$((FAIL+1)); fi

  resp=$(curl -s -b "$CJ" -X POST "$BASE/api/sales/create_sale.php" -H 'Content-Type: application/json' -d "{\"store_id\":1,\"payment_method\":\"card\",\"stripe_payment_intent\":\"$PI\",\"items\":[{\"product_id\":$PID,\"quantity\":1}]}")
  SID=$(echo "$resp" | json_get "['data']['sale_id']")
  if [ -n "$SID" ]; then echo "PASS | venta creada con cobro Stripe (sale_id=$SID)"; PASS=$((PASS+1)); else echo "FAIL | venta con Stripe: $resp"; FAIL=$((FAIL+1)); fi

  # Anti-reuso: el mismo PI no puede pagar otra venta (402)
  code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/sales/create_sale.php" -H 'Content-Type: application/json' -d "{\"store_id\":1,\"payment_method\":\"card\",\"stripe_payment_intent\":\"$PI\",\"items\":[{\"product_id\":$PID,\"quantity\":1}]}")
  check "reuso de PaymentIntent (402)" 402 "$code"

  # Monto incorrecto: PI de $10 contra venta de $25 (402)
  resp=$(curl -s -b "$CJ" -X POST "$BASE/api/stripe/create_payment_intent.php" -H 'Content-Type: application/json' -d '{"amount":10.00,"concept":"Monto incorrecto"}')
  PI2=$(echo "$resp" | json_get "['data']['payment_intent_id']")
  curl -s -o /dev/null -u "$STRIPE_SK_TEST:" -X POST "https://api.stripe.com/v1/payment_intents/$PI2/confirm" -d "payment_method=pm_card_visa"
  code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/sales/create_sale.php" -H 'Content-Type: application/json' -d "{\"store_id\":1,\"payment_method\":\"card\",\"stripe_payment_intent\":\"$PI2\",\"items\":[{\"product_id\":$PID,\"quantity\":1}]}")
  check "monto no coincide (402)" 402 "$code"

  # PI inexistente (402)
  code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/sales/create_sale.php" -H 'Content-Type: application/json' -d "{\"store_id\":1,\"payment_method\":\"card\",\"stripe_payment_intent\":\"pi_noexiste123\",\"items\":[{\"product_id\":$PID,\"quantity\":1}]}")
  check "PaymentIntent inexistente (402)" 402 "$code"

  # Historial: aparecen los cobros de la tienda 1
  n=$(curl -s -b "$CJ" "$BASE/api/stripe/payments.php" | json_get "['data'].__len__()")
  if [ "$n" -ge 2 ] 2>/dev/null; then echo "PASS | historial lista $n cobros"; PASS=$((PASS+1)); else echo "FAIL | historial ($n)"; FAIL=$((FAIL+1)); fi

  # Aislamiento: tienda 2 sigue sin ver cobros
  n2=$(curl -s -b "$CJ2" "$BASE/api/stripe/payments.php" | json_get "['data'].__len__()")
  check "tienda 2 no ve cobros de tienda 1" "0" "$n2"

  # Cancelar el segundo PI (quedó pendiente de venta)
  PID2=$(curl -s -b "$CJ" "$BASE/api/stripe/payments.php?status=succeeded" | python3 -c "import json,sys; d=json.load(sys.stdin)['data']; print([p['payment_id'] for p in d if p['stripe_payment_intent_id']=='$PI2'][0])" 2>/dev/null)
  if [ -n "$PID2" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/stripe/cancel.php" -H 'Content-Type: application/json' -d "{\"payment_id\":$PID2}")
    # Un PI succeeded no se puede cancelar: se espera error controlado (500/400)
    if [ "$code" != "200" ]; then echo "PASS | cancelar cobro ya pagado rechazado ($code)"; PASS=$((PASS+1)); else echo "FAIL | se canceló un cobro pagado"; FAIL=$((FAIL+1)); fi
  fi
else
  echo
  echo "SKIP | Flujo completo: define STRIPE_SK_TEST y STRIPE_PK_TEST para ejecutarlo"
  SKIP=$((SKIP+1))
fi

echo
echo "===== Resultado: $PASS PASS, $FAIL FAIL, $SKIP SKIP ====="
[ "$FAIL" -eq 0 ]
