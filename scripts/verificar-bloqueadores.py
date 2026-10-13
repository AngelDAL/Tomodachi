#!/usr/bin/env python3
"""
Verifica que NINGÚN archivo o endpoint de Tomodachi lo atrape una lista de bloqueo.

Por qué existe
--------------
El 13-oct-2026 el mostrador se quedó en «Cargando pedidos…» para siempre y el
servidor no registraba ni una petición: **uBlock Origin estaba bloqueando
`/public/js/counter.js?v=15`**. La regla no era nuestra, era de EasyPrivacy
(lista que uBlock trae activada): `/js/counter.js?`, que atrapa cualquier
`js/counter.js?v=N`. O sea: el archivo funcionaba, el servidor estaba bien y la
pantalla moría en el navegador del usuario, en silencio y sin log.

Ninguna suite de las que corren puede ver eso (el bloqueo ocurre ANTES de que la
petición salga). Esta comprobación lo mira donde sí se ve: contra las listas.

Qué hace
--------
1. Recolecta los assets que piden las páginas (`src`/`href` de public/*.html) y
   los endpoints `api/*.php` que llaman los JS.
2. Baja EasyList, EasyPrivacy, AdGuard Spyware y los filtros de privacidad de
   uBlock Origin.
3. Aplica las reglas de RED (subcadena y `||dominio^`) a cada URL nuestra,
   descartando las que no nos aplican (third-party, $image, $popup, …).
4. FALLA (exit 1) si alguna regla atraparía algo nuestro, diciendo cuál.

Uso:
    python3 scripts/verificar-bloqueadores.py            # comprueba
    python3 scripts/verificar-bloqueadores.py --listar   # muestra también lo revisado

Necesita red para bajar las listas (si no hay, sale con 2 y avisa: no es un
fallo del proyecto). NO está en el CI a propósito: depende de listas remotas.
"""
import glob
import os
import re
import subprocess
import sys

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
HOST = os.environ.get('TOMOTACHI_HOST', 'tomodachi.tabtap.dev')
LISTAS = {
    'easylist': 'https://easylist.to/easylist/easylist.txt',
    'easyprivacy': 'https://easylist.to/easylist/easyprivacy.txt',
    'adguard-spyware': 'https://filters.adtidy.org/extension/ublock/filters/3.txt',
    'adguard-tracking': 'https://filters.adtidy.org/extension/ublock/filters/2.txt',
    'ublock-privacy': 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
    'ublock-unbreak': 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt',
    'peter-lowe': 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext',
}
# Opciones que hacen que una regla NO aplique a lo nuestro (first-party y de estos tipos).
NO_APLICAN = ('third-party', '3p', '$image', '$ping', '$popup', '$object', '$other',
              '$document', '$subdocument', '$media', '$font')
EXT_IMAGEN = ('.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff2', '.webp', '.ico')


def recolectar_urls():
    """assets de las páginas + endpoints que llaman los JS, normalizados a /ruta"""
    urls = set()
    for p in glob.glob(os.path.join(RAIZ, '*.html')):
        txt = open(p, encoding='utf-8', errors='replace').read()
        for m in re.finditer(r'(?:src|href)="(?!https?:|data:|#|mailto:)([^"]+)"', txt):
            u = m.group(1).split('?')[0]
            if u.startswith('/'):
                urls.add(u)
            else:
                urls.add('/public/' + os.path.normpath(u).lstrip('./'))
    for p in glob.glob(os.path.join(RAIZ, 'js', '*.js')):
        txt = open(p, encoding='utf-8', errors='replace').read()
        for m in re.finditer(r"['\"](?:\.\./)*(api/[A-Za-z0-9_./-]+\.php)", txt):
            urls.add('/' + m.group(1))
    return sorted(u for u in urls if u.endswith(('.js', '.css', '.php', '.html')))


def reglas_de(texto):
    out = []
    for l in texto.splitlines():
        l = l.strip()
        if not l or l.startswith(('!', '[', '@@', '##', '#@', '#?#', '#$#')):
            continue
        out.append(l)
    return out


def aplica(url, regla):
    """¿esta regla de red atraparía esta URL nuestra (first-party)?"""
    if any(o in regla for o in NO_APLICAN):
        if 'third-party' in regla or '$3p' in regla:
            return False                       # lo nuestro es first-party
        for tipo in ('$image', '$ping', '$popup', '$object', '$media', '$font'):
            if tipo in regla and not url.endswith(EXT_IMAGEN):
                return False
    patron = regla.split('$')[0]
    if patron.startswith('||'):
        dom = patron[2:].split('^')[0].split('/')[0]
        return bool(dom) and (HOST == dom or HOST.endswith('.' + dom))
    patron = patron.lstrip('|')
    if patron.startswith('/') or patron.endswith('?'):
        return patron in (url.split('?')[0] + ('?' if '?' in url else ''))
    return False


def main():
    listar = '--listar' in sys.argv
    urls = recolectar_urls()
    print(f"assets y endpoints revisados: {len(urls)} (host de prueba: {HOST})")

    hallazgos = []
    sin_red = []
    for nombre, url in LISTAS.items():
        try:
            crudo = subprocess.run(['curl', '-sL', '--max-time', '120', url],
                                   capture_output=True, text=True, check=True).stdout
        except Exception as e:                                    # noqa: BLE001
            sin_red.append(f"{nombre}: {e}")
            continue
        rs = reglas_de(crudo)
        print(f"  {nombre}: {len(rs)} reglas de red")
        for u in urls:
            # Se prueban las DOS formas: sin query y con query. La regla que causó esto
            # (`/js/counter.js?`) solo aplica cuando HAY query (`?v=N`), así que probar
            # únicamente la URL pelada la dejaría pasar.
            variantes = [f"https://{HOST}{u}", f"https://{HOST}{u}?v=1"]
            for r in rs:
                if 'counter' in r and u.endswith('mostrador.js'):
                    continue                     # ya sabemos del caso que originó esto
                if any(aplica(v, r) for v in variantes):
                    hallazgos.append((nombre, r, u))

    if sin_red:
        print("\nAVISO — no pude bajar alguna lista (no es un fallo del proyecto):")
        for s in sin_red:
            print("  ", s)
        if len(sin_red) == len(LISTAS):
            return 2

    print("\n=== reglas que atraparían algo nuestro ===")
    if not hallazgos:
        print("ninguna")
    for nombre, r, u in sorted(set(hallazgos)):
        print(f"  BLOQUEADO  {u}   por  [{nombre}]  {r}")

    if listar:
        print("\n=== revisado ===")
        for u in urls:
            print("  ", u)

    if hallazgos:
        print("\nFALLO: renombra el archivo/endpoint atrapado (una lista de bloqueo lo mata "
              "antes de que la petición salga y no hay log que lo delate).")
        return 1
    print("\nOK: ninguna lista conocida bloquea los assets ni los endpoints de la app.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
