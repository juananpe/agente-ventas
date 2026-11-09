#!/usr/bin/env python3
"""Versión web del agente de ventas: backend FastAPI + frontend HTML/JS vanilla.

Reutiliza la herramienta, el prompt y la configuración de agente_ventas.py.
Las respuestas se envían al navegador en streaming con Server-Sent Events.
"""

import argparse
import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import json
import os
import uuid

from copilot import CopilotClient
from copilot.session import PermissionHandler
from copilot.session_events import SessionEventType
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import uvicorn

from agente_ventas import DB_PATH, ROOT, SYSTEM_PROMPT, get_api_key, query_sales

STATIC_DIR = ROOT / "static"
DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash"
MODEL = os.environ.get("AGENTE_MODELO", DEFAULT_MODEL)
MAX_SESSIONS = 50
RESPONSE_TIMEOUT = 300.0


@dataclass
class ChatSession:
    session: object
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    queue: asyncio.Queue | None = None


class State:
    client: CopilotClient | None = None
    sessions: dict[str, ChatSession] = {}


state = State()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if not DB_PATH.is_file():
        raise FileNotFoundError(f"No existe la base de datos: {DB_PATH}")
    get_api_key()  # falla pronto si no hay clave
    state.client = CopilotClient(
        mode="empty",
        working_directory=str(ROOT),
        base_directory=str(ROOT / ".copilot-state"),
    )
    await state.client.start()
    try:
        yield
    finally:
        for chat in state.sessions.values():
            try:
                await chat.session.disconnect()
            except Exception:
                pass
        state.sessions.clear()
        await state.client.stop()


app = FastAPI(title="Agente de ventas", lifespan=lifespan)


async def create_chat_session() -> ChatSession:
    loop = asyncio.get_running_loop()
    session = await state.client.create_session(
        on_permission_request=PermissionHandler.approve_all,
        model=MODEL,
        provider={
            "type": "openai",
            "base_url": "https://openrouter.ai/api/v1",
            "wire_api": "responses",
            "api_key": get_api_key(),
        },
        streaming=True,
        tools=[query_sales],
        available_tools=["custom:query_sales"],
        system_message={"mode": "replace", "content": SYSTEM_PROMPT},
    )
    chat = ChatSession(session=session)
    attach_event_handler(chat, loop)
    return chat


def friendly_error(message: str) -> str:
    if "401" in message or "Authentication failed" in message:
        return "OpenRouter rechazó la clave (401). Revisa OPENROUTER_API_KEY en .env y reinicia el servidor."
    if "402" in message:
        return "OpenRouter indica que no hay crédito suficiente (402)."
    if "429" in message:
        return "Demasiadas peticiones a OpenRouter (429). Espera un momento y vuelve a intentarlo."
    return message


def attach_event_handler(chat: ChatSession, loop: asyncio.AbstractEventLoop) -> None:
    """Reenvía los eventos de la sesión del SDK a la cola de la petición en curso."""

    def emit(kind: str, **data) -> None:
        if chat.queue is not None:
            loop.call_soon_threadsafe(chat.queue.put_nowait, {"type": kind, **data})

    def on_event(event) -> None:
        if event.type == SessionEventType.ASSISTANT_MESSAGE_DELTA:
            emit("delta", text=event.data.delta_content or "")
        elif event.type == SessionEventType.TOOL_EXECUTION_START:
            args = event.data.arguments
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    args = {"sql": args}
            sql = args.get("sql", "") if isinstance(args, dict) else str(args or "")
            emit("tool", id=event.data.tool_call_id, sql=sql)
        elif event.type == SessionEventType.TOOL_EXECUTION_COMPLETE:
            emit("tool_done", id=event.data.tool_call_id, success=bool(event.data.success))
        elif event.type == SessionEventType.SESSION_ERROR:
            emit("error", message=friendly_error(getattr(event.data, "message", str(event.data))))

    chat.session.on(on_event)


async def get_chat_session(session_id: str) -> ChatSession:
    chat = state.sessions.get(session_id)
    if chat is None:
        if len(state.sessions) >= MAX_SESSIONS:
            oldest_id = next(iter(state.sessions))
            await drop_session(oldest_id)
        chat = await create_chat_session()
        state.sessions[session_id] = chat
    return chat


async def drop_session(session_id: str) -> None:
    chat = state.sessions.pop(session_id, None)
    if chat is not None:
        try:
            await chat.session.disconnect()
        except Exception:
            pass


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=8, max_length=64)
    message: str = Field(min_length=1, max_length=4000)


class ResetRequest(BaseModel):
    session_id: str = Field(min_length=8, max_length=64)


def sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@app.post("/api/chat")
async def chat(request: ChatRequest):
    try:
        uuid.UUID(request.session_id)
    except ValueError:
        raise HTTPException(400, "session_id no válido")
    chat_session = await get_chat_session(request.session_id)
    if chat_session.lock.locked():
        raise HTTPException(409, "Espera a que termine la respuesta anterior")

    async def stream():
        async with chat_session.lock:
            queue: asyncio.Queue = asyncio.Queue()
            chat_session.queue = queue

            async def run():
                try:
                    response = await chat_session.session.send_and_wait(
                        request.message, timeout=RESPONSE_TIMEOUT
                    )
                    if response is None:
                        queue.put_nowait({"type": "error", "message": "El agente terminó sin responder"})
                except Exception as exc:
                    queue.put_nowait({"type": "error", "message": friendly_error(str(exc) or type(exc).__name__)})
                finally:
                    queue.put_nowait({"type": "done"})

            task = asyncio.create_task(run())
            try:
                while True:
                    item = await queue.get()
                    yield sse(item)
                    if item["type"] == "done":
                        break
            finally:
                chat_session.queue = None
                if not task.done():  # el navegador cortó la conexión
                    try:
                        await chat_session.session.abort()
                    except Exception:
                        pass
                    task.cancel()

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/reset")
async def reset(request: ResetRequest):
    await drop_session(request.session_id)
    return {"ok": True}


@app.get("/api/info")
async def info():
    return {"model": MODEL}


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Interfaz web del agente de ventas")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--modelo", default=MODEL, help="Modelo de OpenRouter")
    args = parser.parse_args()
    os.environ["AGENTE_MODELO"] = args.modelo
    MODEL = args.modelo
    uvicorn.run(app, host=args.host, port=args.port)
