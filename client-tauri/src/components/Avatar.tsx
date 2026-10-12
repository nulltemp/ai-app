import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { getMouthOpen } from "../lipSync";

// Place your own model here (gitignored, since model licenses usually forbid redistribution)
const DEFAULT_MODEL_URL = "/models/avatar.vrm";

const BLINK_DURATION = 0.15;

function Avatar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [modelUrl, setModelUrl] = useState(DEFAULT_MODEL_URL);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    const light = new THREE.DirectionalLight(0xffffff, Math.PI);
    light.position.set(1, 1, 1).normalize();
    scene.add(light, new THREE.AmbientLight(0xffffff, 0.6));

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let vrm: VRM | null = null;
    let disposed = false;
    setStatus("loading");

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      modelUrl,
      (gltf) => {
        const loaded: VRM | undefined = gltf.userData.vrm;
        if (disposed || !loaded) {
          if (loaded) VRMUtils.deepDispose(loaded.scene);
          if (!disposed) setStatus("missing");
          return;
        }
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);
        VRMUtils.rotateVRM0(loaded);

        // Relax the T-pose: lower both arms
        loaded.humanoid.getNormalizedBoneNode("leftUpperArm")?.rotation.set(0, 0, -1.2);
        loaded.humanoid.getNormalizedBoneNode("rightUpperArm")?.rotation.set(0, 0, 1.2);

        // Frame the head and shoulders
        loaded.scene.updateMatrixWorld(true);
        const head = new THREE.Vector3();
        loaded.humanoid.getNormalizedBoneNode("head")?.getWorldPosition(head);
        camera.position.set(0, head.y, head.y * 0.55);
        camera.lookAt(0, head.y - 0.08, 0);

        if (loaded.lookAt) loaded.lookAt.target = camera;
        scene.add(loaded.scene);
        vrm = loaded;
        setStatus("ready");
      },
      undefined,
      () => {
        if (!disposed) setStatus("missing");
      }
    );

    const clock = new THREE.Clock();
    let nextBlink = 2;
    let mouth = 0;

    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta();
      const t = clock.elapsedTime;

      if (vrm) {
        // Lip sync: ease toward the current speech loudness
        mouth += (getMouthOpen() - mouth) * Math.min(1, delta * 20);
        vrm.expressionManager?.setValue("aa", mouth);

        // Blink every few seconds
        if (t > nextBlink + BLINK_DURATION) nextBlink = t + 2 + Math.random() * 4;
        const blink = t > nextBlink ? Math.sin(((t - nextBlink) / BLINK_DURATION) * Math.PI) : 0;
        vrm.expressionManager?.setValue("blink", blink);

        // Idle breathing
        const spine = vrm.humanoid.getNormalizedBoneNode("spine");
        if (spine) spine.rotation.x = Math.sin(t * 1.5) * 0.02;

        vrm.update(delta);
      }
      renderer.render(scene, camera);
    });

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      if (vrm) VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [modelUrl]);

  // Revoke object URLs from the file picker once they are replaced
  useEffect(() => {
    if (!modelUrl.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(modelUrl);
  }, [modelUrl]);

  return (
    <aside className="avatar">
      <div ref={containerRef} className="avatar-canvas" />
      {status !== "ready" && (
        <div className="avatar-status">
          {status === "loading" ? (
            "読み込み中…"
          ) : (
            <>
              VRMモデルがありません。
              <br />
              <code>client-tauri/public/models/avatar.vrm</code>
              を置くか、下のボタンから選択してください。
            </>
          )}
        </div>
      )}
      <label className="button ghost avatar-pick">
        VRMを選択
        <input
          type="file"
          accept=".vrm"
          hidden
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) setModelUrl(URL.createObjectURL(file));
            e.currentTarget.value = "";
          }}
        />
      </label>
    </aside>
  );
}

export default Avatar;
