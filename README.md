# AI App

ローカルで動く AI チャットのデスクトップアプリです（開発中）。
カメラ映像を見ながら会話し、音声で入力・読み上げができます。

- `client-tauri/` — Tauri + React + TypeScript のデスクトップアプリ
- `server/` — FastAPI のバックエンド（Ollama / 音声認識 / 音声合成の中継）

## 起動方法

```bash
# サーバー一式（server / ollama / voicevox）
docker compose up --build

# 初回のみ：LLM モデルを取得
docker compose exec ollama ollama pull gemma3:4b

# クライアント
cd client-tauri
npm install
npm run tauri dev
```

詳細は [server/README.md](server/README.md) を参照してください。

## 使用している主なソフトウェア・モデル

| 用途 | 使用しているもの |
|---|---|
| LLM | [Ollama](https://ollama.com/) + Gemma 3 (`gemma3:4b`) |
| 音声認識 | [faster-whisper](https://github.com/SYSTRAN/faster-whisper)（Whisper `small`） |
| 音声合成 | [VOICEVOX ENGINE](https://github.com/VOICEVOX/voicevox_engine) |

## クレジット

音声合成には VOICEVOX を使用しています。

- **VOICEVOX:ずんだもん**

VOICEVOX 本体および音声ライブラリはこのリポジトリには含まれていません（Docker Hub の公式イメージを利用します）。
生成した音声を利用する場合は、[VOICEVOX 利用規約](https://voicevox.hiroshiba.jp/term/) と各キャラクターの利用規約（ずんだもん：[音源利用規約](https://zunko.jp/con_ongen_kiyaku.html)）に従ってください。
話者（`VOICEVOX_SPEAKER`）を変更した場合は、そのキャラクターのクレジット表記と規約に従ってください。
