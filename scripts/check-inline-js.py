#!/usr/bin/env python3
"""Extrae los bloques <script> en línea (sin src) de archivos HTML y valida
cada uno con `node --check`. Sale con código != 0 si algún bloque falla.

Uso: python3 scripts/check-inline-js.py public/customers.html public/integrations.html
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT_RE = re.compile(
    r"<script\b([^>]*)>(.*?)</script>",
    re.DOTALL | re.IGNORECASE,
)


def extract_inline_scripts(html_path: Path):
    """Devuelve [(índice_bloque, contenido)] de los <script> sin atributo src."""
    text = html_path.read_text(encoding="utf-8")
    blocks = []
    for i, match in enumerate(SCRIPT_RE.finditer(text), start=1):
        attrs = match.group(1) or ""
        if re.search(r"\bsrc\s*=", attrs, re.IGNORECASE):
            continue  # externo, no lo tocamos
        code = match.group(2)
        if code.strip():
            blocks.append((i, code))
    return blocks


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    failures = 0
    for name in sys.argv[1:]:
        path = Path(name)
        if not path.is_file():
            print(f"ERROR: no existe {path}")
            failures += 1
            continue
        blocks = extract_inline_scripts(path)
        if not blocks:
            print(f"{path}: sin bloques <script> en línea (ok)")
            continue
        for idx, code in blocks:
            with tempfile.NamedTemporaryFile(
                "w", suffix=".js", delete=False, encoding="utf-8"
            ) as tmp:
                tmp.write(code)
                tmp_path = tmp.name
            proc = subprocess.run(
                ["node", "--check", tmp_path],
                capture_output=True,
                text=True,
            )
            Path(tmp_path).unlink(missing_ok=True)
            if proc.returncode != 0:
                failures += 1
                detail = (proc.stderr or proc.stdout).strip()
                print(f"FAIL {path} bloque #{idx}: {detail}")
            else:
                print(f"ok   {path} bloque #{idx}")
    if failures:
        print(f"\n{failures} bloque(s) con error de sintaxis.")
        return 1
    print("\nTodos los bloques en línea son JavaScript válido.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
