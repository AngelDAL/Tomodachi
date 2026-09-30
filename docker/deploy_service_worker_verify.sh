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
#   bash docker/deploy_service_worker_verify.sh --prepare-tree <dir>
#       Crea un árbol INMUTABLE del commit objetivo (`git worktree add --detach`)
#       sin tocar el checkout compartido, y dice el comando que sigue. No toca
#       Docker.
#
#   bash docker/deploy_service_worker_verify.sh --apply [--tree <dir>]
#       Snapshot de la imagen viva -> build -> up -d app -> readiness -> puerta.
#       Si la puerta falla, REVIERTE solo (retag del snapshot + up -d) y vuelve a
#       verificar el rollback. Nunca hace `down -v`: los volúmenes (db_data,
#       app_uploads, app_sessions, signage_uploads) no se tocan.
#
#       ORIGEN INMUTABLE (obligatorio): el Dockerfile es `COPY . .` sobre el
#       contexto `.`, así que construir desde el checkout compartido hornea el
#       árbol DE TRABAJO — el trabajo en curso de otros agentes—, no el commit
#       verificado. `--apply` exige que el árbol de build sea exactamente
#       REV_TARGET y esté limpio; si no, sale 3 ANTES de tocar Docker:
#           bash docker/deploy_service_worker_verify.sh --prepare-tree /tmp/tomodachi-d19eec2
#           bash docker/deploy_service_worker_verify.sh --apply --tree /tmp/tomodachi-d19eec2
#       Con `--tree`, compose se invoca con `-f <dir>/docker-compose.yml` y
#       `--project-name <basename del repo>` para reemplazar el MISMO contenedor
#       y reusar los MISMOS volúmenes nombrados.
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
#   TREE            árbol de build (--tree); vacío = este checkout
#   PROJECT_NAME    proyecto compose (default: basename del repo) — fija el
#                   contenedor y los volúmenes que se reemplazan
#   GATE_ATTEMPTS   reintentos de la puerta si termina con rc=2 (error, no
#                   veredicto: p. ej. "Inspected target navigated or closed").
#                   Sin esto un error transitorio de Chrome se leería como
#                   "despliegue malo" y dispararía un rollback falso.
set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT:-8091}}"
PAGE="${PAGE:-/public/sales.html}"
REV_TARGET="${REV_TARGET:-d19eec2}"
SW_SHA_TARGET="${SW_SHA_TARGET:-92bf5b415c1fbc3f2a3f3109e0d62832e2dfe7ef2891978177ba46e5d1c5cccc}"
SW_SHA_ROLLBACK="${SW_SHA_ROLLBACK:-2706277485e09c77a4c8faa87fe026b3aa2e4b068f36798c3164a0ec6e0d07f9}"
IMAGE_TAG="${IMAGE_TAG:-ghcr.io/angeldal/tomodachi:latest}"
OUT="${OUT:-${PAPERCLIP_RUN_SCRATCH_DIR:-/tmp}/sw_deploy_$$}"

MODE="--verify-only"
if [ "${1:-}" = "--verify-only" ] || [ "${1:-}" = "--apply" ]; then MODE="$1"; shift; fi
TREE=""
PREPARE_TREE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --tree)
      TREE="${2:-}"
      [ -n "$TREE" ] || { echo "--tree necesita un directorio" >&2; exit 2; }
      shift 2 ;;
    --prepare-tree)
      PREPARE_TREE="${2:-}"
      [ -n "$PREPARE_TREE" ] || { echo "--prepare-tree necesita un directorio" >&2; exit 2; }
      shift 2 ;;
    *)
      echo "opción desconocida: $1" >&2; exit 2 ;;
  esac
done
case "$MODE" in
  --verify-only|--apply) ;;
  *) echo "uso: $0 [--verify-only|--apply] [--tree <dir>] [--prepare-tree <dir>]" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$OUT"

ok()   { printf 'PASS | %s\n' "$*"; }
bad()  { printf 'FAIL | %s\n' "$*"; }
info() { printf 'info | %s\n' "$*"; }

TARGET_FULL="$(git -C "$ROOT" rev-parse "${REV_TARGET}^{commit}" 2>/dev/null || true)"

# --------------------------------------------------- 0. --prepare-tree (sin Docker)
if [ -n "$PREPARE_TREE" ]; then
  echo "===== Runbook service worker — --prepare-tree ====="
  if [ -z "${TARGET_FULL:-}" ]; then
    bad "no pude resolver $REV_TARGET en $ROOT (¿git utilizable?)"; exit 3
  fi
  if [ -e "$PREPARE_TREE" ] && [ -n "$(ls -A "$PREPARE_TREE" 2>/dev/null)" ]; then
    bad "$PREPARE_TREE ya existe y no está vacío; usa otro directorio"; exit 3
  fi
  if ! git -C "$ROOT" worktree add --detach "$PREPARE_TREE" "$TARGET_FULL" >/dev/null 2>&1; then
    bad "no pude crear el árbol inmutable en $PREPARE_TREE"; exit 3
  fi
  ok "árbol inmutable de $REV_TARGET ($TARGET_FULL) en $PREPARE_TREE"
  info "siguiente: bash $0 --apply --tree $PREPARE_TREE"
  exit 0
fi

BUILD_ROOT="${TREE:-$ROOT}"
PROJECT_NAME="${PROJECT_NAME:-$(basename "$ROOT")}"
COMPOSE=(docker compose)
if [ "$BUILD_ROOT" != "$ROOT" ]; then
  COMPOSE+=(--project-name "$PROJECT_NAME" -f "$BUILD_ROOT/docker-compose.yml")
fi

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

# --- origen inmutable: solo --apply, y ANTES de gastar la puerta ---------------
# El Dockerfile hace `COPY . .`: si el árbol de build no es exactamente el commit
# verificado (o está sucio), la imagen hornea trabajo no verificado y la puerta
# de abajo daría un PASS sobre bytes distintos de los medidos.
preflight_origen() {
  if [ -z "${TARGET_FULL:-}" ]; then
    bad "no pude resolver $REV_TARGET en $ROOT (¿git utilizable?)"; return 3
  fi
  local head dirty tree_sha
  head="$(git -C "$BUILD_ROOT" rev-parse HEAD 2>/dev/null || true)"
  if [ -z "${head:-}" ]; then
    bad "$BUILD_ROOT no es un checkout git: no puedo probar que sea el commit verificado"; return 3
  fi
  if [ "$head" != "$TARGET_FULL" ]; then
    bad "el árbol de build está en $head, no en $REV_TARGET ($TARGET_FULL)"; return 3
  fi
  dirty="$(git -C "$BUILD_ROOT" status --porcelain 2>/dev/null || true)"
  if [ -n "${dirty:-}" ]; then
    bad "el árbol de build está sucio: 'COPY . .' hornearía trabajo no verificado"
    printf '%s\n' "$dirty" | head -20 | sed 's/^/       /'
    return 3
  fi
  tree_sha="$(sha256sum "$BUILD_ROOT/public/sw.js" | cut -d' ' -f1)"
  if [ "$tree_sha" != "$SW_SHA_TARGET" ]; then
    bad "el sw.js del árbol de build es $tree_sha, esperaba $SW_SHA_TARGET"; return 3
  fi
  ok "origen inmutable: $BUILD_ROOT en $REV_TARGET ($head), limpio, sw.js=$tree_sha"
  return 0
}

if [ "$MODE" = "--apply" ]; then
  echo
  echo "----- preflight de origen (el build debe ser el commit verificado) -----"
  if ! preflight_origen; then
    info "un árbol sucio NO se despliega. Prepara el commit verificado y reintenta:"
    info "  bash $0 --prepare-tree /tmp/tomodachi-$REV_TARGET"
    info "  bash $0 --apply --tree /tmp/tomodachi-$REV_TARGET"
    exit 3
  fi
  if [ "$BUILD_ROOT" != "$ROOT" ]; then
    if [ -f "$ROOT/.env" ] && [ ! -f "$BUILD_ROOT/.env" ]; then
      cp -f "$ROOT/.env" "$BUILD_ROOT/.env" && info "env: copiado $ROOT/.env al árbol de build"
    fi
    info "compose: ${COMPOSE[*]} (proyecto '$PROJECT_NAME': mismos contenedores y volúmenes)"
  fi
fi

# --------------------------------------------------------- 2. puerta (cualquier modo)
# rc=0 veredicto bueno (o el fallo esperado), rc=1 veredicto malo, rc=2 ERROR
# (sin veredicto: CDP, página caída). Un rc=2 transitorio no es un veredicto y
# no debe provocar un rollback: se reintenta antes de creerle.
run_gate() {
  local jf="$1"; shift
  local intentos="${GATE_ATTEMPTS:-3}" n=1 rc=0
  while :; do
    bash "$ROOT/docker/test_service_worker.sh" "$BASE_URL" "$PAGE" --json "$jf" "$@" 2>&1 \
      | tee "${jf%.json}.txt"
    rc="${PIPESTATUS[0]}"
    if [ "$rc" -ne 2 ] || [ "$n" -ge "$intentos" ]; then break; fi
    n=$((n+1))
    info "la puerta terminó con error (rc=2, sin veredicto: p. ej. CDP); reintento $n/$intentos"
    sleep 3
  done
  return "$rc"
}

echo
echo "----- puerta del service worker (debe salir 0 tras el deploy) -----"
run_gate "$OUT/gate.json"
GATE_RC=$?
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
PREV_IMAGE_ID="$("${COMPOSE[@]}" images -q app 2>/dev/null | head -1 || true)"
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
    ( cd "$BUILD_ROOT" && "${COMPOSE[@]}" up -d app ) || true
    local roll_rc=0
    run_gate "$OUT/gate_rollback.json" --expect fail || roll_rc=$?
    local now_sha; now_sha="$(curl -fsS -m 15 "$BASE_URL/public/sw.js" | sha256sum | cut -d' ' -f1)"
    info "sw.js tras el rollback: $now_sha (esperado $SW_SHA_ROLLBACK)"
    if [ "$roll_rc" -eq 0 ] && [ "$now_sha" = "$SW_SHA_ROLLBACK" ]; then
      ok "rollback verificado: bytes pre-fix de vuelta y la puerta los reconoce"
    else
      bad "rollback NO verificado (puerta=$roll_rc, sha=$now_sha) — requiere mano humana"
    fi
  fi
}

if ! ( cd "$BUILD_ROOT" && "${COMPOSE[@]}" build app ); then bad "el build falló"; rollback; exit 1; fi
ok "build de la imagen"
if ! ( cd "$BUILD_ROOT" && PORT="${PORT:-8091}" SEED_DEMO="${SEED_DEMO:-true}" "${COMPOSE[@]}" up -d app ); then
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
POST_RC=0
run_gate "$OUT/gate_post.json" || POST_RC=$?
if [ "$POST_RC" -ne 0 ]; then
  bad "la puerta falló tras el despliegue (rc=$POST_RC: 1=veredicto malo, 2=sin veredicto tras $GATE_ATTEMPTS intentos)"
  rollback; exit 1
fi

echo
ok "DESPLEGADO Y VERIFICADO: $REV_TARGET en $BASE_URL (puerta=0, sw.js=$NOW_SHA)"
info "evidencia: $OUT   rollback pin: $PREV_IMAGE_ID (alias tomodachi-rollback:sw)"
exit 0
