#!/usr/bin/env python3
"""Cuenta llamadas bloqueantes reales (`alert` / `confirm` / `prompt`) por archivo.

Existe porque el conteo anterior con `grep` tenía tres puntos ciegos (revisión del
13-oct-2026):

1. El `lookbehind` `(?<![a-zA-Z0-9_.$])` descartaba `window.prompt(...)` por el punto.
2. Restaba comentarios "una línea que EMPIEZA con // o *", así que un `confirm()` citado
   en un comentario de bloque (o al final de una línea de código) contaba como llamada real.
3. Sólo miraba archivos `.js`: los `alert()` escritos en un `<script>` en línea del HTML
   no aparecían en ningún reporte.

Aquí se quitan los comentarios con una máquina de estados que respeta cadenas y plantillas,
y se cuentan las llamadas de verdad (incluidas `window.`/`self.`/`globalThis.`). En los
`.html` se cuentan sólo los `<script>` en línea (no los `.js` externos, que ya se cuentan
por su cuenta).

Uso:
    python3 scripts/contar-bloqueantes.py archivo.js otro.html ...
    python3 scripts/contar-bloqueantes.py --json archivo.js    # salida para la máquina

Salida normal: una línea por archivo con hallazgos, con el formato
    ruta<TAB>número<TAB>línea
para que quien lo llame pueda agrupar y reportar sin volver a contar.
"""
import json
import re
import sys

NOMBRES = ("alert", "confirm", "prompt")
# `alert(` sin nada delante, o con `window.` / `self.` / `globalThis.` (que antes se
# escapaba). Un punto cualquiera delante (p. ej. `modal.confirm(`) NO cuenta: es un método
# propio, no la ventana nativa.
PATRON = re.compile(
    r"(?<![\w.$])(?:" + "|".join(NOMBRES) + r")\s*\("
    r"|(?<![\w.])(?:window|self|globalThis)\s*\.\s*(?:" + "|".join(NOMBRES) + r")\s*\("
)
SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.DOTALL | re.IGNORECASE)


def sin_comentarios(codigo: str) -> str:
    """Devuelve el código con comentarios y literales de cadena neutralizados.

    Se reemplaza por espacios (conservando los saltos de línea y las columnas) para que
    las posiciones no se desplacen y el conteo no dependa de una sola línea.
    """
    salida = []
    i, n = 0, len(codigo)
    estado = None          # None | "'" | '"' | '`' | '//' | '/*'
    while i < n:
        c = codigo[i]
        par = codigo[i:i + 2]
        if estado is None:
            if par == "//":
                estado = "//"
                salida.append("  ")
                i += 2
                continue
            if par == "/*":
                estado = "/*"
                salida.append("  ")
                i += 2
                continue
            if c in "'\"`":
                estado = c
                salida.append(" ")
                i += 1
                continue
            salida.append(c)
            i += 1
            continue
        # dentro de algo que no es código
        if estado == "//":
            if c == "\n":
                estado = None
                salida.append("\n")
            else:
                salida.append(" ")
            i += 1
            continue
        if estado == "/*":
            if par == "*/":
                estado = None
                salida.append("  ")
                i += 2
            else:
                salida.append("\n" if c == "\n" else " ")
                i += 1
            continue
        # dentro de una cadena
        if c == "\\":
            salida.append("  ")
            i += 2
            continue
        if c == estado:
            estado = None
            salida.append(" ")
            i += 1
            continue
        if estado == "`" and par == "${":
            # interpolación: se conserva el contenido tal cual (puede haber llamadas)
            salida.append("  ")
            i += 2
            continue
        salida.append("\n" if c == "\n" else " ")
        i += 1
    return "".join(salida)


def bloques_a_revisar(ruta: str, texto: str):
    """Para .js devuelve el archivo entero; para .html, sólo sus <script> en línea."""
    if ruta.lower().endswith(".html") or ruta.lower().endswith(".htm"):
        partes = []
        for m in SCRIPT_RE.finditer(texto):
            if re.search(r"\bsrc\s*=", m.group(1) or "", re.IGNORECASE):
                continue
            partes.append(m.group(2))
        return partes
    return [texto]


def contar(ruta: str):
    with open(ruta, encoding="utf-8", errors="replace") as fh:
        texto = fh.read()
    hallazgos = []
    for bloque in bloques_a_revisar(ruta, texto):
        limpio = sin_comentarios(bloque)
        for m in PATRON.finditer(limpio):
            hallazgos.append(limpio[:m.start()].count("\n") + 1)
    return sorted(hallazgos)


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--json"]
    como_json = "--json" in sys.argv
    if not args:
        print(__doc__)
        return 2
    if como_json:
        print(json.dumps({r: contar(r) for r in args}, ensure_ascii=False))
        return 0
    for ruta in args:
        lineas = contar(ruta)
        if lineas:
            print(f"{ruta}\t{len(lineas)}\t{','.join(str(x) for x in lineas[:8])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
