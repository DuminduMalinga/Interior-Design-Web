import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { LivingRoomLayoutResult } from "../lib/livingRoomLayout";
import {
  SLAB, WALL, buildRoomModel, disposeModel, pinFixture, showAllWalls, updateWalls, type RoomModel,
} from "../lib/roomScene3d";

export type SceneQuality = "High" | "Medium" | "Low";
/** What the room stands in front of: a white studio or a dark one. */
export type SceneBackdrop = "light" | "dark";

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
  backdrop?: SceneBackdrop;
  onFps?: (fps: number) => void;
  /** Called when WebGL cannot be started. */
  onError?: (message: string) => void;
}

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** The one light that casts shadows. */
  key: THREE.DirectionalLight;
  model: RoomModel;
  home: { position: THREE.Vector3; target: THREE.Vector3 };
  /** The user has moved the view: a change of the view's size no longer puts it back where it started. */
  touched: boolean;
  /** Something changed that the next frame has to draw. */
  dirty: boolean;
  /** The model is being exported: leave its walls alone. */
  exporting: boolean;
}

const HIGHLIGHT = new THREE.Color("#8b7cf6");
const UP = new THREE.Vector3(0, 1, 0);

/** The studio the room stands in: light in the middle, falling off to the corners. */
const BACKDROPS: Record<SceneBackdrop, [string, string, string]> = {
  light: ["#ffffff", "#f0eff8", "#dedcef"],
  dark: ["#332e58", "#1c1934", "#110f20"],
};
const backdropCss = (backdrop: SceneBackdrop) => {
  const [inner, middle, outer] = BACKDROPS[backdrop];
  return `radial-gradient(ellipse 75% 70% at 50% 42%, ${inner} 0%, ${middle} 60%, ${outer} 100%)`;
};

/**
 * Where the camera has to stand, looking back along `direction`, for every one
 * of `points` to be in the picture with a little room to spare, and the point
 * it then looks at: the one that puts the picture in the middle of the view.
 */
function frameView(camera: THREE.PerspectiveCamera, direction: THREE.Vector3, points: THREE.Vector3[], margin = 0.86) {
  const forward = direction.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward);
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * margin;
  const tanH = tanV * camera.aspect;
  const target = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  const offset = new THREE.Vector3();
  let distance = 1;
  for (let pass = 0; pass < 4; pass++) {
    // slide the target until the picture is centred, then stand back far enough for the widest point
    const across = { lo: Infinity, hi: -Infinity };
    const upright = { lo: Infinity, hi: -Infinity };
    for (const point of points) {
      offset.copy(point).sub(target);
      const depth = offset.dot(forward) + distance;
      across.lo = Math.min(across.lo, offset.dot(right) / depth);
      across.hi = Math.max(across.hi, offset.dot(right) / depth);
      upright.lo = Math.min(upright.lo, offset.dot(up) / depth);
      upright.hi = Math.max(upright.hi, offset.dot(up) / depth);
    }
    if (pass > 0) {
      target.addScaledVector(right, ((across.lo + across.hi) / 2) * distance);
      target.addScaledVector(up, ((upright.lo + upright.hi) / 2) * distance);
    }
    distance = 0;
    for (const point of points) {
      offset.copy(point).sub(target);
      const depth = offset.dot(forward);
      distance = Math.max(distance, Math.abs(offset.dot(right)) / tanH - depth, Math.abs(offset.dot(up)) / tanV - depth);
    }
  }
  // a touch above the middle: the bottom of the view is where the page puts its hint
  target.addScaledVector(up, -0.03 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  return { position: target.clone().addScaledVector(direction, distance), target };
}

function paintBackdrop(g: CanvasRenderingContext2D, width: number, height: number, backdrop: SceneBackdrop): void {
  const [inner, middle, outer] = BACKDROPS[backdrop];
  g.save();
  g.translate(width * 0.5, height * 0.42);
  g.scale(width * 0.75, height * 0.7);
  const gradient = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.6, middle);
  gradient.addColorStop(1, outer);
  g.fillStyle = gradient;
  g.fillRect(-2, -2, 4, 4);
  g.restore();
}

/** An interactive three.js view of one layout: drag to orbit, scroll to zoom, click a piece to select it. */
const RoomScene3D = forwardRef<RoomScene3DHandle, Props>(function RoomScene3D(
  { layout, selectedId, onSelect, quality, backdrop = "light", onFps, onError },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const highlighted = useRef<Map<THREE.MeshStandardMaterial, { color: THREE.Color; intensity: number }>>(new Map());
  const callbacks = useRef({ onSelect, onFps, onError });
  callbacks.current = { onSelect, onFps, onError };
  const selectedRef = useRef(selectedId);
  const qualityRef = useRef(quality);
  const backdropRef = useRef(backdrop);
  backdropRef.current = backdrop;

  const applyQuality = (stage: Stage, level: SceneQuality) => {
    const ratio = window.devicePixelRatio || 1;
    stage.renderer.setPixelRatio(level === "High" ? Math.min(ratio, 2) : level === "Medium" ? Math.min(ratio, 1.25) : 1);
    const { shadow } = stage.key;
    const size = Math.min(level === "High" ? 4096 : 2048, stage.renderer.capabilities.maxTextureSize);
    stage.key.castShadow = level !== "Low";
    if (shadow.mapSize.x !== size) {
      shadow.mapSize.set(size, size);
      shadow.map?.dispose();
      shadow.map = null;                       // made again at the new size on the next frame
    }
    shadow.radius = level === "High" ? 3.5 : 2;
    stage.dirty = true;
  };

  const applySelection = (stage: Stage, id: string | null) => {
    for (const [material, original] of highlighted.current) {
      material.emissive.copy(original.color);
      material.emissiveIntensity = original.intensity;
    }
    highlighted.current.clear();
    const group = id ? stage.model.furniture.get(id) : undefined;
    pinFixture(stage.model.walls, group ?? null);       // a selected fitting stays in view when its wall goes
    group?.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]) {
        if (!material.isMeshStandardMaterial || highlighted.current.has(material)) continue;
        highlighted.current.set(material, { color: material.emissive.clone(), intensity: material.emissiveIntensity });
        material.emissive.copy(HIGHLIGHT);
        material.emissiveIntensity = 0.38;
      }
    });
    stage.dirty = true;
  };

  // ── build the scene for this layout ──────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (err) {
      callbacks.current.onError?.(err instanceof Error ? err.message : "WebGL is not available in this browser.");
      return;
    }
    renderer.setClearColor(0x000000, 0);                 // the studio backdrop shows through
    renderer.toneMapping = THREE.NeutralToneMapping;     // keeps the colours of the finishes true
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    // soft light from every side, and something for steel, glass and mirrors to reflect
    const pmrem = new THREE.PMREMGenerator(renderer);
    const studio = new RoomEnvironment();
    const environment = pmrem.fromScene(studio, 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.5;
    studio.dispose();
    pmrem.dispose();

    const model = buildRoomModel(layout);
    scene.add(model.root, model.extras);

    const { width, length, height } = model.size;
    const centre = new THREE.Vector3(0, height * 0.3, 0);
    const radius = 0.5 * Math.hypot(width + 2 * WALL, length + 2 * WALL, height);

    // The lights stay where they are for the viewer, as for a model on a
    // turntable: the key over the left shoulder, a weaker one filling in from
    // the right. So the walls in view are always lit and shadows fall away.
    const key = new THREE.DirectionalLight("#fff6ea", 2.4);
    const fill = new THREE.DirectionalLight("#eef2ff", 0.6);
    const reach = radius * 1.2;
    Object.assign(key.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: radius * 2.4, far: radius * 5.6 });
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.02;
    scene.add(key, key.target, fill, fill.target, new THREE.HemisphereLight("#ffffff", "#d9d2c7", 0.12));

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;      // never below the floor
    controls.minDistance = radius * 0.6;

    const stage: Stage = {
      renderer, scene, camera, controls, key, model,
      home: { position: new THREE.Vector3(), target: new THREE.Vector3() }, touched: false, dirty: true, exporting: false,
    };
    stageRef.current = stage;
    controls.addEventListener("start", () => { stage.touched = true; });
    // The wheel moves the camera inside its own event handler (OrbitControls calls
    // update() there), so by the time the loop's update() runs it sees no movement
    // and skips the frame: zooming would only show on the next redraw. Any change
    // the controls make, wherever it comes from, asks for a frame.
    controls.addEventListener("change", () => { stage.dirty = true; });

    // What the opening view has to take in: the floor and the two far walls. The
    // camera looks in over the corner the room shows best from, where the walls are taken away.
    const direction = new THREE.Vector3(0.72 * model.view.x, 0.66, 0.88 * model.view.z).normalize();
    const corners: THREE.Vector3[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push(new THREE.Vector3(sx * (width / 2 + WALL), -SLAB, sz * (length / 2 + WALL)));
        if (sx !== model.view.x || sz !== model.view.z) {
          corners.push(new THREE.Vector3(sx * (width / 2 + WALL), height, sz * (length / 2 + WALL)));
        }
      }
    }

    const aim = () => {
      const azimuth = controls.getAzimuthalAngle();
      const place = (light: THREE.DirectionalLight, swing: number, lift: number) => {
        const turn = azimuth + swing;
        light.position
          .set(Math.sin(turn) * Math.cos(lift), Math.sin(lift), Math.cos(turn) * Math.cos(lift))
          .multiplyScalar(radius * 4)
          .add(centre);
        light.target.position.copy(centre);
      };
      place(key, -0.45, 0.95);
      place(fill, 1.2, 0.45);
      scene.environmentRotation.y = azimuth;
    };

    const goHome = () => {
      camera.position.copy(stage.home.position);
      controls.target.copy(stage.home.target);
      controls.update();
    };
    const frame = () => {
      const w = Math.max(host.clientWidth, 1);
      const h = Math.max(host.clientHeight, 1);
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const view = frameView(camera, direction, corners);
      stage.home.position.copy(view.position);
      stage.home.target.copy(view.target);
      controls.maxDistance = view.position.distanceTo(view.target) * 1.8;
      if (!stage.touched) goHome();
      stage.dirty = true;
    };
    frame();
    updateWalls(model.walls, camera.position, 0);

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
      const hit = ray.intersectObjects([...model.furniture.values()].filter((piece) => piece.visible), true)[0];
      let object: THREE.Object3D | null = hit?.object ?? null;
      while (object && !object.userData.itemId) object = object.parent;
      callbacks.current.onSelect(object ? (object.userData.itemId as string) : null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    // WASD walks the view over the floor: W / S along the way the camera looks,
    // A / D to the sides, Shift for double speed. Camera and orbit centre move
    // together, so the mouse orbits and zooms from wherever the keys have taken
    // it. The keys only count while the pointer is over the view or it has
    // focus, and never while typing into a field.
    const held = new Set<string>();
    let hovered = false;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.style.outline = "none";
    const onEnter = () => { hovered = true; };
    const onLeave = () => { hovered = false; };
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!"wasd".includes(key) || key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (!hovered && document.activeElement !== renderer.domElement) return;
      e.preventDefault();
      held.add(key);
      stage.touched = true;
    };
    const onKeyUp = (e: KeyboardEvent) => { held.delete(e.key.toLowerCase()); };
    const release = () => held.clear();
    renderer.domElement.addEventListener("pointerenter", onEnter);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);

    const forward = new THREE.Vector3();
    const side = new THREE.Vector3();
    const step = new THREE.Vector3();
    // how far from the room the orbit centre may wander (m)
    const roam = { x: width / 2 + 1, z: length / 2 + 1 };
    const walk = (dt: number, fast: boolean): boolean => {
      if (!held.size) return false;
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) return false;   // looking straight down: no "forward"
      forward.normalize();
      side.crossVectors(forward, UP);                 // to the right of the view
      step.set(0, 0, 0);
      if (held.has("w")) step.add(forward);
      if (held.has("s")) step.sub(forward);
      if (held.has("d")) step.add(side);
      if (held.has("a")) step.sub(side);
      if (step.lengthSq() === 0) return false;
      const speed = Math.max(1.5, radius * 0.8) * (fast ? 2 : 1);   // m per second
      step.normalize().multiplyScalar(speed * dt);
      // keep the orbit centre near the room
      const target = controls.target;
      step.x = THREE.MathUtils.clamp(target.x + step.x, -roam.x, roam.x) - target.x;
      step.z = THREE.MathUtils.clamp(target.z + step.z, -roam.z, roam.z) - target.z;
      camera.position.add(step);
      target.add(step);
      return step.lengthSq() > 0;
    };
    let shift = false;
    const onShift = (e: KeyboardEvent) => { shift = e.shiftKey; };
    window.addEventListener("keydown", onShift);
    window.addEventListener("keyup", onShift);

    // a frame is only drawn when the view has changed: the camera moved, a wall is coming or going
    let raf = 0;
    let frames = 0;
    let since = performance.now();
    let last = since;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const walked = walk(dt, shift);
      const moved = controls.update() || walked;
      const walls = !stage.exporting && updateWalls(model.walls, camera.position, dt);
      if (moved || walls || stage.dirty) {
        stage.dirty = false;
        aim();
        renderer.render(scene, camera);
      }
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
      renderer.domElement.removeEventListener("pointerenter", onEnter);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("keydown", onShift);
      window.removeEventListener("keyup", onShift);
      window.removeEventListener("blur", release);
      controls.dispose();
      disposeModel(model);
      environment.dispose();
      key.shadow.map?.dispose();
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
      stage.touched = true;
    },
    rotate(degrees) {
      const stage = stageRef.current;
      if (!stage) return;
      const { camera, controls } = stage;
      const offset = camera.position.clone().sub(controls.target).applyAxisAngle(UP, THREE.MathUtils.degToRad(degrees));
      camera.position.copy(controls.target).add(offset);
      stage.touched = true;
    },
    reset() {
      const stage = stageRef.current;
      if (!stage) return;
      stage.camera.position.copy(stage.home.position);
      stage.controls.target.copy(stage.home.target);
      stage.touched = false;
    },
    toPNG() {
      const stage = stageRef.current;
      if (!stage) return null;
      const view = stage.renderer.domElement;
      stage.renderer.render(stage.scene, stage.camera);     // the drawing buffer is only valid right after a render
      // the view itself is see-through; the picture gets the studio backdrop put behind it
      const picture = document.createElement("canvas");
      picture.width = view.width;
      picture.height = view.height;
      const g = picture.getContext("2d");
      if (!g) return view.toDataURL("image/png");
      paintBackdrop(g, picture.width, picture.height, backdropRef.current);
      g.drawImage(view, 0, 0);
      return picture.toDataURL("image/png");
    },
    exportGLB() {
      const stage = stageRef.current;
      if (!stage) return Promise.reject(new Error("The 3D view is not ready."));
      // the exported model has all four walls and no selection glow, whichever way the camera is looking
      stage.exporting = true;
      applySelection(stage, null);
      showAllWalls(stage.model.walls);
      const done = () => {
        stage.exporting = false;
        if (stageRef.current !== stage) return;
        applySelection(stage, selectedRef.current);
        updateWalls(stage.model.walls, stage.camera.position, 0);
      };
      return new Promise<Blob>((resolve, reject) => {
        new GLTFExporter().parse(
          stage.model.root,
          (result) => {
            done();
            resolve(new Blob([result as ArrayBuffer], { type: "model/gltf-binary" }));
          },
          (error) => {
            done();
            reject(error instanceof Error ? error : new Error("The 3D model could not be exported."));
          },
          { binary: true },
        );
      });
    },
  }), []);

  return <div ref={hostRef} className="absolute inset-0" style={{ cursor: "grab", background: backdropCss(backdrop) }} />;
});

export default RoomScene3D;
