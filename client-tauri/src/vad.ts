// Simple volume-based voice activity detection: records from a mic stream and
// hands back one utterance (speech followed by a pause) as an audio Blob.

const CHECK_INTERVAL_MS = 50;
/** Voice must last this long to count as speech (ignores clicks and bumps). */
const SPEECH_START_MS = 150;
/** Silence this long after speech ends the utterance. */
const SILENCE_END_MS = 900;
/** Without speech, restart the recorder so it doesn't grow forever. */
const IDLE_RESTART_MS = 15000;
const MIN_THRESHOLD = 0.01;
const NOISE_MULTIPLIER = 2.5;

/**
 * Start listening on `stream`. `onUtterance` is called once, after the first
 * utterance is complete; listening then stops. Returns a function that stops
 * listening early (no callback).
 */
export function listenForUtterance(
  stream: MediaStream,
  onUtterance: (audio: Blob) => void
): () => void {
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  let recorder: MediaRecorder;
  let chunks: Blob[] = [];
  let recordStartedAt = 0;
  let voicedMs = 0;
  let speaking = false;
  let lastVoiceAt = 0;
  let noise = MIN_THRESHOLD / NOISE_MULTIPLIER;
  let stopped = false;

  const startRecorder = () => {
    // Each recorder gets its own array so a discarded one can't leak data into the next
    const own: Blob[] = [];
    chunks = own;
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => own.push(e.data);
    recorder.start();
    recordStartedAt = performance.now();
  };

  const cleanup = () => {
    stopped = true;
    clearInterval(timer);
    ctx.close();
  };

  startRecorder();

  const timer = setInterval(() => {
    const now = performance.now();
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const v of samples) sum += v * v;
    const rms = Math.sqrt(sum / samples.length);

    const threshold = Math.max(MIN_THRESHOLD, noise * NOISE_MULTIPLIER);
    if (rms > threshold) {
      voicedMs += CHECK_INTERVAL_MS;
      if (voicedMs >= SPEECH_START_MS) speaking = true;
      lastVoiceAt = now;
    } else {
      voicedMs = 0;
      // Track the background noise level while nobody is talking
      if (!speaking) noise = noise * 0.95 + rms * 0.05;
    }

    if (speaking && now - lastVoiceAt > SILENCE_END_MS) {
      const done = recorder;
      const data = chunks;
      cleanup();
      done.onstop = () => onUtterance(new Blob(data, { type: done.mimeType }));
      done.stop();
    } else if (!speaking && voicedMs === 0 && now - recordStartedAt > IDLE_RESTART_MS) {
      recorder.ondataavailable = null;
      recorder.stop();
      startRecorder();
    }
  }, CHECK_INTERVAL_MS);

  return () => {
    if (stopped) return;
    cleanup();
    recorder.ondataavailable = null;
    recorder.stop();
  };
}
