import { useEffect, useRef, useState } from "react";
import { fetch } from "@tauri-apps/plugin-http";
import MediaPreview from "./components/MediaPreview";
import "./App.css";

const API_BASE = "http://127.0.0.1:8000";

type ChatMessage = { role: "user" | "assistant"; content: string };

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [echoInput, setEchoInput] = useState("");
  const [echoResponse, setEchoResponse] = useState("");
  const [showMedia, setShowMedia] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function sendToOllama() {
    if (!input.trim() || isLoading) return;

    const history: ChatMessage[] = [
      ...messages,
      { role: "user", content: input },
    ];
    setMessages(history);
    setInput("");
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/ollama`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: history }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : `HTTP ${res.status}`
        );
      }
      // Server returns the message object: { role: 'assistant', content: '...' }
      setMessages([...history, { role: "assistant", content: data.content }]);
    } catch (error) {
      setError(String(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function echoText() {
    try {
      const res = await fetch(`${API_BASE}/echo`, {
        method: "POST",
        body: echoInput,
      });
      setEchoResponse(await res.text());
    } catch (error) {
      setEchoResponse("Error: " + String(error));
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">AI Chat</h1>
        <div className="header-actions">
          <button
            type="button"
            className={`button ghost${showMedia ? " active" : ""}`}
            onClick={() => setShowMedia((v) => !v)}
          >
            カメラ
          </button>
          <details className="echo">
            <summary className="button ghost">接続テスト</summary>
            <form
              className="echo-panel"
              onSubmit={(e) => {
                e.preventDefault();
                echoText();
              }}
            >
              <div className="echo-row">
                <input
                  value={echoInput}
                  onChange={(e) => setEchoInput(e.currentTarget.value)}
                  placeholder="送信するテキスト"
                />
                <button type="submit" className="button">
                  Echo
                </button>
              </div>
              {echoResponse && <pre className="echo-result">{echoResponse}</pre>}
            </form>
          </details>
          <button
            type="button"
            className="button ghost"
            onClick={() => {
              setMessages([]);
              setError("");
            }}
            disabled={isLoading || messages.length === 0}
          >
            クリア
          </button>
        </div>
      </header>

      {showMedia && <MediaPreview />}

      <main className="messages">
        {messages.length === 0 && !isLoading && (
          <div className="empty">
            <p className="empty-title">何でも聞いてください</p>
            <p className="empty-sub">Enter で送信 / Shift + Enter で改行</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            <div className="bubble">{m.content}</div>
          </div>
        ))}
        {isLoading && (
          <div className="message assistant">
            <div className="bubble typing" aria-label="応答を待っています">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        {error && <div className="error">エラー: {error}</div>}
        <div ref={bottomRef} />
      </main>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          sendToOllama();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              sendToOllama();
            }
          }}
          placeholder="メッセージを入力..."
          rows={1}
          autoFocus
        />
        <button
          type="submit"
          className="button primary"
          disabled={isLoading || !input.trim()}
        >
          送信
        </button>
      </form>
    </div>
  );
}

export default App;
