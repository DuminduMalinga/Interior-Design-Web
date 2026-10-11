import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { LivingRoomLayoutResult } from "../lib/livingRoomLayout";
import { buildRoomModel, disposeModel, updateFixtureVisibility, type RoomModel } from "../lib/roomScene3d";

export type SceneQuality = "High" | "Medium" | "Low";

/** What the page's toolbar buttons can ask the 3D view to do. */
export interface RoomScene3DHandle {
  /** Move the camera closer (factor < 1) or further away (factor > 1). */
  zoom: (factor: number) => void;
  /** Turn the camera round the room, in degrees. */
  rotate: (degrees: number) => void;
  reset: () => void;
  /** The current view as a PNG data URL. */
  toPNG: () => string | null;
  /** The room and its furniture as a binary glTF model, in metres. */
  exportGLB: () => Promise<Blob>;
}

interface Props {
  layout: LivingRoomLayoutResult;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  quality: SceneQuality;
  onFps?: (fps: number) => void;
  /** Called when WebGL cannot be started. */
  onError?: (message: string) => void;
}

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  sun: THREE.DirectionalLight;
  model: RoomModel;
  home: { position: THREE.Vector3; target: THREE.Vector3 };
}

const HIGHLIGHT = new THREE.Color("#2dd4bf");
const UP = new THREE.Vector3(0, 1, 0);

/** An interactive three.js view of one layout: drag to orbit, scroll to zoom, click a piece to select it. */
const RoomScene3D = forwardRef<RoomScene3DHandle, Props>(function RoomScene3D(
  { layout, selectedId, onSelect, quality, onFps, onError },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const highlighted = useRef<Map<THREE.MeshStandardMaterial, { color: THREE.Color; intensity: number }>>(new Map());
  const callbacks = useRef({ onSelect, onFps, onError });
  callbacks.current = { onSelect, onFps, onError };
  const selectedRef = useRef(selectedId);
  const qualityRef = useRef(quality);

  const applyQuality = (stage: Stage, level: SceneQuality) => {
    stage.renderer.setPixelRatio(level === "High" ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    stage.sun.castShadow = level !== "Low";
  };

  const applySelection = (stage: Stage, id: string | null) => {
    for (const [material, original] of highlighted.current) {
      material.emissive.copy(original.color);
      material.emissiveIntensity = original.intensity;
    }
    highlighted.current.clear();
    const group = id ? stage.model.furniture.get(id) : undefined;
    group?.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!material || !material.isMeshStandardMaterial || highlighted.current.has(material)) return;
      highlighted.current.set(material, { color: material.emissive.clone(), intensity: material.emissiveIntensity });
      material.emissive.copy(HIGHLIGHT);
      material.emissiveIntensity = 0.45;
    });
  };

  // ── build the scene for this layout ──────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (err) {
      callbacks.current.onError?.(err instanceof Error ? err.message : "WebGL is not available in this browser.");
      return;
    }
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b1120");
    const model = buildRoomModel(layout);
    scene.add(model.root);

    const { width, length, height } = model.size;
    scene.add(new THREE.HemisphereLight("#ffffff", "#8a8f98", 1.15));
    scene.add(new THREE.AmbientLight("#ffffff", 0.35));
    const sun = new THREE.DirectionalLight("#fff4e0", 2.1);
    sun.position.set(width * 0.35, height * 2.4, length * 0.55);
    sun.shadow.mapSize.set(2048, 2048);
    const reach = Math.max(width, length) * 0.75 + 0.5;
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 0.1, far: height * 6 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);

    // the camera starts above the south-east corner, far enough back to take in the whole room
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
    const radius = 0.5 * Math.hypot(width, length, height);
    const target = new THREE.Vector3(0, height * 0.22, 0);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;      // never below the floor
    controls.minDistance = radius * 0.5;

    const stage: Stage = { renderer, scene, camera, controls, sun, model,
      home: { position: new THREE.Vector3(), target } };
    stageRef.current = stage;

    const frame = () => {
      const w = Math.max(host.clientWidth, 1);
      const h = Math.max(host.clientHeight, 1);
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // distance at which a sphere round the room fits both ways across the view
      const half = THREE.MathUtils.degToRad(camera.fov / 2);
      const fit = radius / Math.sin(Math.min(half, Math.atan(Math.tan(half) * camera.aspect)));
      controls.maxDistance = fit * 2.2;
      return fit;
    };
    const fit = frame();
    stage.home.position.copy(target).add(new THREE.Vector3(0.62, 0.72, 0.9).normalize().multiplyScalar(fit * 1.02));
    camera.position.copy(stage.home.position);
    controls.target.copy(target);
    controls.update();

    applyQuality(stage, qualityRef.current);
    applySelection(stage, selectedRef.current);

    const resize = new ResizeObserver(() => frame());
    resize.observe(host);

    // a click (not a drag) picks the piece of furniture under the pointer
    const down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => { down.x = e.clientX; down.y = e.clientY; };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects([...model.furniture.values()], true)[0];
      let object: THREE.Object3D | null = hit?.object ?? null;
      while (object && !object.userData.itemId) object = object.parent;
      callbacks.current.onSelect(object ? (object.userData.itemId as string) : null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    let raf = 0;
    let frames = 0;
    let since = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      controls.update();
      updateFixtureVisibility(model, camera.position);
      renderer.render(scene, camera);
      frames += 1;
      if (now - since >= 1000) {
        callbacks.current.onFps?.(Math.round((frames * 1000) / (now - since)));
        frames = 0;
        since = now;
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      disposeModel(model.root);
      renderer.dispose();
      renderer.domElement.remove();
      highlighted.current.clear();
      stageRef.current = null;
    };
  }, [layout]);

  useEffect(() => {
    selectedRef.current = selectedId;
    if (stageRef.current) applySelection(stageRef.current, selectedId);
  }, [selectedId]);

  useEffect(() => {
    qualityRef.current = quality;
    if (stageRef.current) applyQuality(stageRef.current, quality);
  }, [quality]);

  useImperativeHandle(ref, () => ({
    zoom(factor) {
      const stage = stageRef.current;
      if (!stage) return;
      const { camera, controls } = stage;
      const offset = camera.position.clone().sub(controls.target);
      offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance));
      camera.position.copy(controls.target).add(offset);
    },
    rotate(degrees) {
      const stage = stageRef.current;
      if (!stage) return;
      const { camera, controls } = stage;
      const offset = camera.position.clone().sub(controls.target).applyAxisAngle(UP, THREE.MathUtils.degToRad(degrees));
      camera.position.copy(controls.target).add(offset);
    },
    reset() {
      const stage = stageRef.current;
      if (!stage) return;
      stage.camera.position.copy(stage.home.position);
      stage.controls.target.copy(stage.home.target);
    },
    toPNG() {
      const stage = stageRef.current;
      if (!stage) return null;
      stage.renderer.render(stage.scene, stage.camera);     // the drawing buffer is only valid right after a render
      return stage.renderer.domElement.toDataURL("image/png");
    },
    exportGLB() {
      const stage = stageRef.current;
      if (!stage) return Promise.reject(new Error("The 3D view is not ready."));
      // the exported model has every window and door, whichever way the camera is looking
      for (const fixture of stage.model.fixtures) fixture.object.visible = true;
      return new Promise<Blob>((resolve, reject) => {
        new GLTFExporter().parse(
          stage.model.root,
          (result) => resolve(new Blob([result as ArrayBuffer], { type: "model/gltf-binary" })),
          (error) => reject(error instanceof Error ? error : new Error("The 3D model could not be exported.")),
          { binary: true },
        );
      });
    },
  }), []);

  return <div ref={hostRef} className="absolute inset-0" style={{ cursor: "grab" }} />;
});

export default RoomScene3D;
