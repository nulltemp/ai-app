# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A desktop AI chat app in early development, consisting of two independent projects in one repo:

- `client-tauri/` — Tauri + React + TypeScript desktop app (the UI).
- `server/` — FastAPI backend that proxies chat requests to a local Ollama instance.

The client talks to the server over plain HTTP at `http://127.0.0.1:8000` (see `client-tauri/src-tauri/capabilities/default.json`, which allowlists this URL for the Tauri HTTP plugin). The server talks to Ollama via the `ollama` Python library at `OLLAMA_HOST` (default `http://localhost:11434`; Docker Compose sets it to `http://ollama:11434`). There is no shared package/workspace tying the two projects together — treat them as separate build/run environments.

## Commands

### Server (`server/`)

Requires Python 3.14+.

```bash
cd server
python -m venv venv
.\venv\Scripts\activate        # Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

After adding a new dependency, refresh the lockfile:
```bash
pip freeze > requirements.txt
```

No test suite or linter is currently configured for the server.

### Client (`client-tauri/`)

```bash
cd client-tauri
npm install
npm run dev        # Vite dev server only (port 1420)
npm run tauri dev  # full Tauri app (spawns Vite dev server itself)
npm run build       # tsc typecheck + vite build
npm run tauri build # produce native app bundle
```

No test suite is currently configured for the client. `npm run build` runs `tsc` for typechecking as part of the build.

### Full stack via Docker

```bash
docker-compose up --build
```

Starts `server` (port 8000), `ollama` (port 11434) and `voicevox` (port 50021) as containers, the latter two bound to 127.0.0.1 only; the client is run separately (Tauri apps are not containerized). The server container bind-mounts `./server` into `/app` and Compose overrides the command to run uvicorn with `--reload`, so edits are picked up live. The `ollama` service reserves the NVIDIA GPU (requires Docker Desktop with the WSL2 backend and an NVIDIA driver). The model must be pulled once: `docker compose exec ollama ollama pull gemma3:4b`. Whisper models are downloaded on first use into the `hf_cache` volume.

## Architecture notes

- **Server (`server/main.py`)** is a single-file FastAPI app with these routes: `GET /` (health check), `POST /echo` (echoes the raw request body back, used to sanity-check client connectivity), and `POST /ollama` (body validated by the `ChatRequest` Pydantic model, forwarded to Ollama's chat API via a single shared `ollama.AsyncClient` created in the FastAPI lifespan, returns `{"role", "content"}`). Invalid bodies return 422; Ollama failures are logged and returned as a generic 502. Model and host come from `OLLAMA_MODEL` (default `gemma3:4b`, a vision-capable model) and `OLLAMA_HOST`.
  - `POST /describe` takes `{"image": <base64 JPEG>}` and returns `{"text"}`, a short Japanese description of the camera frame by the same model. The client calls it in the background every few seconds (skipped while a reply is generating) and sends the latest description as a `system` message instead of attaching an image, so replies don't wait ~8s for image encoding; it only attaches a frame until the first description arrives.
  - `POST /stt` takes raw audio as the request body (e.g. `audio/webm` from `MediaRecorder`) and returns `{"text"}`, transcribed in Japanese by faster-whisper on CPU (`WHISPER_MODEL`, default `small`, loaded lazily on first call). `av` is pinned to 18.x because faster-whisper 1.2.1 passes an argument removed in PyAV 19.
  - `POST /tts` takes `{"text"}` and returns `audio/wav` synthesized by the VOICEVOX engine (`VOICEVOX_HOST`, `VOICEVOX_SPEAKER` style ID, default 3). STT and TTS run on CPU so the GPU's VRAM stays free for the LLM.
- **Client (`client-tauri/src/App.tsx`)** is a chat UI (header with camera-panel / read-aloud toggles, a clear button and an `/echo` connection-test popover; `components/MediaPreview.tsx` handles camera/mic selection, preview and frame capture; a record button transcribes speech via `/stt` into the input; `components/Avatar.tsx` renders a VRM model with three.js + `@pixiv/three-vrm` (default `public/models/avatar.vrm`, gitignored, or picked via a file input) and lip-syncs the `aa` expression to the read-aloud audio level from `lipSync.ts`; "会話モード" uses volume-based VAD in `vad.ts` to record one utterance at a time, then transcribes and sends it automatically, pausing listening while the AI is thinking or speaking; scrollable message list, bottom composer where Enter sends and Shift+Enter inserts a newline). Styles live in `App.css` using CSS custom properties with a dark-mode override. The server base URL is the `API_BASE` constant, and the Ollama section keeps the conversation history in state and sends the full history on each request. It uses `@tauri-apps/plugin-http`'s `fetch` (not the browser `fetch`) to call the server, which is required for the request to be permitted by the Tauri capability allowlist. Any new outbound host must be added to `client-tauri/src-tauri/capabilities/default.json` under `http:default` or the request will be blocked at the Tauri layer, not just CORS.
- **Tauri backend (`client-tauri/src-tauri/src/lib.rs`)** registers only the HTTP plugin and exposes no IPC commands. New Rust-side commands should follow the `#[tauri::command]` pattern and be registered via `.invoke_handler(tauri::generate_handler![...])`.
- Frontend-to-backend contract: the client is expected to send `{"messages": [{"role": ..., "content": ..., "images"?: [<base64 JPEG>]}]}` to `/ollama` (an Ollama-style chat message list; the client only attaches a camera frame to the latest user message), and reads `data.content` off the response (checking `res.ok` first and showing `data.detail` on error).
