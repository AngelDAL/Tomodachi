#!/usr/bin/env bash
# ================================================================
# Tomodachi POS — Verificación de la guía de estilos
# ================================================================
# Revisa el frontend contra docs/GUIA_DE_ESTILOS.md:
#   1. Emojis en HTML/JS/CSS/PHP de la app
#   2. alert() / confirm() / prompt()
#   3. Colores en duro (#hex) fuera de variables.css / design-system.css
#   4. Familias tipográficas fuera de las autorizadas
#   5. var(--token) que apunta a un token que no existe (aviso)
#
# Uso:
#   bash scripts/verificar-estilos.sh                    # revisa (exit 1 si hay hallazgos nuevos)
#   bash scripts/verificar-estilos.sh --update-baseline  # registra la deuda actual
#
# El baseline (scripts/estilos-baseline.txt) congela la deuda conocida. Si un
# archivo EMPEORA respecto al baseline, o un archivo nuevo viola una regla, el
# script falla. Así la deuda vieja no bloquea el trabajo, pero tampoco crece.
# ================================================================
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
ROOT="$(pwd)"
BASELINE="$ROOT/scripts/estilos-baseline.txt"
UPDATE=0
[ "${1:-}" = "--update-baseline" ] && UPDATE=1

# ---- Archivos del proyecto (sin terceros) ----
mapfile -t FILES < <(find public api includes -type f \
    \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.php' \) \
    -not -path '*/lib/*' -not -path '*/vendor/*' 2>/dev/null | sort)

CSS_ALL=(); JS_ALL=()
for f in "${FILES[@]}"; do
    case "$f" in *.css) CSS_ALL+=("$f") ;; *.js) JS_ALL+=("$f") ;; esac
done

# Tokens definidos en cualquier CSS o en bloques <style>/<script> de los HTML
DEFINED="$(grep -rhoP '(?<![a-zA-Z0-9_-])--[a-zA-Z0-9_-]+\s*:' "${FILES[@]}" 2>/dev/null \
    | grep -oP '(?<=--)[a-zA-Z0-9_-]+' | sort -u)"
# Tokens que JavaScript define en tiempo de ejecución (no son deuda)
JS_DEFINED="$(grep -rhoP "setProperty\(\s*'--[a-zA-Z0-9_-]+" "${FILES[@]}" 2>/dev/null \
    | grep -oP '(?<=--)[a-zA-Z0-9_-]+' | sort -u)"

ERRORS=0
WARNS=0
declare -A FOUND

hdr()  { printf '\n=== %s ===\n' "$1"; }
ok()   { printf '  ok  %s\n' "$1"; }
warn() { printf '  !   %s\n' "$1"; WARNS=$((WARNS+1)); }
bad()  { printf '  >>  %s\n' "$1"; ERRORS=$((ERRORS+1)); }

baseline_get() {
    [ -f "$BASELINE" ] || { echo "-"; return; }
    awk -F'\t' -v k="$1" '$1==k{print $2; f=1} END{if(!f) print "-"}' "$BASELINE"
}

# Evalúa un hallazgo contable contra el baseline
# $1 clave   $2 archivo   $3 conteo   $4 descripción
evaluar() {
    local key="$1" file="$2" cur="$3" desc="$4" base
    FOUND["$key"]=$cur
    base="$(baseline_get "$key")"
    if [ "$base" = "-" ]; then
        bad "$file: $cur $desc [sin baseline: hallazgo nuevo]"
    elif [ "$cur" -gt "$base" ]; then
        bad "$file: $cur $desc (baseline $base) — la deuda creció"
    else
        ok "$file: $cur $desc (deuda registrada, baseline $base)"
    fi
}

printf 'Tomodachi — verificación de estilos\nRepositorio: %s\nArchivos revisados: %s\n' "$ROOT" "${#FILES[@]}"

# ---------- 1. Emojis ----------
hdr "1. Emojis (prohibido: se usa FontAwesome)"
EMOJI_RE='[\x{1F000}-\x{1FAFF}\x{2700}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE0F}\x{1F1E6}-\x{1F1FF}\x{2049}\x{203C}]'
EMOJI_TOTAL=0
for f in "${FILES[@]}"; do
    n=$(grep -oP "$EMOJI_RE" "$f" 2>/dev/null | wc -l)
    if [ "$n" -gt 0 ]; then
        chars=$(grep -oP "$EMOJI_RE" "$f" | sort -u | tr '\n' ' ')
        evaluar "emoji:$f" "$f" "$n" "emoji(s): $chars"
        EMOJI_TOTAL=$((EMOJI_TOTAL+n))
    fi
done
[ "$EMOJI_TOTAL" -eq 0 ] && ok "sin emojis"

# ---------- 2. alert / confirm / prompt ----------
hdr "2. alert() / confirm() / prompt() (prohibido: usar showNotification y <dialog>)"
AC_TOTAL=0
for f in "${JS_ALL[@]}"; do
    n=$(grep -oP '(?<![a-zA-Z0-9_.$])(alert|confirm|prompt)\s*\(' "$f" 2>/dev/null | wc -l)
    nc=$(grep -oP '^\s*(//|\*|/\*).*\b(alert|confirm|prompt)\s*\(' "$f" 2>/dev/null | wc -l)
    n=$((n-nc))
    if [ "$n" -gt 0 ]; then
        evaluar "bloqueante:$f" "$f" "$n" "llamada(s) bloqueante(s)"
        AC_TOTAL=$((AC_TOTAL+n))
    fi
done
[ "$AC_TOTAL" -eq 0 ] && ok "sin llamadas bloqueantes"
[ "$AC_TOTAL" -gt 0 ] && printf '      (ver Guía de Estilos, sección 9)\n'

# ---------- 3. Colores en duro ----------
hdr "3. Colores en duro (prohibido fuera de variables.css / design-system.css)"
HEX_TOTAL=0
for f in "${CSS_ALL[@]}"; do
    case "$(basename "$f")" in variables.css|design-system.css) continue ;; esac
    n=$(sed 's/url("data:image\/svg+xml[^"]*")//g; s/data:image\/svg+xml[^"'"'"')]*//g' "$f" 2>/dev/null \
        | grep -oP '#[0-9a-fA-F]{3,8}\b' | wc -l)
    [ "$n" -eq 0 ] && continue
    evaluar "hex:$f" "$f" "$n" "color(es) en duro"
    HEX_TOTAL=$((HEX_TOTAL+n))
done
[ "$HEX_TOTAL" -eq 0 ] && ok "sin colores en duro"

# ---------- 4. Tipografías ----------
hdr "4. Familias tipográficas autorizadas"
# Sora e Inter (interfaz), Google Sans Flex (páginas públicas y tickets),
# monoespaciadas para impresión térmica. El resto es deuda.
FONT_OK="sora|inter|font awesome|google sans flex|sf mono|courier|monospace|sans-serif|serif|inherit|initial|unset|system-ui|-apple-system|BlinkMacSystemFont|Segoe UI|Roboto|var"
FONT_TOTAL=0
for f in "${FILES[@]}"; do
    n=$(grep -oP "font-family:\s*'?\K[A-Za-z][A-Za-z0-9 _-]*" "$f" 2>/dev/null \
        | grep -viP "^($FONT_OK)" | wc -l)
    if [ "$n" -gt 0 ]; then
        who=$(grep -oP "font-family:\s*'?\K[A-Za-z][A-Za-z0-9 _-]*" "$f" | sort -u \
            | grep -viP "^($FONT_OK)" | tr '\n' ' ')
        evaluar "font:$f" "$f" "$n" "uso(s) de fuente no autorizada: $who"
        FONT_TOTAL=$((FONT_TOTAL+n))
    fi
done
[ "$FONT_TOTAL" -eq 0 ] && ok "solo familias autorizadas"

# ---------- 5. Tokens inexistentes (aviso) ----------
hdr "5. var(--token) sin definición (aviso, no bloquea)"
USED=$(grep -rhoP 'var\(\s*--[a-zA-Z0-9_-]+' "${FILES[@]}" 2>/dev/null \
    | grep -oP '(?<=--)[a-zA-Z0-9_-]+' | sort -u)
MISSING=0
for tok in $USED; do
    if ! grep -qx "$tok" <<< "$DEFINED" && ! grep -qx "$tok" <<< "$JS_DEFINED"; then
        users=$(grep -rl -- "var(--$tok" "${FILES[@]}" 2>/dev/null | tr '\n' ' ')
        warn "var(--$tok) no está definido en ningún archivo — usado en: $users"
        MISSING=$((MISSING+1))
    fi
done
[ "$MISSING" -eq 0 ] && ok "todos los tokens usados existen"

# ---------- Baseline ----------
if [ "$UPDATE" = "1" ]; then
    {
        echo "# Baseline de deuda de estilos — generado por scripts/verificar-estilos.sh"
        echo "# Formato: tipo:archivo<TAB>conteo. Solo se reduce, nunca se sube a mano."
        for k in $(printf '%s\n' "${!FOUND[@]}" | sort); do
            printf '%s\t%s\n' "$k" "${FOUND[$k]}"
        done
    } > "$BASELINE"
    printf '\nBaseline actualizado: %s entradas en %s\n' "$(grep -vc '^#' "$BASELINE")" "$BASELINE"
fi

printf '\n================================\n'
if [ "$ERRORS" -eq 0 ]; then
    printf 'RESULTADO: limpio — 0 hallazgos nuevos'
    [ "$WARNS" -gt 0 ] && printf ' (%s aviso(s) que revisar)' "$WARNS"
    printf '\n'
    exit 0
else
    printf 'RESULTADO: %s hallazgo(s) que violan la guía' "$ERRORS"
    [ "$WARNS" -gt 0 ] && printf ' + %s aviso(s)' "$WARNS"
    printf '\nGuía: docs/GUIA_DE_ESTILOS.md\n'
    exit 1
fi
