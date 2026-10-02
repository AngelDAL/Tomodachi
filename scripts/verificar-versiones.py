#!/usr/bin/env python3
"""
Verifica que ningún archivo con versión en la URL haya cambiado SIN subir su `?v=`.

Por qué existe
--------------
En este proyecto el CSS y el JS se sirven con `?v=N` y el **service worker** usa
`stale-while-revalidate` para los estáticos: sirve primero lo guardado y baja lo nuevo para la
próxima carga. Es decir, si el contenido de un archivo cambia y su URL NO cambia, el navegador
sigue sirviendo el viejo —y un Ctrl+F5 no siempre esquiva al service worker—. Pasó el
2-oct-2026: se cambió `inventory.css` dejando su `?v=25` y el dueño del proyecto vio la sección
nueva sin estilos. Subir la versión **no es cosmético: es lo único que garantiza que el cambio
llegue**.

Qué comprueba (y qué no)
------------------------
1. FALLA si el contenido de un archivo versionado cambió y su `?v=` sigue igual. El mensaje dice
   a qué número subirlo y desde qué páginas se carga.
2. FALLA si el mismo archivo se referencia con **versiones distintas** desde distintas páginas:
   media flota actualizada es peor que ninguna, porque el reporte de "no veo el cambio" se vuelve
   imposible de reproducir.
3. AVISA (no falla) de los archivos que se cargan SIN `?v=`: hoy son pocos y son deuda vieja;
   versionarlos es un cambio aparte, pero conviene tenerlos a la vista.

Uso
---
    python3 scripts/verificar-versiones.py              # comprueba (lo que corre el CI)
    python3 scripts/verificar-versiones.py --actualizar # regraba la referencia de versiones
                                                        # cuando SÍ se subió la versión

El archivo de referencia (`scripts/versiones-assets.tsv`) guarda la última versión y el hash
conocidos de cada archivo versionado. No hay que tocarlo a mano: cuando alguien sube el `?v=`, la
comprobación pasa sola y `--actualizar` lo pone al día.
"""
import hashlib
import pathlib
import re
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = RAIZ / "public"
REFERENCIA = RAIZ / "scripts" / "versiones-assets.tsv"

# <link href="css/x.css?v=3"> · <script src="js/y.js?v=12">
PATRON = re.compile(r'(?:href|src)="((?:css|js)/[^"?#]+)(?:\?v=([0-9]+))?"')


def md5(ruta: pathlib.Path) -> str:
    return hashlib.md5(ruta.read_bytes()).hexdigest()


def leer_referencia() -> dict:
    """ruta -> (version, hash) según el archivo de referencia."""
    datos = {}
    if not REFERENCIA.exists():
        return datos
    for linea in REFERENCIA.read_text(encoding="utf-8").splitlines():
        if not linea.strip() or linea.startswith("#"):
            continue
        partes = linea.split("\t")
        if len(partes) == 3:
            datos[partes[0]] = (partes[1], partes[2])
    return datos


def escribir_referencia(entradas: dict) -> None:
    lineas = [
        "# Archivos con ?v= en su URL, su versión actual y el md5 de su contenido.",
        "# Lo mantiene scripts/verificar-versiones.py --actualizar; no editar a mano.",
        "# ruta\tversion\tmd5",
    ]
    for ruta in sorted(entradas):
        version, hash_ = entradas[ruta]
        lineas.append(f"{ruta}\t{version}\t{hash_}")
    REFERENCIA.write_text("\n".join(lineas) + "\n", encoding="utf-8")


def revisar():
    if not PUBLIC.is_dir():
        print("No encuentro public/ — ¿se corre desde la raíz del repositorio?")
        return 2

    versionados = {}     # ruta -> {version: [paginas]}
    sin_version = {}     # ruta -> [paginas]

    for pagina in sorted(PUBLIC.glob("*.html")):
        html = pagina.read_text(encoding="utf-8", errors="ignore")
        for ruta, version in PATRON.findall(html):
            nombre = pagina.relative_to(PUBLIC).as_posix()
            if version:
                versionados.setdefault(ruta, {}).setdefault(version, []).append(nombre)
            else:
                sin_version.setdefault(ruta, []).append(nombre)

    referencia = leer_referencia()
    errores = []
    actualizado = {}
    nuevas = []

    for ruta in sorted(versionados):
        versiones = versionados[ruta]
        if len(versiones) > 1:
            detalle = "; ".join(
                f"v={v} ({', '.join(sorted(set(p)))})" for v, p in sorted(versiones.items())
            )
            errores.append(
                f"{ruta} se referencia con VERSIONES DISTINTAS: {detalle}. "
                f"Deja una sola en todas las páginas."
            )
            continue

        version = next(iter(versiones))
        paginas = ", ".join(sorted(set(versiones[version])))
        archivo = PUBLIC / ruta
        if not archivo.exists():
            errores.append(f"{ruta} se carga desde {paginas} pero el archivo no existe")
            continue

        hash_actual = md5(archivo)
        previo = referencia.get(ruta)

        if previo is None:
            nuevas.append(ruta)
        else:
            version_previa, hash_previo = previo
            if version_previa == version and hash_previo != hash_actual:
                errores.append(
                    f"{ruta} CAMBIÓ de contenido y su ?v= sigue en {version}. "
                    f"Súbelo a ?v={int(version) + 1} en: {paginas}"
                )
        actualizado[ruta] = (version, hash_actual)

    if not errores and "--actualizar" in sys.argv:
        escribir_referencia(actualizado)
        print(f"referencia actualizada: {REFERENCIA.relative_to(RAIZ)}")
    elif "--actualizar" in sys.argv and errores:
        print("no actualizo la referencia: primero hay que resolver los errores de arriba\n")

    print(f"Archivos versionados revisados: {len(actualizado)}")
    if nuevas:
        print(f"  nuevos (sin referencia previa, se aceptan): {', '.join(nuevas)}")
    if sin_version:
        total = sum(len(p) for p in sin_version.values())
        print(f"AVISO — {total} referencias SIN ?v= en {len(sin_version)} archivos "
              f"(un cambio ahí no rompe la caché: ya la rompe para siempre)")
        for ruta in sorted(sin_version)[:12]:
            print(f"    {ruta}: {', '.join(sorted(set(sin_version[ruta])))}")

    if errores:
        print(f"\n{len(errores)} hallazgo(s):")
        for e in errores:
            print(f"  ✗ {e}")
        print("\nCada archivo que cambia necesita su ?v= nuevo: con el service worker, sin eso el")
        print("navegador sigue sirviendo la copia vieja y parece que el cambio no se desplegó.")
        return 1

    print("Todo en orden: ningún archivo cambió sin subir su versión.")
    return 0


if __name__ == "__main__":
    sys.exit(revisar())
