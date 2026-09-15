#!/usr/bin/env python3
"""Prueba del relay de WebSocket: quién entra y quién no.

Habla WebSocket a mano (handshake + frames) para no depender de librerías.

Uso: python3 tests/ws_auth_test.py <host> <puerto> <secreto>
"""
import base64
import hashlib
import hmac
import json
import os
import socket
import sys
import time

HOST = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 18765
SECRETO = sys.argv[3] if len(sys.argv) > 3 else os.getenv("WS_SECRET", "")

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


def firmar(canal, vigencia=300):
    exp = int(time.time()) + vigencia
    firma = hmac.new(SECRETO.encode(), f"{canal}|{exp}".encode(), hashlib.sha256).hexdigest()
    return firma, exp


def handshake(canal, token=None, exp=None, timeout=6):
    """Devuelve (codigo_http, socket) con el socket listo si fue 101."""
    ruta = f"/?session={canal}"
    if token is not None:
        ruta += f"&token={token}&exp={exp}"
    s = socket.create_connection((HOST, PORT), timeout=timeout)
    key = base64.b64encode(os.urandom(16)).decode()
    peticion = (
        f"GET {ruta} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\nUpgrade: websocket\r\n"
        f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    )
    s.sendall(peticion.encode())
    datos = b""
    while b"\r\n\r\n" not in datos:
        trozo = s.recv(1024)
        if not trozo:
            break
        datos += trozo
    cabecera = datos.split(b"\r\n\r\n", 1)[0].decode("latin1")
    codigo = cabecera.split(" ")[1] if " " in cabecera else "?"
    if codigo == "101":
        return codigo, s, datos.split(b"\r\n\r\n", 1)[1] if b"\r\n\r\n" in datos else b""
    s.close()
    return codigo, None, b""


def leer_frame(s, timeout=6):
    """Lee un frame de texto del servidor (sin máscara)."""
    s.settimeout(timeout)
    cab = s.recv(2)
    if len(cab) < 2:
        return None
    opcode = cab[0] & 0x0F
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
    return opcode, datos


def enviar_texto(s, texto):
    """Frame de texto enmascarado (como exige el protocolo del lado cliente)."""
    carga = texto.encode()
    mascara = os.urandom(4)
    cabecera = bytes([0x81])
    n = len(carga)
    if n < 126:
        cabecera += bytes([0x80 | n])
    elif n < 65536:
        cabecera += bytes([0x80 | 126]) + n.to_bytes(2, "big")
    else:
        cabecera += bytes([0x80 | 127]) + n.to_bytes(8, "big")
    enmascarado = bytes(b ^ mascara[i % 4] for i, b in enumerate(carga))
    s.sendall(cabecera + mascara + enmascarado)


print(f"===== Prueba del relay WebSocket — {HOST}:{PORT} =====")
if not SECRETO:
    print("SKIP | no hay secreto: pasa WS_SECRET por argumento")
    sys.exit(0)

# 1. Canal de tienda SIN token: no debe entrar
codigo, _, _ = handshake("store:1")
if codigo == "401":
    ok("canal de tienda sin token -> 401", codigo)
else:
    mal("canal de tienda sin token", f"esperaba 401, obtuve {codigo}")

# 2. Canal de tienda CON token válido: debe entrar
tok, exp = firmar("store:1")
codigo, s1, _ = handshake("store:1", tok, exp)
if codigo == "101":
    ok("canal de tienda con token válido -> 101", codigo)
else:
    mal("canal de tienda con token válido", f"esperaba 101, obtuve {codigo}")

# 3. Canal de cuenta (numérico) SIN token: no debe entrar (era el hueco real)
codigo, _, _ = handshake("999")
if codigo == "401":
    ok("canal de cuenta sin token -> 401", codigo)
else:
    mal("canal de cuenta sin token", f"esperaba 401, obtuve {codigo}")

# 4. Token de OTRO canal (firma válida, canal distinto): no debe entrar
codigo, _, _ = handshake("999", tok, exp)
if codigo == "401":
    ok("token de otro canal -> 401", codigo)
else:
    mal("token de otro canal", f"esperaba 401, obtuve {codigo}")

# 5. Token vencido: no debe entrar
tok_v, exp_v = firmar("store:1", vigencia=-60)
codigo, _, _ = handshake("store:1", tok_v, exp_v)
if codigo == "401":
    ok("token vencido -> 401", codigo)
else:
    mal("token vencido", f"esperaba 401, obtuve {codigo}")

# 6. Token inventado: no debe entrar
codigo, _, _ = handshake("store:1", "0" * 64, exp)
if codigo == "401":
    ok("token inventado -> 401", codigo)
else:
    mal("token inventado", f"esperaba 401, obtuve {codigo}")

# 7. UUID del carrito sin token: SÍ entra (es aleatorio de 128 bits, no adivinable)
codigo, s2, _ = handshake("11111111-2222-4333-8444-555555555555")
if codigo == "101":
    ok("UUID de carrito sin token -> 101 (dispensado a propósito)", codigo)
else:
    mal("UUID de carrito sin token", f"esperaba 101, obtuve {codigo}")

# 8. ping/pong: la pantalla se mantiene viva sin repartir ruido
if s1:
    enviar_texto(s1, json.dumps({"type": "ping"}))
    frame = leer_frame(s1)
    if frame and b'"pong"' in frame[1]:
        ok("responde pong al ping")
    else:
        mal("responde pong al ping", str(frame)[:80])

# 9. El aviso de la app llega por el canal de la tienda
if s1:
    # Otro cliente del mismo canal anuncia un cambio de cuenta; el suscriptor debe verlo.
    tok2, exp2 = firmar("store:1")
    codigo, s3, _ = handshake("store:1", tok2, exp2)
    if codigo == "101":
        enviar_texto(s3, json.dumps({"type": "order_update", "session": "77", "event": "items_added"}))
        frame = leer_frame(s1)
        if frame and b"items_added" in frame[1] and b'"session":"77"' in frame[1]:
            ok("el aviso de una cuenta llega al canal de la tienda")
        else:
            mal("el aviso llega al canal de la tienda", str(frame)[:100])
        s3.close() if s3 else None
    else:
        mal("segundo suscriptor del canal de tienda", f"obtuve {codigo}")

for s in (s1, s2):
    if s:
        s.close()

print()
print(f"===== RESULTADO relay: {PASS} pasaron, {FAIL} fallaron =====")
sys.exit(FAIL)
