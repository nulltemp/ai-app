import { useState } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import "./App.css";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");
  const [inputText, setInputText] = useState("");
  const [response, setResponse] = useState("");
  const [ollamaInput, setOllamaInput] = useState("");
  const [ollamaResponse, setOllamaResponse] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setGreetMsg(await invoke("greet", { name }));
  }

  async function echoText() {
    try {
      const res = await fetch("http://127.0.0.1:8000/echo", {
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

    setIsLoading(true);
    setOllamaResponse("");

    try {
      // Create proper JSON payload for our server's /ollama endpoint
      const ollamaPayload = {
        messages: [{ role: "user", content: ollamaInput }],
      };

      const res = await fetch("http://127.0.0.1:8000/ollama", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(ollamaPayload),
      });
      const data = await res.json();
      // Server returns the message object: { role: 'assistant', content: '...' }
      setOllamaResponse(data.content || JSON.stringify(data));
    } catch (error) {
      setOllamaResponse("Error: " + String(error));
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
          <h3>Ollama Response:</h3>
          <pre className="response-text">
            {ollamaResponse || "Response will appear here..."}
          </pre>
        </div>
      </div>
    </main>
  );
}

export default App;
