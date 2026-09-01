#!/usr/bin/env python3
"""Minimal WebSocket relay for Tomodachi customer displays.

Clients join a channel identified by the existing cart UUID. A POS browser sends
cart_update messages; all other clients in the same UUID channel receive them.
The service intentionally stores no cart data: cart_sync.php remains the durable
HTTP snapshot used for first load and reconnection fallback.
"""
import asyncio
import base64
import hashlib
import json
import os
import re
from collections import defaultdict
from urllib.parse import parse_qs, urlparse

HOST = os.getenv("WS_HOST", "0.0.0.0")
PORT = int(os.getenv("WS_PORT", "8765"))
MAX_MESSAGE_BYTES = 1_000_000
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
CLIENTS: dict[str, set[asyncio.StreamWriter]] = defaultdict(set)
CLIENT_LOCK = asyncio.Lock()


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
        session = parse_qs(parsed.query).get("session", [""])[0]
        key = headers.get("sec-websocket-key", "")
        if parsed.path != "/" or not UUID_RE.fullmatch(session) or not key:
            writer.write(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
            await writer.drain()
            return
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
            if message.get("type") != "cart_update":
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
