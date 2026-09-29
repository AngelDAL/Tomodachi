#!/usr/bin/env bash
# Suite de SALUD (TAB-38) contra una instancia DESECHABLE.
#
# Qué comprueba:
#   1. /api/health/live.php → 200 {"status":"live"}
#   2. /api/health/ready.php → 200 (ok|degraded) o 503 (not_ready|down), siempre
#      con `status`, y en menos de 3 s (el HEALTHCHECK corta ahí: si tarda más,
#      el contenedor se marca unhealthy aunque la app esté bien).
#   3. ready.php NO manda Set-Cookie: el chequeo cada 30 s ya no crea un archivo
#      de sesión (contraste: permissions.php sí lo hacía → 2,880/día).
#   4. desde otra IP y sin token, el cuerpo NO trae `checks` (solo `status`).
#   5. con `X-Health-Token` correcto (env HEALTH_TOKEN) SÍ trae `checks`.
#   6. `?store_id=…` no cambia la respuesta: el endpoint no lee store_id.
#   7. /api/auth/permissions.php sigue respondiendo igual (contrato intacto).
#
# Fuera de alcance de esta suite (requiere apagar la BD o el contenedor):
#   - "BD caída → 503": se verifica contra una instancia con la BD apagada
#     (evidencia en TAB-38) o con DB_HOST apuntando a un puerto cerrado.
#   - "archivos de sesión antes/60 s después iguales": al final se imprime el
#     comando exacto para medirlo dentro del contenedor.
#
# Uso: bash docker/test_health_endpoints.sh [base_url]
set -u
BASE="${1:-http://localhost:8091}"
PASS=0; FAIL=0
HDRS=$(mktemp); BODY=$(mktemp)

ok()  { echo "PASS | $1"; PASS=$((PASS+1)); }
mal() { echo "FAIL | $1"; FAIL=$((FAIL+1)); }

jget() { python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: d={}
for k in '$1'.split('.'):
    d = (d or {}).get(k) if isinstance(d, dict) else None
print('' if d is None else d)" 2>/dev/null; }

jhas() { python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: d={}
print('si' if isinstance(d, dict) and '$1' in d else 'no')" 2>/dev/null; }

jnorm() { python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: d={}
if isinstance(d, dict): d.pop('time', None)
print(json.dumps(d, sort_keys=True))" 2>/dev/null; }

# pedir <args curl...> -> imprime "codigo|segundos"
pedir() { curl -s -o "$BODY" -D "$HDRS" -w '%{http_code}|%{time_total}' --max-time 6 "$@"; }

case "$BASE" in
  *127.0.0.1*|*localhost*) ES_LOCAL=si;;
  *) ES_LOCAL=no;;
esac

echo "===== Salud (live/ready) — $BASE ====="

# 1. Liveness
r=$(pedir "$BASE/api/health/live.php"); c=${r%%|*}; s=$(jget status < "$BODY")
if [ "$c" = "200" ] && [ "$s" = "live" ]; then
  ok "live.php → 200 {\"status\":\"live\"}"
else
  mal "live.php (code=$c status=$s body=$(head -c 120 "$BODY"))"
fi
if grep -qi '^set-cookie:' "$HDRS"; then mal "live.php mandó Set-Cookie (crearía sesión)"; else ok "live.php no manda Set-Cookie"; fi

# 2. Readiness: código/estado dentro del contrato y dentro del presupuesto de 3 s
r=$(pedir "$BASE/api/health/ready.php"); c=${r%%|*}; t=${r##*|}; s=$(jget status < "$BODY")
case "$c:$s" in
  200:ok|200:degraded|503:not_ready|503:down) ok "ready.php → $c ($s)";;
  *) mal "ready.php fuera de contrato (code=$c status=$s body=$(head -c 200 "$BODY"))";;
esac
if python3 -c "import sys; sys.exit(0 if float('$t') < 3.0 else 1)" 2>/dev/null; then
  ok "ready.php responde en ${t}s (< 3s del HEALTHCHECK)"
else
  mal "ready.php tardó ${t}s (>= 3s: el HEALTHCHECK lo declararía unhealthy)"
fi

# 3. El healthcheck ya NO crea sesiones
if grep -qi '^set-cookie:' "$HDRS"; then
  mal "ready.php mandó Set-Cookie (un archivo de sesión cada 30 s)"
else
  ok "ready.php no manda Set-Cookie (el chequeo ya no crea sesiones)"
fi
r=$(pedir "$BASE/api/auth/permissions.php")
if grep -qi '^set-cookie:' "$HDRS"; then
  echo "INFO | permissions.php SÍ manda Set-Cookie: es el motivo del hallazgo (2,880 sesiones/día)"
fi

# 4. Sin token y desde otra IP: sin detalle
r=$(pedir "$BASE/api/health/ready.php")
tiene=$(jhas checks < "$BODY")
if [ "$tiene" = "no" ]; then
  ok "sin token y desde otra IP, el cuerpo NO trae checks"
elif [ "$ES_LOCAL" = "si" ]; then
  echo "SKIP | $BASE puede ser loopback del lado del servidor: ahí el detalle SÍ se expone (por diseño). Correr desde otra máquina para el caso sin token."
else
  mal "el cuerpo trajo checks sin token desde una IP externa ($(head -c 200 "$BODY"))"
fi

# 5. Con token correcto: con detalle
if [ -n "${HEALTH_TOKEN:-}" ]; then
  r=$(pedir -H "X-Health-Token: $HEALTH_TOKEN" "$BASE/api/health/ready.php")
  tiene=$(jhas checks < "$BODY"); s=$(jget status < "$BODY")
  if [ "$tiene" = "si" ] && [ -n "$s" ]; then
    ok "con X-Health-Token correcto llega el detalle (checks) y status=$s"
  else
    mal "con el token correcto no llegó el detalle (body=$(head -c 200 "$BODY"))"
  fi
else
  echo "SKIP | sin HEALTH_TOKEN en el entorno: no se prueba el detalle autenticado"
fi

# 6. store_id no se lee ni se acepta
pedir "$BASE/api/health/ready.php" >/dev/null; a=$(jnorm < "$BODY")
pedir "$BASE/api/health/ready.php?store_id=2&store_id=999" >/dev/null; b=$(jnorm < "$BODY")
if [ -n "$a" ] && [ "$a" = "$b" ]; then
  ok "?store_id=… no cambia la respuesta (no lee store_id)"
else
  mal "la respuesta cambió al pasar store_id ($a vs $b)"
fi

# 7. permissions.php intacto
r=$(pedir "$BASE/api/auth/permissions.php"); c=${r%%|*}
p=$(jget plan < "$BODY"); perm=$(jhas permissions < "$BODY")
if [ "$c" = "200" ] && [ -n "$p" ] && [ "$perm" = "si" ]; then
  ok "permissions.php sigue 200 con plan=$p y permissions (contrato intacto)"
else
  mal "permissions.php cambió (code=$c plan=$p permissions=$perm)"
fi

rm -f "$HDRS" "$BODY"
echo
echo "NOTA | Criterio 3 (conteo de sesiones): medir DENTRO del contenedor"
echo "       docker compose exec app sh -c 'find /var/lib/php/sessions -type f | wc -l'   # antes"
echo "       # esperar 60 s con el contenedor arriba (el HEALTHCHECK corre cada 30 s)"
echo "       docker compose exec app sh -c 'find /var/lib/php/sessions -type f | wc -l'   # despues: IGUAL"
echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="
exit $(( FAIL > 0 ? 1 : 0 ))
