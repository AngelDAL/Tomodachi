#!/usr/bin/env python3
"""Minimal WebSocket relay for Tomodachi (customer displays + servicio en mesa).

Clients join a channel. A client sends messages of an allowed type and the relay
fans them out to the OTHER clients in the SAME channel. The service stores no
data on purpose: the durable snapshot always lives in the HTTP API.

Canales:
  - UUID del carrito      -> display de cliente (el UUID es aleatorio de 128 bits,
                             así que no lleva token: no se puede adivinar)
  - session_id (numérico) -> cuenta de servicio / mesa. LLEVA TOKEN: es un entero
                             corto y adivinable, y con él se ve el pedido de una
                             mesa ajena.
  - store:<id>            -> pantallas del personal (mapa de puntos de servicio).
                             LLEVA TOKEN, siempre.
  - store:<id>:station:<n>-> pantalla de una estación de preparación. LLEVA TOKEN.

El token es HMAC-SHA256(secreto, "<canal>|<expiración>") y lo firma la app
(includes/WsToken.class.php) con el mismo WS_SECRET que recibe este servicio.
Sin WS_SECRET configurado el relay RECHAZA los canales que exigen token: fallar
cerrado es mejor que aceptar a cualquiera.
"""
import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import time
from collections import defaultdict
from urllib.parse import parse_qs, urlparse

HOST = os.getenv("WS_HOST", "0.0.0.0")
PORT = int(os.getenv("WS_PORT", "8765"))
WS_SECRET = (os.getenv("WS_SECRET") or "").strip()
MAX_MESSAGE_BYTES = 1_000_000
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
# Canales aceptados: UUID del carrito, session_id numérico, y los canales de la app
# (store:<id> y store:<id>:station:<n>).
CHANNEL_RE = re.compile(
    r"^(?:"
    r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
    r"|[0-9]{1,20}"
    r"|store:[0-9]{1,20}(?::station:[0-9]{1,20})?"
    r")$",
    re.I,
)
CLIENTS: dict[str, set[asyncio.StreamWriter]] = defaultdict(set)
CLIENT_LOCK = asyncio.Lock()

# Aviso único (no por petición) de que falta el secreto: si no está, los canales
# con token no pueden validarse y es mejor decirlo en el log que fallar en silencio.
_SECRETO_AVISADO = False


def canal_exige_token(canal: str) -> bool:
    """El UUID del carrito es aleatorio (no adivinable); lo demás sí lleva token."""
    if UUID_RE.fullmatch(canal):
        return False
    return True


def token_valido(canal: str, token: str, exp: str) -> bool:
    global _SECRETO_AVISADO
    if WS_SECRET == "":
        if not _SECRETO_AVISADO:
            print("[ws] WS_SECRET no configurado: se rechazan los canales que exigen token", flush=True)
            _SECRETO_AVISADO = True
        return False
    if not token or not exp.isdigit():
        return False
    if int(exp) < int(time.time()):
        return False
    esperado = hmac.new(
        WS_SECRET.encode(), f"{canal}|{int(exp)}".encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(esperado, token)


def websocket_accept(key: str) -> str:
    return base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()


async def send_frame(writer: asyncio.StreamWriter, payload: str, opcode: int = 0x1) -> None:
    data = payload.encode()
    size = len(data)
    header = bytes([0x80 | opcode])
    if size < 126:
        header += bytes([size])
    elif size < 65536:
        header += bytes([126]) + size.to_bytes(2, "big")
    else:
        header += bytes([127]) + size.to_bytes(8, "big")
    writer.write(header + data)
    await writer.drain()


async def read_frame(reader: asyncio.StreamReader):
    first = await reader.readexactly(2)
    opcode = first[0] & 0x0F
    masked = bool(first[1] & 0x80)
    size = first[1] & 0x7F
    if size == 126:
        size = int.from_bytes(await reader.readexactly(2), "big")
    elif size == 127:
        size = int.from_bytes(await reader.readexactly(8), "big")
    if size > MAX_MESSAGE_BYTES:
        raise ValueError("message too large")
    mask = await reader.readexactly(4) if masked else b""
    data = bytearray(await reader.readexactly(size))
    if masked:
        for i in range(size):
            data[i] ^= mask[i % 4]
    return opcode, data.decode("utf-8", errors="replace")


async def broadcast(session: str, payload: str, sender: asyncio.StreamWriter) -> None:
    async with CLIENT_LOCK:
        recipients = list(CLIENTS[session] - {sender})
    stale = []
    for writer in recipients:
        try:
            await send_frame(writer, payload)
        except (ConnectionError, asyncio.IncompleteReadError):
            stale.append(writer)
    if stale:
        async with CLIENT_LOCK:
            CLIENTS[session].difference_update(stale)


async def handle_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    session = None
    try:
        request_line = (await reader.readline()).decode("latin1").strip()
        match = re.match(r"^GET\s+(\S+)\s+HTTP/1\.1$", request_line)
        if not match:
            raise ValueError("invalid request")
        headers = {}
        while True:
            line = await reader.readline()
            if line in (b"\r\n", b"\n", b""):
                break
            name, value = line.decode("latin1").split(":", 1)
            headers[name.lower()] = value.strip()
        parsed = urlparse(match.group(1))
        query = parse_qs(parsed.query)
        session = query.get("session", [""])[0]
        token = query.get("token", [""])[0]
        exp = query.get("exp", [""])[0]
        key = headers.get("sec-websocket-key", "")
        if parsed.path != "/" or not CHANNEL_RE.fullmatch(session) or not key:
            writer.write(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
            await writer.drain()
            return
        # Canales de cuenta y de tienda exigen token firmado por la app. El UUID del
        # carrito no, porque es aleatorio de 128 bits y no se puede adivinar.
        if canal_exige_token(session) and not token_valido(session, token, exp):
            writer.write(b"HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n")
            await writer.drain()
            return
        if session.startswith("store:"):
            print(f"[ws] pantalla del personal suscrita al canal {session}", flush=True)
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {websocket_accept(key)}\r\n\r\n"
        )
        writer.write(response.encode())
        await writer.drain()
        async with CLIENT_LOCK:
            CLIENTS[session].add(writer)
        while True:
            opcode, payload = await read_frame(reader)
            if opcode == 0x8:
                break
            if opcode == 0x9:
                await send_frame(writer, payload, opcode=0xA)
                continue
            if opcode != 0x1:
                continue
            message = json.loads(payload)
            tipo = message.get("type")
            # ping: las pantallas que pasan mucho tiempo sin cambios (el mapa del salón, la
            # pantalla de una estación) lo mandan para que el túnel no cierre el socket por
            # inactividad. Se responde solo a quien pregunta y NO se reparte a los demás.
            if tipo == "ping":
                await send_frame(writer, json.dumps({"type": "pong"}), opcode=0x1)
                continue
            # El relay es genérico por canal: cada tipo es un mensaje que algunos
            # clientes quieren reenviar a los demás del mismo canal.
            #   cart_update  -> carrito del punto de venta
            #   order_update -> cambios de la cuenta por mesa (pedido/comanda)
            if tipo not in {"cart_update", "order_update"}:
                continue
            await broadcast(session, json.dumps(message, separators=(",", ":")), writer)
    except (asyncio.IncompleteReadError, ConnectionError, ValueError, json.JSONDecodeError):
        pass
    finally:
        if session:
            async with CLIENT_LOCK:
                CLIENTS[session].discard(writer)
                if not CLIENTS[session]:
                    CLIENTS.pop(session, None)
        writer.close()
        try:
            await writer.wait_closed()
        except ConnectionError:
            pass


async def main() -> None:
    server = await asyncio.start_server(handle_client, HOST, PORT)
    print(f"Tomodachi customer-display WebSocket listening on {HOST}:{PORT}", flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
