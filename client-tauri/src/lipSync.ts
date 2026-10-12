// Shares the loudness of the currently playing speech with the avatar,
// which reads it every frame to open its mouth.

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
const samples = new Float32Array(1024);

/** Route an <audio> element through an analyser so getMouthOpen() can follow it. */
export function connectLipSync(audio: HTMLAudioElement) {
  ctx ??= new AudioContext();
  const node = ctx.createAnalyser();
  node.fftSize = samples.length;
  ctx.createMediaElementSource(audio).connect(node);
  node.connect(ctx.destination);
  analyser = node;

  const release = () => {
    if (analyser === node) analyser = null;
  };
  audio.addEventListener("pause", release);
  audio.addEventListener("ended", release);
}

/** Mouth openness for the current speech, 0 (closed) to 1 (fully open). */
export function getMouthOpen(): number {
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const v of samples) sum += v * v;
  const rms = Math.sqrt(sum / samples.length);
  // Ignore the noise floor, then scale typical speech levels into 0..1
  return Math.min(1, Math.max(0, (rms - 0.01) * 6));
}
