#!/usr/bin/env python3
"""Rig estático para probar el service worker de Tomodachi sin Docker ni BD.

Sirve el árbol de trabajo (o cualquier raíz) por HTTP con los MIME correctos y
permite forzar 404 en rutas concretas, que es lo que hace falta para probar la
recuperación del precache (un activo que falta no debe tumbar el SW).

Uso:
  python3 tests/sw/static_rig.py --port 18811 [--root .] \
      [--404 /public/assets/images/default-logo.png] [--log /tmp/rig.log]

Se detiene con Ctrl-C o SIGTERM. Es para verificación local, no para producción.
"""

import argparse
import functools
import http.server
import socketserver
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

MIME = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.map': 'application/json',
}


class Rig(http.server.SimpleHTTPRequestHandler):
    forced_404 = set()
    log_path = None
    protocol_version = 'HTTP/1.1'

    def translate_path(self, path):
        return str(Path(super().translate_path(path)).resolve())

    def guess_type(self, path):
        ext = Path(str(path)).suffix.lower()
        return MIME.get(ext) or super().guess_type(path)

    def send_response(self, code, message=None):
        super().send_response(code, message)
        self._status = code

    def _record(self):
        if not self.log_path:
            return
        stamp = datetime.now(timezone.utc).isoformat(timespec='seconds')
        with open(self.log_path, 'a', encoding='utf-8') as fh:
            fh.write(f"{stamp} {getattr(self, '_status', '-')} {self.command} {self.path}\n")

    def send_head(self):
        if self.path.split('?')[0] in self.forced_404:
            self.send_error(404, 'forzado por el rig')
            return None
        return super().send_head()

    def do_GET(self):
        body = self.send_head()
        if body:
            try:
                self.copyfile(body, self.wfile)
            finally:
                body.close()
        self._record()

    def do_HEAD(self):
        self.send_head()
        self._record()

    def log_message(self, fmt, *args):
        sys.stderr.write("rig | " + (fmt % args) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='.')
    ap.add_argument('--port', type=int, default=18811)
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--404', action='append', default=[], dest='forced_404')
    ap.add_argument('--log', default=None)
    args = ap.parse_args()

    root = str(Path(args.root).resolve())
    Rig.forced_404 = set(args.forced_404)
    Rig.log_path = args.log
    handler = functools.partial(Rig, directory=root)

    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer((args.host, args.port), handler) as httpd:
        print(f"rig escuchando en http://{args.host}:{args.port} root={root}", flush=True)
        if args.forced_404:
            print("404 forzado: " + ", ".join(sorted(args.forced_404)), flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            httpd.shutdown()


if __name__ == '__main__':
    threading.stack_size(1 << 20)
    main()
