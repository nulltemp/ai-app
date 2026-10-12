# API Server

FastAPIを使用したバックエンドサーバーです。
Ollamaとの連携、音声認識（Whisper）、音声合成（VOICEVOX）、文字列のエコーバック機能を提供します。

## セットアップと起動方法

### Dockerを使用する場合（推奨）

ルートディレクトリにある `docker-compose.yml` を使用して起動します。

```bash
docker-compose up --build
```

これにより、以下のサービスが起動します：

- **server**: http://localhost:8000（`./server` をマウントし `--reload` で起動するため、編集は自動反映されます）
- **ollama**: http://localhost:11434（このPCからのみアクセス可。NVIDIA GPU を使用）
- **voicevox**: http://localhost:50021（このPCからのみアクセス可）

初回はモデルを取得してください（`ollama_data` ボリュームに保存されるため一度だけで済みます）：

```bash
docker compose exec ollama ollama pull gemma3:4b
```

Whisper のモデルは初回の `/stt` 呼び出し時に自動でダウンロードされます（`hf_cache` ボリュームに保存）。

### ローカルで直接起動する場合

1. **仮想環境の作成と有効化 (推奨)**

   ```bash
   cd server
   python -m venv venv

   # Windowsの場合
   .\venv\Scripts\activate

   # macOS/Linuxの場合
   source venv/bin/activate
   ```

2. **依存関係のインストール**

   ```bash
   pip install -r requirements.txt
   ```

3. **サーバーの起動**
   ```bash
   uvicorn main:app --reload --port 8000
   ```

   Ollama と VOICEVOX ENGINE は別途起動しておく必要があります（既定では `http://localhost:11434` / `http://localhost:50021` に接続します）。

### 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama の接続先（Docker Compose では `http://ollama:11434`） |
| `OLLAMA_MODEL` | `gemma3:4b` | 使用するモデル（画像を扱うにはビジョン対応モデルが必要） |
| `WHISPER_MODEL` | `small` | 音声認識に使う Whisper モデル（CPU で実行） |
| `VOICEVOX_HOST` | `http://localhost:50021` | VOICEVOX ENGINE の接続先（Docker Compose では `http://voicevox:50021`） |
| `VOICEVOX_SPEAKER` | `3` | 話者のスタイル ID（3 = ずんだもん ノーマル。一覧は `GET /speakers`） |

### 依存関係の更新

新しいライブラリをインストールした場合は、`requirements.txt` を更新します。

```bash
pip freeze > requirements.txt
```

## API エンドポイント

- `GET /`: サーバーの動作確認用
- `POST /echo`: 送信したデータをそのままテキストで返します
- `POST /ollama`: Ollamaサービスへのプロキシ
  - リクエスト: `{"messages": [{"role": "user" | "assistant" | "system", "content": "...", "images": ["<base64>"]}]}`（`images` は省略可）
  - レスポンス: `{"role": "assistant", "content": "..."}`
  - リクエスト形式が不正な場合は `422`、Ollama に接続できない・モデルが無い場合は `502`
- `POST /stt`: 音声認識（日本語）
  - リクエスト: 音声データそのもの（`audio/webm`、`audio/wav` など）
  - レスポンス: `{"text": "..."}`
- `POST /tts`: 音声合成（VOICEVOX）
  - リクエスト: `{"text": "..."}`
  - レスポンス: `audio/wav`

## 技術スタック

- Python 3.14+
- FastAPI
- Uvicorn
- ollama (Ollamaとの通信用)
- faster-whisper (音声認識)
- httpx (VOICEVOX ENGINE との通信用)

## クレジット

音声合成には VOICEVOX を使用しています（**VOICEVOX:ずんだもん**）。
利用条件はリポジトリ直下の [README](../README.md#クレジット) を参照してください。
