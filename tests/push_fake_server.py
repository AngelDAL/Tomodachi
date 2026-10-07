#!/usr/bin/env python3
"""Servidor de prueba que se hace pasar por un servicio de push.
Guarda la última petición (cabeceras + cuerpo) en /tmp/pushreq.json y responde 201."""
import base64, json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

SALIDA = "/tmp/pushreq.json"

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        largo = int(self.headers.get("Content-Length") or 0)
        cuerpo = self.rfile.read(largo)
        with open(SALIDA, "w") as f:
            json.dump({
                "path": self.path,
                "headers": {k.lower(): v for k, v in self.headers.items()},
                "body_b64": base64.b64encode(cuerpo).decode(),
                "largo": len(cuerpo),
            }, f)
        self.send_response(201)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *a):
        pass

if __name__ == "__main__":
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 18998
    HTTPServer(("127.0.0.1", puerto), Handler).serve_forever()
