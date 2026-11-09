#!/usr/bin/env python3
"""Interfaz web del agente de ventas: API FastAPI con streaming (SSE) y frontend estático."""

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import json
import logging
from pathlib import Path
import time
from uuid import uuid4

from copilot.session_events import SessionEventType
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from agente_ventas import DB_PATH, DEFAULT_MODEL, create_client, create_sales_session, get_api_key


logger = logging.getLogger("agente_ventas.web")
STATIC_DIR = Path(__file__).resolve().parent / "static"
MAX_SESSIONS = 50
TURN_TIMEOUT = 180  # segundos máximos por respuesta


@dataclass
class ChatEntry:
    session: object
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    last_used: float = field(default_factory=time.monotonic)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    session_id: str | None = None


class ResetRequest(BaseModel):
    session_id: str


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not DB_PATH.is_file():
        raise RuntimeError(f"No existe la base de datos: {DB_PATH}")
    get_api_key()  # falla al arrancar si no hay clave
    client = create_client()
    await client.start()
    app.state.client = client
    app.state.sessions: dict[str, ChatEntry] = {}
    app.state.sessions_lock = asyncio.Lock()
    try:
        yield
    finally:
        await client.stop()


app = FastAPI(title="Agente de ventas", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
async def health():
    return {"status": "ok", "model": DEFAULT_MODEL}


async def _drop_session(entry: ChatEntry) -> None:
    try:
        await entry.session.disconnect()
    except Exception:
        logger.exception("No se pudo cerrar la sesión")


async def _get_or_create(session_id: str | None) -> tuple[str, ChatEntry]:
    async with app.state.sessions_lock:
        sessions: dict[str, ChatEntry] = app.state.sessions
        if session_id and session_id in sessions:
            entry = sessions[session_id]
            entry.last_used = time.monotonic()
            return session_id, entry

        if len(sessions) >= MAX_SESSIONS:
            # Expulsa la conversación inactiva más antigua.
            idle = [(e.last_used, sid) for sid, e in sessions.items() if not e.lock.locked()]
            if not idle:
                raise HTTPException(503, "Hay demasiadas conversaciones activas.")
            _, oldest = min(idle)
            await _drop_session(sessions.pop(oldest))

        try:
            session = await create_sales_session(app.state.client)
        except Exception:
            logger.exception("No se pudo crear la sesión del agente")
            raise HTTPException(502, "No se pudo iniciar el agente.")
        new_id = str(uuid4())
        sessions[new_id] = ChatEntry(session)
        return new_id, sessions[new_id]


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _tool_result_summary(data) -> dict:
    """Extrae nº de filas / error del resultado de query_sales."""
    if not data.success:
        error = getattr(data, "error", None)
        return {"ok": False, "error": getattr(error, "message", None) or "Error en la herramienta"}
    content = getattr(getattr(data, "result", None), "content", None)
    try:
        parsed = json.loads(content) if isinstance(content, str) else None
    except ValueError:
        parsed = None
    if isinstance(parsed, dict):
        if "error" in parsed:
            return {"ok": False, "error": str(parsed["error"])}
        return {"ok": True, "count": parsed.get("count"), "truncated": parsed.get("truncated", False)}
    return {"ok": True}


@app.post("/api/chat")
async def chat(body: ChatRequest, request: Request):
    message = body.message.strip()
    if not message:
        raise HTTPException(422, "Escribe un mensaje.")
    session_id, entry = await _get_or_create(body.session_id)
    if entry.lock.locked():
        raise HTTPException(409, "El agente todavía está respondiendo en esta conversación.")

    async def stream():
        async with entry.lock:
            loop = asyncio.get_running_loop()
            queue: asyncio.Queue = asyncio.Queue()

            def on_event(event):
                loop.call_soon_threadsafe(queue.put_nowait, event)

            unsubscribe = entry.session.on(on_event)
            finished = False
            try:
                yield _sse("session", {"session_id": session_id})
                await entry.session.send(message)
                deadline = loop.time() + TURN_TIMEOUT
                while True:
                    remaining = deadline - loop.time()
                    if remaining <= 0:
                        yield _sse("error", {"message": "El agente tardó demasiado en responder."})
                        break
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=min(remaining, 15))
                    except asyncio.TimeoutError:
                        if await request.is_disconnected():
                            break
                        yield ": keep-alive\n\n"
                        continue

                    kind, data = event.type, event.data
                    if kind == SessionEventType.ASSISTANT_MESSAGE_DELTA:
                        if data.delta_content:
                            yield _sse("delta", {"text": data.delta_content})
                    elif kind == SessionEventType.TOOL_EXECUTION_START:
                        args = data.arguments if isinstance(data.arguments, dict) else {}
                        yield _sse("tool_start", {
                            "id": data.tool_call_id,
                            "name": data.tool_name,
                            "sql": args.get("sql", ""),
                        })
                    elif kind == SessionEventType.TOOL_EXECUTION_COMPLETE:
                        yield _sse("tool_end", {"id": data.tool_call_id, **_tool_result_summary(data)})
                    elif kind == SessionEventType.SESSION_ERROR:
                        logger.error("Error de sesión: %s", data)
                        yield _sse("error", {"message": getattr(data, "message", None) or "Error del agente."})
                        break
                    elif kind == SessionEventType.SESSION_IDLE:
                        finished = True
                        yield _sse("done", {})
                        break
            except Exception:
                logger.exception("Fallo durante la respuesta del agente")
                yield _sse("error", {"message": "El agente no pudo responder. Inténtalo de nuevo."})
            finally:
                unsubscribe()
                entry.last_used = time.monotonic()
                if not finished:
                    try:
                        await entry.session.abort()
                    except Exception:
                        pass

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/reset")
async def reset(body: ResetRequest):
    async with app.state.sessions_lock:
        entry = app.state.sessions.pop(body.session_id, None)
    if entry is not None:
        await _drop_session(entry)
    return {"status": "ok"}


if __name__ == "__main__":
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="Interfaz web del agente de ventas")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(app, host=args.host, port=args.port)
