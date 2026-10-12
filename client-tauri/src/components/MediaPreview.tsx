import { Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

type DeviceOption = { deviceId: string; label: string };

export type MediaPreviewHandle = {
  /** Current camera frame as base64 JPEG (no data: URL prefix), or null if no video. */
  captureFrame: () => string | null;
};

// Gemma 3's vision encoder works at 896x896, so larger frames only cost bandwidth.
const MAX_FRAME_SIZE = 896;

function toOptions(devices: MediaDeviceInfo[], kind: MediaDeviceKind, fallback: string) {
  return devices
    .filter((d) => d.kind === kind)
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
}

function MediaPreview({ ref }: { ref?: Ref<MediaPreviewHandle> }) {
  const [cameras, setCameras] = useState<DeviceOption[]>([]);
  const [mics, setMics] = useState<DeviceOption[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [micId, setMicId] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    captureFrame() {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return null;
      const scale = Math.min(1, MAX_FRAME_SIZE / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
    },
  }));

  const refreshDevices = useCallback(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    setCameras(toOptions(devices, "videoinput", "カメラ"));
    setMics(toOptions(devices, "audioinput", "マイク"));
  }, []);

  // Device list (labels are only filled in after permission is granted).
  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  // (Re)acquire the stream whenever the selected devices change.
  useEffect(() => {
    let cancelled = false;
    let acquired: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({
        video: cameraId ? { deviceId: { exact: cameraId } } : true,
        audio: micId ? { deviceId: { exact: micId } } : true,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        acquired = s;
        setStream(s);
        setError("");
        refreshDevices();
      })
      .catch((e) => {
        if (!cancelled) {
          setStream(null);
          setError(String(e));
        }
      });

    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraId, micId, refreshDevices]);

  // Attach the stream to the preview video.
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  // Microphone level meter (updated via the DOM directly to avoid re-rendering every frame).
  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) return;

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let raf = 0;

    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      const rms = Math.sqrt(sum / buf.length);
      if (meterRef.current) {
        meterRef.current.style.width = `${Math.min(100, rms * 300)}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ctx.close();
    };
  }, [stream]);

  const activeCameraId = stream?.getVideoTracks()[0]?.getSettings().deviceId ?? cameraId;
  const activeMicId = stream?.getAudioTracks()[0]?.getSettings().deviceId ?? micId;

  return (
    <section className="media">
      <video ref={videoRef} className="media-video" autoPlay playsInline muted />
      <div className="media-controls">
        <label className="media-field">
          <span>カメラ</span>
          <select value={activeCameraId} onChange={(e) => setCameraId(e.currentTarget.value)}>
            {cameras.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="media-field">
          <span>マイク</span>
          <select value={activeMicId} onChange={(e) => setMicId(e.currentTarget.value)}>
            {mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <div className="media-field">
          <span>入力レベル</span>
          <div className="meter">
            <div ref={meterRef} className="meter-fill" />
          </div>
        </div>
        {error && <div className="error">デバイスを取得できません: {error}</div>}
      </div>
    </section>
  );
}

export default MediaPreview;
