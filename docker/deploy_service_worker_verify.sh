#!/usr/bin/env bash
# Runbook de despliegue + puerta + rollback del service worker (TAB-36).
#
# Lo ejecuta el ORQUESTADOR (es quien tiene el socket de Docker). Un agente del
# sandbox NO puede: `docker ps` -> permission denied, y la regla del repo prohíbe
# que un agente recree contenedores o toque volúmenes.
#
# Uso:
#   bash docker/deploy_service_worker_verify.sh --verify-only
#       Solo mide lo que está desplegado: sello sha256 del sw.js servido + la
#       puerta del service worker. No toca Docker. (modo seguro, sin privilegios)
#
#   bash docker/deploy_service_worker_verify.sh --apply
#       Snapshot de la imagen viva -> build -> up -d app -> readiness -> puerta.
#       Si la puerta falla, REVIERTE solo (retag del snapshot + up -d) y vuelve a
#       verificar el rollback. Nunca hace `down -v`: los volúmenes (db_data,
#       app_uploads, app_sessions, signage_uploads) no se tocan.
#
# Contexto (TAB-35/TAB-36): `public/sw.js` declaraba en el precache dos CSS
# inexistentes (`finance.css`, `reports.css`). Como `cache.addAll()` es atómico,
# un solo 404 tumbaba el `install` y el service worker NUNCA se activaba
# (0 registros, `controller` null). El commit d19eec2 quita las rutas fantasma y
# pasa a `cache.add()` + `Promise.allSettled`.
#
# Puerta de aceptación (criterios de TAB-36):
#   - `getRegistrations()` >= 1 con `active` no nulo tras la SEGUNDA carga
#   - `navigator.serviceWorker.controller` no es null
#   - `caches.keys()` incluye `tomodachi-cache-v5` con los 19 activos declarados
#   - cero 404 de precache
#   - la suite sale con código 0
#   - el `sw.js` servido es el del commit objetivo (sello sha256)
#
# Variables (con default; override por env):
#   BASE_URL        origen a probar        (default http://127.0.0.1:${PORT:-8091})
#   PAGE            página de la prueba    (default /public/sales.html)
#   REV_TARGET      revisión objetivo      (default d19eec2)
#   SW_SHA_TARGET   sha256 esperado de public/sw.js tras el deploy
#   SW_SHA_ROLLBACK sha256 de public/sw.js del rollback (17359c6, lo que sirve
#                   hoy la instancia viva)
set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT:-8091}}"
PAGE="${PAGE:-/public/sales.html}"
REV_TARGET="${REV_TARGET:-d19eec2}"
SW_SHA_TARGET="${SW_SHA_TARGET:-92bf5b415c1fbc3f2a3f3109e0d62832e2dfe7ef2891978177ba46e5d1c5cccc}"
SW_SHA_ROLLBACK="${SW_SHA_ROLLBACK:-2706277485e09c77a4c8faa87fe026b3aa2e4b068f36798c3164a0ec6e0d07f9}"
IMAGE_TAG="ghcr.io/angeldal/tomodachi:latest"
OUT="${OUT:-${PAPERCLIP_RUN_SCRATCH_DIR:-/tmp}/sw_deploy_$$}"

MODE="${1:---verify-only}"
case "$MODE" in
  --verify-only|--apply) ;;
  *) echo "uso: $0 [--verify-only|--apply]" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$OUT"

ok()   { printf 'PASS | %s\n' "$*"; }
bad()  { printf 'FAIL | %s\n' "$*"; }
info() { printf 'info | %s\n' "$*"; }

# ---------------------------------------------------------------- 1. preflight
echo "===== Runbook service worker — $MODE ====="
info "origen: $BASE_URL$PAGE   commit objetivo: $REV_TARGET   salida: $OUT"

SERVED_SHA="$(curl -fsS -m 15 "$BASE_URL/public/sw.js" 2>/dev/null | sha256sum | cut -d' ' -f1)"
if [ -z "${SERVED_SHA:-}" ]; then
  bad "no pude leer $BASE_URL/public/sw.js — ¿instancia caída o puerta equivocada?"
  exit 2
fi
info "sw.js servido, sha256: $SERVED_SHA"

case "$SERVED_SHA" in
  "$SW_SHA_TARGET")   info "el servicio YA sirve el commit objetivo"; YA_DESPLEGADO=1 ;;
  "$SW_SHA_ROLLBACK") info "el servicio sirve los bytes pre-fix (rollback 17359c6)"; YA_DESPLEGADO=0 ;;
  *)                  info "el sw.js servido no coincide con ninguno de los dos sellos conocidos"; YA_DESPLEGADO=0 ;;
esac

# Sello del árbol local (si git está utilizable). El git del PATH en el sandbox
# es un shim: si falla, se sigue con los sellos por env.
LOCAL_SHA="$(git -C "$ROOT" show "$REV_TARGET:public/sw.js" 2>/dev/null | sha256sum | cut -d' ' -f1 || true)"
if [ -n "${LOCAL_SHA:-}" ]; then
  if [ "$LOCAL_SHA" = "$SW_SHA_TARGET" ]; then ok "sellos coherentes: $REV_TARGET:public/sw.js = $SW_SHA_TARGET"
  else bad "el árbol local de $REV_TARGET da $LOCAL_SHA, esperaba $SW_SHA_TARGET"; fi
fi

# ------------------------------------------------------- 2. puerta (cualquier modo)
echo
echo "----- puerta del service worker (debe salir 0 tras el deploy) -----"
bash "$ROOT/docker/test_service_worker.sh" "$BASE_URL" "$PAGE" --json "$OUT/gate.json" \
  2>&1 | tee "$OUT/gate.txt"
GATE_RC="${PIPESTATUS[0]}"
echo "código de la puerta: $GATE_RC"

if [ "$MODE" = "--verify-only" ]; then
  echo
  if [ "$GATE_RC" -eq 0 ] && [ "$SERVED_SHA" = "$SW_SHA_TARGET" ]; then
    ok "instancia desplegada y verificada ($REV_TARGET)"; exit 0
  fi
  bad "la instancia viva NO está en el estado objetivo (puerta=$GATE_RC, sha=$SERVED_SHA)"
  info "falta el rebuild: el orquestador corre  bash docker/deploy_service_worker_verify.sh --apply"
  exit 1
fi

# ------------------------------------------------------------------ 3. apply
echo
echo "----- apply: snapshot -> build -> up -d app -> readiness -> puerta -----"
if ! command -v docker >/dev/null 2>&1; then bad "no hay docker en el PATH"; exit 2; fi
if ! docker compose version >/dev/null 2>&1; then bad "no hay 'docker compose'"; exit 2; fi
if ! docker ps >/dev/null 2>&1; then bad "sin permiso al socket de Docker"; exit 2; fi

# Rollback pin: el id de imagen que está sirviendo AHORA. Es la ruta de reversión.
PREV_IMAGE_ID="$(docker compose -f "$ROOT/docker-compose.yml" images -q app 2>/dev/null | head -1 || true)"
if [ -z "${PREV_IMAGE_ID:-}" ]; then
  PREV_IMAGE_ID="$(docker image inspect -f '{{.Id}}' "$IMAGE_TAG" 2>/dev/null || true)"
fi
if [ -n "${PREV_IMAGE_ID:-}" ]; then
  docker image tag "$PREV_IMAGE_ID" tomodachi-rollback:sw >/dev/null 2>&1 \
    && ok "rollback pin: $PREV_IMAGE_ID retag como tomodachi-rollback:sw"
else
  bad "no pude fijar la imagen previa: el rollback quedaría a ciegas"; exit 2
fi
echo "$PREV_IMAGE_ID" > "$OUT/rollback_image_id.txt"

rollback() {
  echo
  echo "----- ROLLBACK -----"
  if [ -n "${PREV_IMAGE_ID:-}" ]; then
    docker image tag tomodachi-rollback:sw >/dev/null 2>&1 || true
    docker tag tomodachi-rollback:sw "$IMAGE_TAG" >/dev/null 2>&1 || true
    ( cd "$ROOT" && docker compose up -d app ) || true
    local roll_rc=0
    bash "$ROOT/docker/test_service_worker.sh" "$BASE_URL" "$PAGE" --expect fail \
      --json "$OUT/gate_rollback.json" 2>&1 | tee "$OUT/gate_rollback.txt" || roll_rc=$?
    local now_sha; now_sha="$(curl -fsS -m 15 "$BASE_URL/public/sw.js" | sha256sum | cut -d' ' -f1)"
    info "sw.js tras el rollback: $now_sha (esperado $SW_SHA_ROLLBACK)"
    if [ "$roll_rc" -eq 0 ] && [ "$now_sha" = "$SW_SHA_ROLLBACK" ]; then
      ok "rollback verificado: bytes pre-fix de vuelta y la puerta los reconoce"
    else
      bad "rollback NO verificado (puerta=$roll_rc, sha=$now_sha) — requiere mano humana"
    fi
  fi
}

if ! ( cd "$ROOT" && docker compose build app ); then bad "el build falló"; rollback; exit 1; fi
ok "build de la imagen"
if ! ( cd "$ROOT" && PORT="${PORT:-8091}" SEED_DEMO="${SEED_DEMO:-true}" docker compose up -d app ); then
  bad "el 'up -d app' falló"; rollback; exit 1
fi
ok "contenedor recreado"

# readiness: no desplegado != sano. Sin esto, la puerta mediría un servicio a medias.
READY=0
for i in $(seq 1 40); do
  code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$BASE_URL/api/auth/permissions.php" || echo 000)"
  if [ "$code" != "000" ] && [ "$code" != "502" ] && [ "$code" != "503" ]; then READY=1; info "readiness tras ${i} intentos: HTTP $code"; break; fi
  sleep 3
done
if [ "$READY" -ne 1 ]; then bad "la instancia no respondió tras el rebuild"; rollback; exit 1; fi
ok "readiness de la instancia"

NOW_SHA="$(curl -fsS -m 15 "$BASE_URL/public/sw.js" | sha256sum | cut -d' ' -f1)"
[ "$NOW_SHA" = "$SW_SHA_TARGET" ] && ok "el sw.js servido es el del commit objetivo" || { bad "el sw.js servido ($NOW_SHA) no es el objetivo ($SW_SHA_TARGET)"; rollback; exit 1; }

echo
echo "----- puerta post-deploy -----"
bash "$ROOT/docker/test_service_worker.sh" "$BASE_URL" "$PAGE" --json "$OUT/gate_post.json" 2>&1 | tee "$OUT/gate_post.txt"
POST_RC="${PIPESTATUS[0]}"
if [ "$POST_RC" -ne 0 ]; then bad "la puerta falló tras el despliegue"; rollback; exit 1; fi

echo
ok "DESPLEGADO Y VERIFICADO: $REV_TARGET en $BASE_URL (puerta=0, sw.js=$NOW_SHA)"
info "evidencia: $OUT   rollback pin: $PREV_IMAGE_ID (alias tomodachi-rollback:sw)"
exit 0
