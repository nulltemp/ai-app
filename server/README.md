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

- **server**: http://localhost:8000
- **ollama**: http://localhost:11434

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

### 依存関係の更新

新しいライブラリをインストールした場合は、`requirements.txt` を更新します。

```bash
pip freeze > requirements.txt
```

## API エンドポイント

- `GET /`: サーバーの動作確認用
- `POST /echo`: 送信したデータをそのまま返します
- `POST /ollama`: Ollamaサービスへのプロキシ（Docker環境で動作している必要があります）

## 技術スタック

- Python 3.14+
- FastAPI
- Uvicorn
- httpx (Ollamaとの通信用)
