#!/usr/bin/env bash
# Batería compuesta de Pantallas Digitales.
# Crea datos temporales en store 1, verifica reutilización real y limpia al salir.
set -euo pipefail

BASE_URL="${1:-http://localhost:8091}"
COOKIE="$(mktemp)"
TMP_DIR="$(mktemp -d)"
MASTER_BOARD=""
TARGET_BOARD=""
MASTER_SLIDE=""
ASSIGNMENT=""
ELEMENT=""
PASS=0
FAIL=0

cleanup() {
  if [[ -n "$TARGET_BOARD" ]]; then
    curl -s -b "$COOKIE" -X POST "$BASE_URL/api/digital_boards/delete.php" -H 'Content-Type: application/json' -d "{\"board_id\":$TARGET_BOARD}" >/dev/null || true
  fi
  if [[ -n "$MASTER_BOARD" ]]; then
    curl -s -b "$COOKIE" -X POST "$BASE_URL/api/digital_boards/delete.php" -H 'Content-Type: application/json' -d "{\"board_id\":$MASTER_BOARD}" >/dev/null || true
  fi
  rm -f "$COOKIE"
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

json_field() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
assert_success() {
  local label="$1" response="$2"
  if printf '%s' "$response" | python3 -c "import json,sys; raise SystemExit(0 if json.load(sys.stdin).get('success') else 1)"; then
    printf 'PASS | %s\n' "$label"; PASS=$((PASS+1))
  else
    printf 'FAIL | %s\n%s\n' "$label" "$response" >&2; FAIL=$((FAIL+1)); exit 1
  fi
}
assert_failure() {
  local label="$1" response="$2"
  if printf '%s' "$response" | python3 -c "import json,sys; raise SystemExit(0 if not json.load(sys.stdin).get('success') else 1)"; then
    printf 'PASS | %s\n' "$label"; PASS=$((PASS+1))
  else
    printf 'FAIL | %s\n%s\n' "$label" "$response" >&2; FAIL=$((FAIL+1)); exit 1
  fi
}

printf '\n===== Batería Pantallas Digitales — %s =====\n\n' "$BASE_URL"

LOGIN=$(curl -s -c "$COOKIE" -X POST "$BASE_URL/api/auth/login.php" -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}')
assert_success "Login admin" "$LOGIN"

MASTER=$(curl -s -b "$COOKIE" -X POST "$BASE_URL/api/digital_boards/create.php" -H 'Content-Type: application/json' -d '{"name":"QA Slide Maestra","orientation":"horizontal","is_active":1,"show_qr":0}')
assert_success "Crear board maestro" "$MASTER"
MASTER_BOARD=$(printf '%s' "$MASTER" | json_field "d['data']['board_id']")

SLIDE=$(curl -s -b "$COOKIE" -X POST "$BASE_URL/api/board_slides/create.php" -H 'Content-Type: application/json' -d "{\"board_id\":$MASTER_BOARD,\"title\":\"Promoción QA Reutilizable\",\"grid_cols\":1,\"grid_rows\":1}")
assert_success "Crear slide maestra" "$SLIDE"
MASTER_SLIDE=$(printf '%s' "$SLIDE" | json_field "d['data']['slide_id']")

CONTENT='{"presentation_type":"text","rect":{"x_pct":10,"y_pct":10,"w_pct":80,"h_pct":30},"text":"PROMOCIÓN QA ORIGINAL","text_size_pct":4,"text_color":"#ffffff","background_color":"#1a237e","text_pos_h":"center","text_pos_v":"middle"}'
ELEMENT_RESPONSE=$(curl -s -b "$COOKIE" -X POST "$BASE_URL/api/slide_elements/create.php" -H 'Content-Type: application/json' -d "{\"slide_id\":$MASTER_SLIDE,\"element_type\":\"text\",\"grid_col\":1,\"grid_row\":1,\"col_span\":1,\"row_span\":1,\"content\":$CONTENT}")
assert_success "Crear elemento maestro" "$ELEMENT_RESPONSE"
ELEMENT=$(printf '%s' "$ELEMENT_RESPONSE" | json_field "d['data']['element_id']")

TARGET=$(curl -s -b "$COOKIE" -X POST "$BASE_URL/api/digital_boards/create.php" -H 'Content-Type: application/json' -d '{"name":"QA Pantalla Reutilizada","orientation":"vertical","is_active":1,"show_qr":0}')
assert_success "Crear board destino" "$TARGET"
TARGET_BOARD=$(printf '%s' "$TARGET" | json_field "d['data']['board_id']")

LIBRARY=$(curl -s -b "$COOKIE" "$BASE_URL/api/slide_library/read.php")
printf '%s' "$LIBRARY" | python3 -c "import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if any(x['slide_id']==$MASTER_SLIDE for x in d['data']) else 1)"
printf 'PASS | Biblioteca incluye slide maestra\n'; PASS=$((PASS+1))

ASSIGN=$(curl -s -b "$COOKIE" -X POST "$BASE_URL/api/board_slide_assignments/assign.php" -H 'Content-Type: application/json' -d "{\"board_id\":$TARGET_BOARD,\"source_slide_id\":$MASTER_SLIDE}")
assert_success "Asignar slide a segunda pantalla" "$ASSIGN"
ASSIGNMENT=$(printf '%s' "$ASSIGN" | json_field "d['data']['assignment_id']")

DISPLAY=$(curl -s "$BASE_URL/api/digital_boards/get_board.php?board_id=$TARGET_BOARD")
printf '%s' "$DISPLAY" | python3 -c "import json,sys; d=json.load(sys.stdin); s=d['data']['slides']; raise SystemExit(0 if len(s)==1 and s[0]['slide_id']==$MASTER_SLIDE and s[0]['elements'][0]['content']['text']=='PROMOCIÓN QA ORIGINAL' else 1)"
printf 'PASS | Display público consume la referencia compartida\n'; PASS=$((PASS+1))

UPDATED_CONTENT='{"presentation_type":"text","rect":{"x_pct":10,"y_pct":10,"w_pct":80,"h_pct":30},"text":"PROMOCIÓN QA ACTUALIZADA","text_size_pct":4,"text_color":"#ffffff","background_color":"#1a237e","text_pos_h":"center","text_pos_v":"middle"}'
UPDATE=$(curl -s -b "$COOKIE" -X PUT "$BASE_URL/api/slide_elements/update.php" -H 'Content-Type: application/json' -d "{\"element_id\":$ELEMENT,\"content\":$UPDATED_CONTENT}")
assert_success "Actualizar slide maestra" "$UPDATE"
PROPAGATED=$(curl -s "$BASE_URL/api/digital_boards/get_board.php?board_id=$TARGET_BOARD")
printf '%s' "$PROPAGATED" | python3 -c "import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d['data']['slides'][0]['elements'][0]['content']['text']=='PROMOCIÓN QA ACTUALIZADA' else 1)"
printf 'PASS | Cambio maestro se propaga al board destino\n'; PASS=$((PASS+1))

# El admin de store 1 no puede usar una slide de la biblioteca de store 2.
DEMO_COOKIE="$(mktemp)"
DEMO_LOGIN=$(curl -s -c "$DEMO_COOKIE" -X POST "$BASE_URL/api/auth/login.php" -H 'Content-Type: application/json' -d '{"username":"demo","password":"demo123"}')
assert_success "Login demo para prueba cross-store" "$DEMO_LOGIN"
DEMO_LIBRARY=$(curl -s -b "$DEMO_COOKIE" "$BASE_URL/api/slide_library/read.php")
DEMO_SLIDE=$(printf '%s' "$DEMO_LIBRARY" | json_field "d['data'][0]['slide_id']")
CROSS_STORE=$(curl -s -b "$COOKIE" -X POST "$BASE_URL/api/board_slide_assignments/assign.php" -H 'Content-Type: application/json' -d "{\"board_id\":$TARGET_BOARD,\"source_slide_id\":$DEMO_SLIDE}")
assert_failure "Asignación cross-store rechazada" "$CROSS_STORE"
rm -f "$DEMO_COOKIE"

# Archivo PNG 1x1 para validar el endpoint multipart.
python3 - "$TMP_DIR/test.png" <<'PY'
import base64, sys
open(sys.argv[1], 'wb').write(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlN+YkAAAAASUVORK5CYII='))
PY
UPLOAD=$(curl -s -b "$COOKIE" -X POST "$BASE_URL/api/digital_boards/upload_media.php" -F "file=@$TMP_DIR/test.png;type=image/png")
assert_success "Subida multipart de imagen" "$UPLOAD"
UPLOAD_URL=$(printf '%s' "$UPLOAD" | json_field "d['data']['url']")
HTTP=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL$UPLOAD_URL")
[[ "$HTTP" == "200" ]] || { printf 'FAIL | Imagen subida no pública (HTTP %s)\n' "$HTTP"; exit 1; }
printf 'PASS | Imagen subida accesible públicamente\n'; PASS=$((PASS+1))

REMOVE=$(curl -s -b "$COOKIE" -X POST "$BASE_URL/api/board_slide_assignments/remove.php" -H 'Content-Type: application/json' -d "{\"assignment_id\":$ASSIGNMENT}")
assert_success "Retirar referencia sin borrar maestra" "$REMOVE"
SOURCE=$(curl -s -b "$COOKIE" "${BASE_URL}/api/slide_elements/read.php?slide_id=$MASTER_SLIDE")
assert_success "Slide maestra permanece tras retirar asignación" "$SOURCE"

printf '\n===== RESULTADO: %s pasaron, %s fallaron =====\n' "$PASS" "$FAIL"
