import { useState } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import "./App.css";

const API_BASE = "http://127.0.0.1:8000";

type ChatMessage = { role: "user" | "assistant"; content: string };

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");
  const [inputText, setInputText] = useState("");
  const [response, setResponse] = useState("");
  const [ollamaInput, setOllamaInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setGreetMsg(await invoke("greet", { name }));
  }

  async function echoText() {
    try {
      const res = await fetch(`${API_BASE}/echo`, {
        method: "POST",
        body: inputText,
      });
      const data = await res.text();
      setResponse(data);
    } catch (error) {
      setResponse("Error: " + String(error));
    }
  }

  async function sendToOllama() {
    if (!ollamaInput.trim()) return;

    const history: ChatMessage[] = [
      ...messages,
      { role: "user", content: ollamaInput },
    ];
    setMessages(history);
    setOllamaInput("");
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
      setError("Error: " + String(error));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="container">
      <h1>Welcome to Tauri + React</h1>

      <div className="row">
        <a href="https://vite.dev" target="_blank">
          <img src="/vite.svg" className="logo vite" alt="Vite logo" />
        </a>
        <a href="https://tauri.app" target="_blank">
          <img src="/tauri.svg" className="logo tauri" alt="Tauri logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <p>Click on the Tauri, Vite, and React logos to learn more.</p>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <input
          id="greet-input"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <button type="submit">Greet</button>
      </form>
      <p>{greetMsg}</p>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          echoText();
        }}
      >
        <input
          onChange={(e) => setInputText(e.currentTarget.value)}
          placeholder="Enter text to echo..."
        />
        <button type="submit">Send</button>
      </form>
      <p>Response: {response}</p>

      <div className="ollama-section">
        <h2>Ollama API</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            sendToOllama();
          }}
        >
          <textarea
            value={ollamaInput}
            onChange={(e) => setOllamaInput(e.currentTarget.value)}
            placeholder="Enter prompt for Ollama..."
            rows={4}
            style={{ width: "100%" }}
          />
          <button type="submit" disabled={isLoading}>
            {isLoading ? "Processing..." : "Send to Ollama"}
          </button>
        </form>
        <div className="response-container">
          <h3>Conversation:</h3>
          {messages.length === 0 && <p>Response will appear here...</p>}
          {messages.map((m, i) => (
            <pre key={i} className="response-text">
              <strong>{m.role}:</strong> {m.content}
            </pre>
          ))}
          {error && <p className="error">{error}</p>}
          <button type="button" onClick={() => setMessages([])} disabled={isLoading}>
            Clear
          </button>
        </div>
      </div>
    </main>
  );
}

export default App;
