import asyncio
import io
import logging
import os
import re
from contextlib import asynccontextmanager
from typing import Literal

import httpx
import ollama
from faster_whisper import WhisperModel
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field

logger = logging.getLogger("uvicorn.error")

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma3:4b")
# Whisper runs on CPU so the GPU's VRAM stays free for the LLM
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
VOICEVOX_HOST = os.getenv("VOICEVOX_HOST", "http://localhost:50021")
# Speaker style ID (GET {VOICEVOX_HOST}/speakers lists them); 3 = ずんだもん (ノーマル)
VOICEVOX_SPEAKER = int(os.getenv("VOICEVOX_SPEAKER", "3"))

DESCRIBE_PROMPT = (
    "この画像は、AI であるあなたの目の役割をするカメラの映像で、写っている人物はあなたの会話相手です。"
    "会話相手の様子・表情・手に持っている物・周囲の状況を、日本語で2〜3文で簡潔に説明してください。"
    "「画像には」「写真には」ではなく「目の前の人は〜」のように書いてください。"
)


class Message(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str
    # Base64-encoded images (no data: URL prefix); requires a vision-capable model
    images: list[str] | None = None


class ChatRequest(BaseModel):
    messages: list[Message]


class DescribeRequest(BaseModel):
    # Base64-encoded image (no data: URL prefix)
    image: str = Field(min_length=1)


class TTSRequest(BaseModel):
    text: str = Field(min_length=1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Share a single client (and its connection pool) across requests
    app.state.ollama = ollama.AsyncClient(host=OLLAMA_HOST)
    # Whisper is loaded lazily on the first /stt call (the first load downloads the model)
    app.state.whisper = None
    app.state.whisper_lock = asyncio.Lock()
    # Synthesis of long text on CPU can take a while
    app.state.voicevox = httpx.AsyncClient(base_url=VOICEVOX_HOST, timeout=60)
    yield
    await app.state.voicevox.aclose()


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


@app.post("/describe")
async def describe_image(req: DescribeRequest, request: Request):
    """
    Describe a camera frame in a few sentences and return {"text": ...}.
    The client calls this in the background so replies can use the text
    instead of encoding an image on every turn.
    """
    client: ollama.AsyncClient = request.app.state.ollama
    try:
        response = await client.chat(
            model=OLLAMA_MODEL,
            messages=[{"role": "user", "content": DESCRIBE_PROMPT, "images": [req.image]}],
            options={"num_predict": 120},
        )
    except Exception:
        logger.exception("Failed to describe the image")
        raise HTTPException(status_code=502, detail="Failed to describe the image")

    return {"text": response.message.content.strip()}


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


@app.post("/tts")
async def text_to_speech(tts: TTSRequest, request: Request):
    """
    Synthesize Japanese speech with VOICEVOX and return it as audio/wav.
    """
    # Drop Markdown symbols the LLM tends to emit so they aren't read aloud
    text = re.sub(r"[*#`_~>|]", "", tts.text).strip()
    if not text:
        raise HTTPException(status_code=400, detail="Nothing to speak")

    client: httpx.AsyncClient = request.app.state.voicevox
    params = {"speaker": VOICEVOX_SPEAKER}
    try:
        query = await client.post("/audio_query", params={**params, "text": text})
        query.raise_for_status()
        audio = await client.post("/synthesis", params=params, json=query.json())
        audio.raise_for_status()
    except Exception:
        logger.exception("VOICEVOX request failed")
        raise HTTPException(status_code=502, detail="Failed to synthesize speech")

    return Response(content=audio.content, media_type="audio/wav")
