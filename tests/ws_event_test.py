#!/usr/bin/env python3
"""Prueba de punta a punta del tiempo real del personal.

Comprueba lo que el dueño pidió: que el mapa del salón se entere de los cambios SIN botón de
actualizar y sin sondear. El camino es: la app cambia algo -> DiningSession::broadcast() firma
un token y avisa al canal `store:<id>` -> el relay lo reparte -> la pantalla lo recibe.

Uso: python3 tests/ws_event_test.py <base_url> <ws_host> <ws_port> [usuario] [clave]
Ej.: python3 tests/ws_event_test.py http://127.0.0.1:18099 127.0.0.1 18765 admin admin123
"""
import base64
import http.cookiejar
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18099"
WS_HOST = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
WS_PORT = int(sys.argv[3]) if len(sys.argv) > 3 else 18765
USUARIO = sys.argv[4] if len(sys.argv) > 4 else "admin"
CLAVE = sys.argv[5] if len(sys.argv) > 5 else "admin123"

PASS = 0
FAIL = 0


def ok(nombre, detalle=""):
    global PASS
    PASS += 1
    print(f"PASS | {nombre}{(' — ' + detalle) if detalle else ''}")


def mal(nombre, detalle=""):
    global FAIL
    FAIL += 1
    print(f"FAIL | {nombre}{(' — ' + detalle) if detalle else ''}")


cookies = http.cookiejar.CookieJar()
abridor = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))


def api(ruta, datos=None, metodo=None):
    url = BASE + ruta
    cuerpo = json.dumps(datos).encode() if datos is not None else None
    peticion = urllib.request.Request(url, data=cuerpo, method=metodo or ("POST" if datos else "GET"))
    peticion.add_header("Content-Type", "application/json")
    try:
        with abridor.open(peticion, timeout=20) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode() or "{}")
        except Exception:
            return {"success": False, "message": f"HTTP {e.code}"}


# ── WebSocket a mano (sin dependencias) ────────────────────────────────────
def ws_conectar(canal, token, exp, timeout=8):
    s = socket.create_connection((WS_HOST, WS_PORT), timeout=timeout)
    key = base64.b64encode(os.urandom(16)).decode()
    ruta = f"/?session={canal}&token={token}&exp={exp}"
    s.sendall((
        f"GET {ruta} HTTP/1.1\r\nHost: {WS_HOST}:{WS_PORT}\r\nUpgrade: websocket\r\n"
        f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    ).encode())
    datos = b""
    while b"\r\n\r\n" not in datos:
        trozo = s.recv(1024)
        if not trozo:
            break
        datos += trozo
    cabecera = datos.split(b"\r\n\r\n", 1)[0].decode("latin1")
    codigo = cabecera.split(" ")[1] if " " in cabecera else "?"
    if codigo != "101":
        s.close()
        return None
    return s


def ws_leer(s, timeout=8):
    s.settimeout(timeout)
    try:
        cab = s.recv(2)
    except socket.timeout:
        return None
    if len(cab) < 2:
        return None
    largo = cab[1] & 0x7F
    if largo == 126:
        largo = int.from_bytes(s.recv(2), "big")
    elif largo == 127:
        largo = int.from_bytes(s.recv(8), "big")
    datos = b""
    while len(datos) < largo:
        trozo = s.recv(largo - len(datos))
        if not trozo:
            break
        datos += trozo
    return datos.decode("utf-8", "replace")


print(f"===== Tiempo real del personal — app {BASE} / relay {WS_HOST}:{WS_PORT} =====")

# 1. Entrar como personal y pedir el token del canal de la tienda
login = api("/api/auth/login.php", {"username": USUARIO, "password": CLAVE})
if not login.get("success"):
    print(f"SKIP | no se pudo entrar como {USUARIO}: {login.get('message')}")
    sys.exit(0)
store_id = (login.get("data") or {}).get("user", {}).get("store_id") or 1

firma = api(f"/api/ws/token.php?canal=store:{store_id}")
if not firma.get("success"):
    mal("token del canal de la tienda", str(firma)[:120])
    sys.exit(1)
ok("token del canal de la tienda", f"store:{store_id}")

# 2. Suscribirse al canal de la tienda
s = ws_conectar(firma["data"]["canal"], firma["data"]["token"], firma["data"]["exp"])
if not s:
    mal("suscripción al canal de la tienda")
    sys.exit(1)
ok("suscripción al canal de la tienda")

# 3. Un punto de servicio y una cuenta: abrir debe avisar por el canal
punto = api("/api/dining/tables.php", {"label": f"Prueba tiempo real {int(time.time()) % 100000}"})
if not punto.get("success"):
    mal("crear el punto de prueba", str(punto)[:120])
    sys.exit(1)
table_id = punto["data"]["table_id"]

cuenta = api("/api/dining/session.php", {"action": "open_table", "table_id": table_id})
if not cuenta.get("success"):
    mal("abrir la cuenta del punto", str(cuenta)[:120])
    sys.exit(1)
session_id = cuenta["data"]["session_id"]

mensaje = ws_leer(s)
if mensaje and "session_opened" in mensaje and f'"session":"{session_id}"' in mensaje:
    ok("abrir una cuenta avisa al canal de la tienda", "session_opened")
else:
    mal("abrir una cuenta avisa al canal de la tienda", str(mensaje)[:120])

# 4. Cancelar la cuenta debe avisar también
api("/api/dining/session.php", {"action": "cancel", "session_id": session_id, "reason": "prueba automatica"})
mensaje = ws_leer(s)
if mensaje and "session_cancelled" in mensaje:
    ok("cancelar una cuenta avisa al canal de la tienda", "session_cancelled")
else:
    mal("cancelar una cuenta avisa al canal de la tienda", str(mensaje)[:120])

# Limpieza: el punto de prueba no debe quedar
api(f"/api/dining/tables.php?table_id={table_id}&force=1", metodo="DELETE")
if s:
    s.close()

print()
print(f"===== RESULTADO tiempo real: {PASS} pasaron, {FAIL} fallaron =====")
sys.exit(FAIL)
