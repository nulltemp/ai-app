import logging
import os
from contextlib import asynccontextmanager
from typing import Literal

import ollama
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

logger = logging.getLogger("uvicorn.error")

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma3:4b")


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
