#!/usr/bin/env bash
#
# docker/fonts_build.sh — regenera las fuentes derivadas de Google Sans Flex.
#
# Qué hace: de los 6 ejes del TTF variable original fija GRAD, ROND y wdth en su
# valor *default* (0, 0, 100) —que este repositorio no usa nunca— y conserva
# wght, opsz y slnt. No hace subset por unicode (el peso está en `gvar`, no en el
# número de glifos). Produce, junto al original:
#
#   public/assets/fonts/Google_Sans_Flex/GoogleSansFlex-Var-wght-opsz-slnt.ttf
#   public/assets/fonts/Google_Sans_Flex/GoogleSansFlex-Var-wght-opsz-slnt.woff2
#
# El TTF original (6 ejes, 3,997,148 B) NO se toca: queda como rollback.
# Decisión y números: TAB-29.
#
# Uso (desde la raíz del repositorio):
#
#   bash docker/fonts_build.sh
#
# Reproducible e idempotente: con el mismo fontTools/brotli produce siempre los
# mismos bytes. Se fija `recalcTimestamp = False` a propósito — si no, fontTools
# sella `head.modified` con la hora de la corrida y tanto el TTF como (por la
# compresión brotli) el tamaño del woff2 cambian en cada ejecución.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FONTS_VENV="${FONTS_VENV:-$HOME/.cache/tomodachi-fonts-venv}"
OUT_DIR="public/assets/fonts/Google_Sans_Flex"
SRC="$OUT_DIR/GoogleSansFlex-VariableFont_GRAD,ROND,opsz,slnt,wdth,wght.ttf"

# Tamaños medidos y aceptados (bytes). El script falla si dejan de cumplirse.
EXPECT_TTF=606268
EXPECT_WOFF2=271344

if [ ! -f "$SRC" ]; then
    echo "ERROR: no encuentro $SRC — ejecuta este script desde la raíz del repo." >&2
    exit 1
fi

if [ ! -x "$FONTS_VENV/bin/python" ]; then
    echo "[fonts] creando venv en $FONTS_VENV"
    python3 -m venv "$FONTS_VENV"
fi

if ! "$FONTS_VENV/bin/python" -c 'import fontTools, brotli' >/dev/null 2>&1; then
    echo "[fonts] instalando fonttools[woff] + brotli en $FONTS_VENV"
    "$FONTS_VENV/bin/python" -m pip install --quiet --upgrade pip
    "$FONTS_VENV/bin/python" -m pip install --quiet "fonttools[woff]" brotli
fi

echo "[fonts] fontTools $("$FONTS_VENV/bin/python" -c 'import fontTools; print(fontTools.version)')"

"$FONTS_VENV/bin/python" - "$SRC" "$OUT_DIR" "$EXPECT_TTF" "$EXPECT_WOFF2" <<'PY'
import os
import sys

from fontTools.ttLib import TTFont
from fontTools.ttLib.woff2 import compress
from fontTools.varLib import instancer

src, out_dir, expect_ttf, expect_woff2 = (
    sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
)
fixed = {"GRAD": 0, "ROND": 0, "wdth": 100}
base = "GoogleSansFlex-Var-wght-opsz-slnt"
ttf_out = os.path.join(out_dir, base + ".ttf")
woff2_out = os.path.join(out_dir, base + ".woff2")

inst = instancer.instantiateVariableFont(
    TTFont(src), dict(fixed), inplace=False, updateFontNames=False
)
inst.recalcTimestamp = False  # determinismo: no sellar head.modified con la hora
inst.save(ttf_out)
inst.close()
compress(ttf_out, woff2_out)

sizes = {"ttf": os.path.getsize(ttf_out), "woff2": os.path.getsize(woff2_out)}
for kind, path, expected in (
    ("ttf", ttf_out, expect_ttf),
    ("woff2", woff2_out, expect_woff2),
):
    print("[fonts] %-6s %8d B  %s" % (kind, sizes[kind], path))

if sizes["ttf"] != expect_ttf or sizes["woff2"] != expect_woff2:
    sys.exit(
        "ERROR: tamaños inesperados (ttf %d != %d o woff2 %d != %d); "
        "revisa la versión de fontTools/brotli."
        % (sizes["ttf"], expect_ttf, sizes["woff2"], expect_woff2)
    )
print("[fonts] OK: derivados reproducidos con los tamaños esperados")
PY
