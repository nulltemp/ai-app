import { useEffect, useRef, useState } from "react";
import { fetch } from "@tauri-apps/plugin-http";
import MediaPreview, { MediaPreviewHandle } from "./components/MediaPreview";
import Avatar from "./components/Avatar";
import { connectLipSync } from "./lipSync";
import { listenForUtterance } from "./vad";
import "./App.css";

const API_BASE = "http://127.0.0.1:8000";
// Tells the model the camera is its own eyes, not the user's view.
const CAMERA_PROMPT =
  "あなたはカメラを自分の目として、目の前にいるユーザーを見ながら会話しています。" +
  "見えている光景はあなた自身が見ているもので、ユーザーが見ているものではありません。" +
  "写っている人物は会話相手のユーザー本人です。" +
  "見えているものについて話すときは「〜が見えます」「〜を持っていますね」のように、あなた自身の視点で話してください。";
/** One sentence (with any closing brackets) at the start of the text being streamed. */
const SENTENCE_RE = /^[\s\S]*?[。！？!?\n]+[」』）)]*/;
/** Pause between background descriptions of the camera view. */
const SCENE_INTERVAL_MS = 5000;

type ChatMessage = { role: "user" | "assistant"; content: string; images?: string[] };

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [echoInput, setEchoInput] = useState("");
  const [echoResponse, setEchoResponse] = useState("");
  const [showMedia, setShowMedia] = useState(false);
  const [watchCamera, setWatchCamera] = useState(true);
  const mediaRef = useRef<MediaPreviewHandle>(null);
  // Latest background description of the camera view (see the effect below)
  const sceneRef = useRef<{ text: string; at: number } | null>(null);
  const [scene, setScene] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [readAloud, setReadAloud] = useState(true);
  const [showAvatar, setShowAvatar] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Bumped on every stop so a pending TTS request doesn't start playing afterwards
  const speechIdRef = useRef(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  // Read-aloud queue: TTS for the next sentence is fetched while the current one plays
  const ttsChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const playChainRef = useRef<Promise<void>>(Promise.resolve());
  const queuedSpeechRef = useRef(0);
  const [conversationMode, setConversationMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  // Bumped to restart listening (after each utterance, or when the panel's mic changes)
  const [listenRound, setListenRound] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(isLoading);
  loadingRef.current = isLoading;
  const readAloudRef = useRef(readAloud);
  readAloudRef.current = readAloud;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return;

    const watching = showMedia && watchCamera;
    const seen = watching ? sceneRef.current : null;
    // Prefer the background description so the reply doesn't wait for image encoding;
    // fall back to attaching a frame until the first description arrives.
    const frame = watching && !seen ? mediaRef.current?.captureFrame() : null;
    const history: ChatMessage[] = [
      ...messages,
      { role: "user", content: text, ...(frame && { images: [frame] }) },
    ];
    setMessages(history);
    if (text === input) setInput("");
    setError("");
    setIsLoading(true);
    stopSpeaking();

    try {
      const res = await fetch(`${API_BASE}/ollama/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // Only the latest message carries its image; re-sending every past
        // frame would make each turn slower as the conversation grows.
        body: JSON.stringify({
          messages: [
            ...(seen || frame
              ? [
                  {
                    role: "system",
                    content:
                      CAMERA_PROMPT +
                      (seen
                        ? `\nあなたの目に見えている光景（${Math.round((Date.now() - seen.at) / 1000)}秒前）: ${seen.text}`
                        : "\nユーザーのメッセージに添付された画像が、今あなたの目に見えている光景です。"),
                  },
                ]
              : []),
            ...history.map((m, i) =>
              i === history.length - 1 ? m : { role: m.role, content: m.content }
            ),
          ],
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(
          typeof data.detail === "string" ? data.detail : `HTTP ${res.status}`
        );
      }
      if (!res.body) throw new Error("Empty response");

      // Show the reply as it streams in, and queue each finished sentence for reading aloud
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let content = "";
      let unspoken = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        content += value;
        unspoken += value;
        setMessages([...history, { role: "assistant", content }]);
        let m: RegExpMatchArray | null;
        while ((m = unspoken.match(SENTENCE_RE))) {
          queueSpeech(m[0]);
          unspoken = unspoken.slice(m[0].length);
        }
      }
      queueSpeech(unspoken);
    } catch (error) {
      setError(String(error));
    } finally {
      setIsLoading(false);
    }
  }

  function stopSpeaking() {
    speechIdRef.current++;
    ttsChainRef.current = Promise.resolve();
    playChainRef.current = Promise.resolve();
    queuedSpeechRef.current = 0;
    audioRef.current?.pause();
    audioRef.current = null;
    setIsSpeaking(false);
  }

  /** Add a sentence to the read-aloud queue (no-op if read-aloud is off or nothing speakable). */
  function queueSpeech(text: string) {
    // Skip symbol-only pieces (e.g. a closing bracket split off the previous sentence);
    // the server strips Markdown symbols too, so they would just fail there
    if (!readAloudRef.current || !text.replace(/[*#`_~>|\s」』）)]/g, "")) return;
    const id = speechIdRef.current;
    const current = () => id === speechIdRef.current;
    queuedSpeechRef.current++;
    setIsSpeaking(true);

    // Fetch in order, one at a time, without waiting for playback
    const audio = ttsChainRef.current.then(() => (current() ? fetchSpeech(text) : null));
    ttsChainRef.current = audio.catch(() => {});
    playChainRef.current = playChainRef.current
      .then(async () => {
        const blob = await audio;
        if (blob && current()) await playAudio(blob);
      })
      .catch((error) => {
        if (current()) setError("読み上げに失敗しました: " + String(error));
      })
      .finally(() => {
        if (current() && --queuedSpeechRef.current === 0) setIsSpeaking(false);
      });
  }

  async function fetchSpeech(text: string): Promise<Blob> {
    const res = await fetch(`${API_BASE}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(typeof data.detail === "string" ? data.detail : `HTTP ${res.status}`);
    }
    return res.blob();
  }

  /** Play audio with lip sync; resolves when it ends or is stopped. */
  function playAudio(blob: Blob): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      const done = () => {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
        resolve();
      };
      audio.onended = audio.onpause = audio.onerror = done;
      connectLipSync(audio);
      audioRef.current = audio;
      audio.play().catch(done);
    });
  }

  async function toggleRecording() {
    if (recorderRef.current) {
      recorderRef.current.stop();
      return;
    }

    // Use the mic selected in the camera panel if it is open; otherwise the default mic.
    let stream = showMedia ? mediaRef.current?.getAudioStream() ?? null : null;
    const ownsStream = !stream;
    try {
      stream ??= await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      setError("マイクを取得できません: " + String(error));
      return;
    }

    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      recorderRef.current = null;
      setIsRecording(false);
      if (ownsStream) stream.getTracks().forEach((t) => t.stop());
      transcribe(new Blob(chunks, { type: recorder.mimeType })).then((text) => {
        if (text) setInput((prev) => (prev ? prev + " " : "") + text);
      });
    };
    // Don't let the avatar's own voice leak into the recording
    stopSpeaking();
    recorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    setError("");
  }

  /** Transcribe audio via /stt; returns the text, or null on failure / silence. */
  async function transcribe(audio: Blob): Promise<string | null> {
    if (audio.size === 0) return null;
    setIsTranscribing(true);
    try {
      const res = await fetch(`${API_BASE}/stt`, {
        method: "POST",
        headers: { "Content-Type": audio.type || "application/octet-stream" },
        body: audio,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.detail === "string" ? data.detail : `HTTP ${res.status}`
        );
      }
      return data.text || null;
    } catch (error) {
      setError("音声認識に失敗しました: " + String(error));
      return null;
    } finally {
      setIsTranscribing(false);
    }
  }

  // Describe the camera view in the background so replies can use the text.
  // Skipped while a reply is being generated so the GPU stays free for it.
  useEffect(() => {
    sceneRef.current = null;
    setScene("");
    if (!showMedia || !watchCamera) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      const frame = loadingRef.current ? null : mediaRef.current?.captureFrame();
      if (frame) {
        try {
          const res = await fetch(`${API_BASE}/describe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: frame }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail ?? `HTTP ${res.status}`);
          if (!cancelled) {
            sceneRef.current = { text: data.text, at: Date.now() };
            setScene(data.text);
          }
        } catch (error) {
          console.warn("Failed to describe the camera view:", error);
        }
      }
      // Retry soon if there was no frame yet (camera starting) or a reply was in progress
      if (!cancelled) timer = setTimeout(tick, frame ? SCENE_INTERVAL_MS : 1000);
    };
    tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showMedia, watchCamera]);

  // Conversation mode: listen → transcribe → send → (read aloud) → listen again.
  // Listening pauses while the AI is thinking, but continues while it speaks so the
  // user can interrupt (barge-in): speaking up stops the read-aloud and records instead.
  const isSpeakingRef = useRef(isSpeaking);
  isSpeakingRef.current = isSpeaking;
  const sendRef = useRef(sendMessage);
  sendRef.current = sendMessage;
  const transcribeRef = useRef(transcribe);
  transcribeRef.current = transcribe;
  const canListen =
    conversationMode && !isLoading && !isTranscribing && !isRecording;

  useEffect(() => {
    if (!canListen) return;

    let cancelled = false;
    let stopListening: (() => void) | null = null;
    let ownStream: MediaStream | null = null;

    (async () => {
      let stream = showMedia ? mediaRef.current?.getAudioStream() ?? null : null;
      if (!stream) {
        try {
          stream = ownStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
        } catch (error) {
          setError("マイクを取得できません: " + String(error));
          setConversationMode(false);
          return;
        }
      }
      if (cancelled) {
        ownStream?.getTracks().forEach((t) => t.stop());
        return;
      }

      setIsListening(true);
      stopListening = listenForUtterance(
        stream,
        async (audio) => {
          ownStream?.getTracks().forEach((t) => t.stop());
          setIsListening(false);
          const text = await transcribeRef.current(audio);
          if (text) sendRef.current(text);
          setListenRound((n) => n + 1);
        },
        {
          isBargeIn: () => isSpeakingRef.current,
          onSpeechStart: () => {
            if (isSpeakingRef.current) stopSpeaking();
          },
        }
      );
    })();

    return () => {
      cancelled = true;
      stopListening?.();
      ownStream?.getTracks().forEach((t) => t.stop());
      setIsListening(false);
    };
  }, [canListen, showMedia, listenRound]);

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
          <button
            type="button"
            className={`button ghost${showAvatar ? " active" : ""}`}
            onClick={() => setShowAvatar((v) => !v)}
          >
            アバター
          </button>
          <button
            type="button"
            className={`button ghost${conversationMode ? " active" : ""}`}
            onClick={() => setConversationMode((v) => !v)}
            title="話しかけるだけで会話する（話し終わると自動で送信）"
          >
            会話モード
          </button>
          <button
            type="button"
            className={`button ghost${readAloud ? " active" : ""}`}
            onClick={() => {
              if (readAloud) stopSpeaking();
              setReadAloud((v) => !v);
            }}
            title="AIの返答を音声で読み上げる"
          >
            読み上げ
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
              stopSpeaking();
              setMessages([]);
              setError("");
            }}
            disabled={isLoading || messages.length === 0}
          >
            クリア
          </button>
        </div>
      </header>

      {showMedia && (
        <MediaPreview
          ref={mediaRef}
          onStreamChange={() => setListenRound((n) => n + 1)}
          scene={watchCamera ? scene : undefined}
        />
      )}

      <div className="body">
        {showAvatar && <Avatar />}
        <div className="chat">
          <main className="messages">
            {messages.length === 0 && !isLoading && (
              <div className="empty">
                <p className="empty-title">何でも聞いてください</p>
                <p className="empty-sub">Enter で送信 / Shift + Enter で改行</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`message ${m.role}`}>
                <div className="bubble">
                  {m.images?.map((img, j) => (
                    <img
                      key={j}
                      className="bubble-image"
                      src={`data:image/jpeg;base64,${img}`}
                      alt="添付したカメラ画像"
                    />
                  ))}
                  {m.content}
                </div>
              </div>
            ))}
            {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
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
              sendMessage(input);
            }}
          >
            {showMedia && (
              <label className="attach-toggle" title="カメラ映像を AI に見せる（裏で定期的に要約）">
                <input
                  type="checkbox"
                  checked={watchCamera}
                  onChange={(e) => setWatchCamera(e.currentTarget.checked)}
                />
                映像を見る
              </label>
            )}
            <textarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder="メッセージを入力..."
              rows={1}
              autoFocus
            />
            {conversationMode ? (
              <span
                className={`voice-status${isListening && !isSpeaking ? " listening" : ""}`}
                title={isSpeaking && isListening ? "話しかけると読み上げを止めて聞き取ります" : undefined}
              >
                {isSpeaking
                  ? isListening
                    ? "話し中（割り込み可）"
                    : "話し中"
                  : isListening
                    ? "聞き取り中"
                    : isTranscribing
                      ? "認識中…"
                      : isLoading
                        ? "考え中…"
                        : "準備中…"}
              </span>
            ) : (
              <button
                type="button"
                className={`button mic${isRecording ? " recording" : ""}`}
                onClick={toggleRecording}
                disabled={isTranscribing}
                title={isRecording ? "録音を停止して文字起こし" : "音声で入力"}
              >
                {isTranscribing ? "変換中…" : isRecording ? "停止" : "録音"}
              </button>
            )}
            <button
              type="submit"
              className="button primary"
              disabled={isLoading || !input.trim()}
            >
              送信
            </button>
          </form>
          {/* Credit required by the VOICEVOX / character terms of use */}
          <footer className="credit">音声合成: VOICEVOX:ずんだもん</footer>
        </div>
      </div>
    </div>
  );
}

export default App;
