import asyncio
import io
import logging
import os
from contextlib import asynccontextmanager
from typing import Literal

import ollama
from faster_whisper import WhisperModel
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

logger = logging.getLogger("uvicorn.error")

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma3:4b")
# Whisper runs on CPU so the GPU's VRAM stays free for the LLM
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")


class Message(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str
    # Base64-encoded images (no data: URL prefix); requires a vision-capable model
    images: list[str] | None = None


class ChatRequest(BaseModel):
    messages: list[Message]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Share a single client (and its connection pool) across requests
    app.state.ollama = ollama.AsyncClient(host=OLLAMA_HOST)
    # Whisper is loaded lazily on the first /stt call (the first load downloads the model)
    app.state.whisper = None
    app.state.whisper_lock = asyncio.Lock()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/")
def read_root():
    return {"hello": "world"}


@app.post("/echo", response_class=PlainTextResponse)
async def echo_string(request: Request):
    # Return the raw body as-is (as text, not JSON-encoded)
    body = await request.body()
    return PlainTextResponse(body.decode("utf-8", errors="replace"))


@app.post("/ollama")
async def forward_to_ollama(chat: ChatRequest, request: Request):
    """
    Forward the request messages to the Ollama service and return only the message.
    """
    client: ollama.AsyncClient = request.app.state.ollama
    try:
        response = await client.chat(
            model=OLLAMA_MODEL,
            messages=[m.model_dump(exclude_none=True) for m in chat.messages],
        )
    except ollama.ResponseError as e:
        logger.exception("Ollama returned an error")
        if e.status_code == 404:
            raise HTTPException(
                status_code=502,
                detail=f"Model '{OLLAMA_MODEL}' is not available on Ollama. Pull it first.",
            )
        raise HTTPException(status_code=502, detail="Ollama returned an error")
    except Exception:
        logger.exception("Failed to reach Ollama")
        raise HTTPException(status_code=502, detail="Failed to reach Ollama")

    # Return only the message part
    return {"role": response.message.role, "content": response.message.content}


async def get_whisper(app: FastAPI) -> WhisperModel:
    async with app.state.whisper_lock:
        if app.state.whisper is None:
            app.state.whisper = await asyncio.to_thread(
                WhisperModel, WHISPER_MODEL, device="cpu", compute_type="int8"
            )
    return app.state.whisper


def transcribe(model: WhisperModel, audio: bytes) -> str:
    segments, _ = model.transcribe(io.BytesIO(audio), language="ja", vad_filter=True)
    return "".join(s.text for s in segments).strip()


@app.post("/stt")
async def speech_to_text(request: Request):
    """
    Transcribe the raw audio in the request body (any format ffmpeg can decode,
    e.g. audio/webm from MediaRecorder) and return {"text": ...}.
    """
    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=400, detail="Empty audio")

    try:
        model = await get_whisper(request.app)
    except Exception:
        logger.exception("Failed to load Whisper model")
        raise HTTPException(status_code=500, detail="Failed to load speech recognition model")

    try:
        text = await asyncio.to_thread(transcribe, model, audio)
    except Exception:
        logger.exception("Transcription failed")
        raise HTTPException(status_code=400, detail="Could not transcribe the audio")

    return {"text": text}
