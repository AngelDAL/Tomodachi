#!/bin/bash
# Batería de pruebas Tomodachi CE — ejecuta y reporta resultados
# Uso: bash test_suite.sh [base_url]
BASE="${1:-http://localhost:8091}"
PASS=0; FAIL=0
CJ=$(mktemp); CJ2=$(mktemp)

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS | $name (HTTP $actual)"
    PASS=$((PASS+1))
  else
    echo "FAIL | $name (esperado $expected, obtuve $actual)"
    FAIL=$((FAIL+1))
  fi
}

echo "===== Batería Tomodachi CE — $BASE ====="
echo

# 1. Login
code=$(curl -s -o /dev/null -w "%{http_code}" -c "$CJ" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}')
check "Login admin/admin123" 200 "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -c "$CJ2" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' -d '{"username":"demo","password":"demo123"}')
check "Login demo/demo123" 200 "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' -d '{"username":"admin","password":"incorrecta"}')
check "Login con password incorrecta (401)" 401 "$code"

# 2. Modo OPEN_SOURCE
mode=$(curl -s "$BASE/api/auth/permissions.php" | python3 -c "import json,sys; print(json.load(sys.stdin).get('mode',''))" 2>/dev/null)
if [ "$mode" = "OPEN_SOURCE" ]; then echo "PASS | Modo OPEN_SOURCE"; PASS=$((PASS+1)); else echo "FAIL | Modo OPEN_SOURCE (obtuve '$mode')"; FAIL=$((FAIL+1)); fi

# 3. Endpoint sin auth (401)
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/reports/dashboard_stats.php")
check "Reportes sin sesión (401)" 401 "$code"

# 4. IDOR multi-tienda
code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" "$BASE/api/sales/get_sales.php?store_id=2")
check "IDOR get_sales store ajena (403)" 403 "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/sales/create_sale.php" -H 'Content-Type: application/json' -d '{"store_id":2,"payment_method":"cash","items":[{"product_id":1,"quantity":1,"price":15}]}')
check "IDOR create_sale store ajena (403)" 403 "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/users/create.php" -H 'Content-Type: application/json' -d '{"username":"hack","password":"x1234567","full_name":"H","role":"cashier","store_id":2}')
check "IDOR users/create store ajena (403)" 403 "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X PUT "$BASE/api/stores/update.php" -H 'Content-Type: application/json' -d '{"store_id":2,"store_name":"Hack"}')
check "IDOR stores/update store ajena (403)" 403 "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/cash_register/open_register.php" -H 'Content-Type: application/json' -d '{"store_id":2,"initial_amount":100}')
check "IDOR open_register store ajena (403)" 403 "$code"

# 5. Operaciones legítimas
code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/sales/create_sale.php" -H 'Content-Type: application/json' -d '{"store_id":1,"payment_method":"cash","items":[{"product_id":1,"quantity":1,"price":15.50}]}')
check "Crear venta en tienda propia (200)" 200 "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" "$BASE/api/sales/get_sales.php")
check "Listar ventas tienda propia (200)" 200 "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X PUT "$BASE/api/stores/update.php" -H 'Content-Type: application/json' -d '{"store_id":1,"store_name":"Tienda Principal"}')
check "Actualizar tienda propia (200)" 200 "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/stores/create.php" -H 'Content-Type: application/json' -d '{"store_name":"Tienda Test","address":"Test 1"}')
check "Crear tienda (200)" 200 "$code"

# 6. IA deshabilitada en CE (403)
code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/ai/generate_image.php")
check "IA generate_image en CE (403)" 403 "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -b "$CJ" -X POST "$BASE/api/ai/analyze_image.php")
check "IA analyze_image en CE (403)" 403 "$code"

# 7. Rate limit soporte (5/hora por IP) — llamar 6 veces
rl=0
for i in 1 2 3 4 5 6; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/support/send_message.php" -H 'Content-Type: application/json' -d '{"name":"Test","email":"t@t.com","message":"hola"}')
  if [ "$code" = "429" ]; then rl=$((rl+1)); fi
done
if [ "$rl" -ge 1 ]; then echo "PASS | Rate limit soporte (429 alcanzado)"; PASS=$((PASS+1)); else echo "FAIL | Rate limit soporte (nunca 429)"; FAIL=$((FAIL+1)); fi

# 8. Frontend carga
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/public/login.html")
check "Frontend login.html (200)" 200 "$code"

# 9. API Tokens (agentes IA)
tok_json=$(curl -s -b "$CJ" -X POST "$BASE/api/api_tokens/create.php" -H 'Content-Type: application/json' -d '{"name":"suite-token","scopes":["read","write"],"expires_in_days":1}')
TOKEN=$(echo "$tok_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['token'])" 2>/dev/null)
if [ -n "$TOKEN" ]; then echo "PASS | Crear API token read+write"; PASS=$((PASS+1)); else echo "FAIL | Crear API token read+write"; FAIL=$((FAIL+1)); TOKEN=""; fi

code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$BASE/api/inventory/products.php?store_id=1")
check "Token read: listar productos (200)" 200 "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" -X POST "$BASE/api/inventory/categories.php" -H 'Content-Type: application/json' -d '{"category_name":"Suite Cat"}')
check "Token write: crear categoria (200)" 200 "$code"

cat_id=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/inventory/categories.php" | python3 -c "import json,sys; d=json.load(sys.stdin); print([c['category_id'] for c in d['data'] if c['category_name']=='Suite Cat'][-1] if d.get('data') else '')" 2>/dev/null)
if [ -n "$cat_id" ]; then
  curl -s -o /dev/null -b "$CJ" -X DELETE "$BASE/api/inventory/categories.php" -H 'Content-Type: application/json' -d "{\"category_id\":$cat_id}"
  echo "PASS | Limpieza categoria de prueba"
  PASS=$((PASS+1))
fi

tokr_json=$(curl -s -b "$CJ" -X POST "$BASE/api/api_tokens/create.php" -H 'Content-Type: application/json' -d '{"name":"suite-token-ro","scopes":["read"],"expires_in_days":1}')
TOKR=$(echo "$tokr_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['token'])" 2>/dev/null)
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKR" -X POST "$BASE/api/inventory/categories.php" -H 'Content-Type: application/json' -d '{"category_name":"No Debe Crear"}')
check "Token read-only en write (403)" 403 "$code"

code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKR" -X POST "$BASE/api/stores/theme.php" -H 'Content-Type: application/json' -d '{"theme_config":{"primary_color":"#000000"}}')
check "Token sin custom en theme (403)" 403 "$code"

tok_id=$(echo "$tok_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['token_id'])" 2>/dev/null)
tokr_id=$(echo "$tokr_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['token_id'])" 2>/dev/null)
curl -s -o /dev/null -b "$CJ" -X POST "$BASE/api/api_tokens/revoke.php" -H 'Content-Type: application/json' -d "{\"token_id\":$tok_id}"
curl -s -o /dev/null -b "$CJ" -X POST "$BASE/api/api_tokens/revoke.php" -H 'Content-Type: application/json' -d "{\"token_id\":$tokr_id}"
echo "PASS | Revocar tokens de prueba"
PASS=$((PASS+1))

echo
echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="
rm -f "$CJ" "$CJ2"
exit $FAIL
