# API Server

FastAPIを使用したバックエンドサーバーです。
Ollamaとの連携や、文字列のエコーバック機能を提供します。

## セットアップと起動方法

### Dockerを使用する場合（推奨）

ルートディレクトリにある `docker-compose.yml` を使用して起動します。

```bash
docker-compose up --build
```

これにより、以下のサービスが起動します：

- **server**: http://localhost:8000（`./server` をマウントし `--reload` で起動するため、編集は自動反映されます）
- **ollama**: http://localhost:11434（このPCからのみアクセス可）

初回はモデルを取得してください（`ollama_data` ボリュームに保存されるため一度だけで済みます）：

```bash
docker compose exec ollama ollama pull gemma3:270m
```

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

   Ollama は別途起動しておく必要があります（既定では `http://localhost:11434` に接続します）。

### 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama の接続先（Docker Compose では `http://ollama:11434`） |
| `OLLAMA_MODEL` | `gemma3:270m` | 使用するモデル |

### 依存関係の更新

新しいライブラリをインストールした場合は、`requirements.txt` を更新します。

```bash
pip freeze > requirements.txt
```

## API エンドポイント

- `GET /`: サーバーの動作確認用
- `POST /echo`: 送信したデータをそのままテキストで返します
- `POST /ollama`: Ollamaサービスへのプロキシ
  - リクエスト: `{"messages": [{"role": "user" | "assistant" | "system", "content": "..."}]}`
  - レスポンス: `{"role": "assistant", "content": "..."}`
  - リクエスト形式が不正な場合は `422`、Ollama に接続できない・モデルが無い場合は `502`

## 技術スタック

- Python 3.14+
- FastAPI
- Uvicorn
- ollama (Ollamaとの通信用)
