#!/usr/bin/env python3
"""Driver de concurrencia HTTP para la puerta de raíles del SSE del carrito.

Abre N conexiones concurrentes contra un nginx real (un solo proceso, sin
`fork` storm), registra el código de estado de cada una y, si se pide, dispara
una petición de sonda MIENTRAS las N siguen abiertas. Sirve para medir dos
cosas que no se ven con `curl` secuencial:

  * cuántas conexiones anónimas al SSE admite nginx a la vez,
  * si la instalación sigue atendiendo peticiones normales mientras esas
    conexiones ocupan workers de php-fpm.

Salida: un JSON por stdout (lo consume `verify_sse_rails_nodocker.sh`).

Uso:
  python3 docker/sse_rails_probe.py --port 18090 --n 48 --sessions same \
      --url '/api/sales/cart_sse.php?session={session}' --json out.json
"""
import argparse
import asyncio
import json
import time
import uuid


def new_uuid():
    return str(uuid.uuid4())


async def one_connection(idx, host, port, path, read_timeout, hold, t0):
    """Abre una conexión, manda la petición y devuelve su veredicto.

    `status` es el código HTTP; `None` significa que no hubo respuesta dentro
    de `read_timeout` (conexión encolada detrás de un pool saturado, por
    ejemplo). `t` es el tiempo hasta las cabeceras.
    """
    res = {"i": idx, "status": None, "t": None, "error": None, "ct": None}
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=read_timeout)
    except (asyncio.TimeoutError, OSError) as e:
        res["error"] = "connect:" + type(e).__name__
        res["t"] = round(time.monotonic() - t0, 3)
        return res
    try:
        writer.write(
            ("GET %s HTTP/1.1\r\nHost: %s:%d\r\n"
             "Accept: text/event-stream\r\nConnection: close\r\n\r\n"
             % (path, host, port)).encode())
        await writer.drain()
        head = b""
        deadline = time.monotonic() + read_timeout
        while b"\r\n\r\n" not in head:
            left = deadline - time.monotonic()
            if left <= 0:
                res["error"] = "no-headers-timeout"
                break
            try:
                chunk = await asyncio.wait_for(reader.read(4096), left)
            except asyncio.TimeoutError:
                res["error"] = "no-headers-timeout"
                break
            except OSError as e:
                res["error"] = "read:" + type(e).__name__
                break
            if not chunk:
                break
            head += chunk
        if head.startswith(b"HTTP/"):
            res["status"] = int(head.split(b" ", 2)[1])
            for line in head.split(b"\r\n"):
                if line.lower().startswith(b"content-type:"):
                    res["ct"] = line.split(b":", 1)[1].strip().decode("latin-1")
            res["t"] = round(time.monotonic() - t0, 3)
            if res["status"] == 200 and hold > 0:
                # Mantener la conexión abierta: es lo que ocupa un worker.
                await asyncio.sleep(hold)
        elif res["error"] is None:
            res["error"] = "no-http-response"
    except OSError as e:
        res["error"] = "io:" + type(e).__name__
    finally:
        try:
            writer.close()
        except Exception:
            pass
        if res["t"] is None:
            res["t"] = round(time.monotonic() - t0, 3)
    return res


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--url", required=True,
                    help="ruta; `{session}` se sustituye por el UUID de la prueba")
    ap.add_argument("--n", type=int, required=True)
    ap.add_argument("--sessions", choices=["same", "unique"], default="unique",
                    help="misma sesión de carrito (amplificación) o una por conexión")
    ap.add_argument("--hold", type=float, default=6.0,
                    help="segundos que se mantiene abierta cada conexión admitida")
    ap.add_argument("--read-timeout", type=float, default=12.0,
                    help="segundos de espera de cabeceras por conexión")
    ap.add_argument("--probe-url", default=None,
                    help="petición normal que se dispara con las N abiertas")
    ap.add_argument("--probe-timeout", type=float, default=15.0)
    ap.add_argument("--json", default=None, help="archivo donde dejar el JSON")
    a = ap.parse_args()

    sess = new_uuid()
    paths = [a.url.replace("{session}", sess if a.sessions == "same" else new_uuid())
             for _ in range(a.n)]

    t0 = time.monotonic()
    tasks = [asyncio.create_task(
        one_connection(i, a.host, a.port, p, a.read_timeout, a.hold, t0))
        for i, p in enumerate(paths)]

    probe = None
    if a.probe_url:
        while any(not t.done() for t in tasks):
            await asyncio.sleep(0.05)
        probe = await one_connection(-1, a.host, a.port, a.probe_url,
                                     a.probe_timeout, 0.0, t0)

    results = await asyncio.gather(*tasks)
    out = {"port": a.port, "n": a.n, "sessions": a.sessions, "session": sess,
           "hold": a.hold, "read_timeout": a.read_timeout,
           "wall_s": round(time.monotonic() - t0, 3),
           "results": results, "probe": probe}
    text = json.dumps(out)
    if a.json:
        with open(a.json, "w") as fh:
            fh.write(text)
    print(text)


asyncio.run(main())
