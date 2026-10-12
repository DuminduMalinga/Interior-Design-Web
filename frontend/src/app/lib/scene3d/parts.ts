/**
 * The shapes the furniture and the room are put together from, and what a
 * furniture builder is handed.
 *
 * A builder works in the piece's own frame: metres, origin at the middle of
 * its footprint on the floor, its front towards +Z and its width along X.
 */

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { LayoutFurnitureItem } from "../livingRoomLayout";
import type { Kit, Rnd } from "./materials";

export const MM = 0.001;
/** Thickness of the walls and of the floor slab they stand on. */
export const WALL = 0.1;
export const SLAB = 0.1;

/** Size of the room, in the layout's millimetres. */
export interface Frame { width: number; length: number; height: number }

// The layout is in millimetres with x running west -> east and y south -> north;
// the model is in metres with X east, Y up and Z south, centred on the middle of the floor.
export const toX = (x: number, f: Frame) => (x - f.width / 2) * MM;
export const toZ = (y: number, f: Frame) => -(y - f.length / 2) * MM;

export type RoomKind = "living" | "bedroom" | "kitchen" | "bathroom" | "dining";
export type Side = "back" | "front" | "left" | "right";

/** Everything a builder knows about the piece it is asked to make. */
export interface Piece {
  kit: Kit;
  item: LayoutFurnitureItem;
  /** Across the front, front to back and floor to top, metres. */
  w: number;
  d: number;
  h: number;
  /** Height of the room. */
  ceiling: number;
  kind: RoomKind;
  /** Random numbers that are the same every time this piece is built. */
  rnd: Rnd;
  /** Which one of its type this is, counting from 0. */
  n: number;
  /** The sides of the footprint that stand against a wall of the room. */
  against: Record<Side, boolean>;
  /** The lowest sill of a window in the wall on that side, over this piece; null when there is none. */
  sill: (side: Side) => number | null;
  /** Where the piece's centre lies along its own X and Z axes, so tiles line up from one unit to the next. */
  origin: { x: number; z: number };
  /** Top of the furniture this piece stands on (lamps), when there is one. */
  base: number | null;
  /** Something else stands on this piece, so its top is left clear. */
  carries: boolean;
}

export type Builder = (piece: Piece) => THREE.Group;

type Vec = [number, number, number];

const UP = new THREE.Vector3(0, 1, 0);
const atLeast = (value: number) => Math.max(value, 0.002);

/**
 * Rewrite a geometry's UVs in metres, each face seen square on. With `grain`
 * the texture is turned to run along the longer side of the face, the way
 * timber is cut.
 */
export function metreUV<T extends THREE.BufferGeometry>(geometry: T, grain = true, offset: [number, number] = [0, 0]): T {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  if (!normal || !uv) return geometry;
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const ax = Math.abs(normal.getX(i));
    const ay = Math.abs(normal.getY(i));
    const az = Math.abs(normal.getZ(i));
    let u: number, v: number, su: number, sv: number;
    if (ay >= ax && ay >= az) { u = x + offset[0]; v = z + offset[1]; su = size.x; sv = size.z; }   // top and bottom
    else if (ax >= az) { u = z + offset[1]; v = y; su = size.z; sv = size.y; }                       // the two ends
    else { u = x + offset[0]; v = y; su = size.x; sv = size.y; }                                     // front and back
    if (grain && sv > su) uv.setXY(i, v, u);
    else uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geometry;
}

function solid(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A box centred on (x, z) with its underside at height `y`. */
export function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = solid(metreUV(new THREE.BoxGeometry(atLeast(w), atLeast(h), atLeast(d))), material);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}

/** A box with its edges rounded to radius `r`: cushions, mattresses, anything soft or moulded. */
export function rbox(w: number, h: number, d: number, r: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const [bw, bh, bd] = [atLeast(w), atLeast(h), atLeast(d)];
  const radius = Math.max(Math.min(r, bw / 2, bh / 2, bd / 2) - 0.0005, 0.0005);
  const mesh = solid(metreUV(new RoundedBoxGeometry(bw, bh, bd, 3, radius)), material);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}

/** An upright cylinder (a cone when `top` differs from `r`) with its underside at height `y`. */
export function cyl(r: number, h: number, material: THREE.Material, x = 0, y = 0, z = 0, top = r, segments = 28): THREE.Mesh {
  const mesh = solid(metreUV(new THREE.CylinderGeometry(atLeast(top), atLeast(r), atLeast(h), segments)), material);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}

/** A disc standing on edge, facing +Z: a round mirror, a knob, a dial. */
export function disc(r: number, thickness: number, material: THREE.Material, x = 0, y = 0, z = 0, segments = 36): THREE.Mesh {
  const mesh = solid(new THREE.CylinderGeometry(atLeast(r), atLeast(r), atLeast(thickness), segments), material);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

/** A ball centred on (x, y, z), optionally squashed along its axes. */
export function ball(r: number, material: THREE.Material, x = 0, y = 0, z = 0, squash: Vec = [1, 1, 1]): THREE.Mesh {
  const mesh = solid(new THREE.SphereGeometry(atLeast(r), 20, 14), material);
  mesh.position.set(x, y, z);
  mesh.scale.set(...squash);
  return mesh;
}

/** A round bar from `a` to `b`, `top` being its radius at `b` when it tapers. */
export function rod(a: Vec, b: Vec, r: number, material: THREE.Material, top = r, segments = 12): THREE.Mesh {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const mesh = solid(metreUV(new THREE.CylinderGeometry(atLeast(top), atLeast(r), atLeast(from.distanceTo(to)), segments)), material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, to.sub(from).normalize());
  return mesh;
}

/**
 * A turned shape. `profile` is [radius, height] pairs from the bottom up the
 * outside - and, for a bowl, on over the rim and down the inside.
 */
export function lathe(profile: Array<[number, number]>, material: THREE.Material, x = 0, y = 0, z = 0, segments = 32): THREE.Mesh {
  const points = profile.map(([r, h]) => new THREE.Vector2(Math.max(r, 0.0005), h));
  const mesh = solid(new THREE.LatheGeometry(points, segments), material);
  mesh.position.set(x, y, z);
  return mesh;
}

/** Part of a ring, standing in the plane across X with its ends level: a tap's neck, a handle. */
export function arch(radius: number, r: number, material: THREE.Material, x = 0, y = 0, z = 0, sweep = Math.PI): THREE.Mesh {
  const mesh = solid(new THREE.TorusGeometry(atLeast(radius), atLeast(r), 10, 24, sweep), material);
  mesh.rotation.y = -Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

/** A whole ring, lying flat unless `upright` (then it faces +Z). */
export function ring(radius: number, r: number, material: THREE.Material, x = 0, y = 0, z = 0, upright = false): THREE.Mesh {
  const mesh = solid(new THREE.TorusGeometry(atLeast(radius), atLeast(r), 10, 32), material);
  if (!upright) mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * A flat sheet cut to an outline, lying on height `y`. The outline is drawn
 * looking down on it: its x is the model's X, its y the model's -Z.
 */
export function sheet(outline: THREE.Shape, thickness: number, material: THREE.Material, y = 0): THREE.Mesh {
  const geometry = new THREE.ExtrudeGeometry(outline, { depth: atLeast(thickness), bevelEnabled: false, curveSegments: 16 });
  geometry.rotateX(-Math.PI / 2);
  const mesh = solid(metreUV(geometry), material);
  mesh.position.y = y;
  return mesh;
}

/** A rectangle outline for `sheet`, centred on (x, z). */
export function rectangle(w: number, d: number, x = 0, z = 0): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(x - w / 2, -z - d / 2);
  shape.lineTo(x + w / 2, -z - d / 2);
  shape.lineTo(x + w / 2, -z + d / 2);
  shape.lineTo(x - w / 2, -z + d / 2);
  shape.closePath();
  return shape;
}

/** The same with rounded corners, as a hole to cut out of a `sheet`. */
export function roundedHole(w: number, d: number, x: number, z: number, r: number): THREE.Path {
  const path = new THREE.Path();
  const [x0, x1, y0, y1] = [x - w / 2, x + w / 2, -z - d / 2, -z + d / 2];
  path.moveTo(x0 + r, y0);
  path.lineTo(x1 - r, y0);
  path.quadraticCurveTo(x1, y0, x1, y0 + r);
  path.lineTo(x1, y1 - r);
  path.quadraticCurveTo(x1, y1, x1 - r, y1);
  path.lineTo(x0 + r, y1);
  path.quadraticCurveTo(x0, y1, x0, y1 - r);
  path.lineTo(x0, y0 + r);
  path.quadraticCurveTo(x0, y0, x0 + r, y0);
  return path;
}

interface LegOptions {
  r?: number;
  /** How far the legs stand in from the edges of the footprint. */
  inset?: number;
  /** Radius at the foot as a share of the radius at the top. */
  taper?: number;
  /** Square legs rather than round ones. */
  square?: boolean;
  /** Shift of the whole set along Z. */
  z?: number;
}

/** Four legs under a `w` x `d` footprint, from the floor up to `h`. */
export function legs(g: THREE.Group, w: number, d: number, h: number, material: THREE.Material, options: LegOptions = {}): void {
  const { r = 0.02, inset = 0.05, taper = 1, square = false, z = 0 } = options;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - inset - r);
      const lz = z + sz * (d / 2 - inset - r);
      if (square) g.add(box(r * 2, h, r * 2, material, x, 0, lz));
      else g.add(cyl(r * taper, h, material, x, 0, lz, r, 14));
    }
  }
}

/** A slim bar handle standing proud of the face at `z`, upright or level. */
export function barHandle(g: THREE.Group, material: THREE.Material, length: number, x: number, y: number, z: number, upright: boolean): void {
  const t = 0.011;
  const stand = 0.024;
  const span = length - 0.03;
  if (upright) {
    g.add(box(t, length, t, material, x, y - length / 2, z + stand));
    for (const side of [-1, 1]) g.add(box(t, t, stand, material, x, y + side * (span / 2) - t / 2, z + stand / 2));
  } else {
    g.add(box(length, t, t, material, x, y - t / 2, z + stand));
    for (const side of [-1, 1]) g.add(box(t, t, stand, material, x + side * (span / 2), y - t / 2, z + stand / 2));
  }
}

export interface Panel { x: number; y: number; w: number; h: number }

/**
 * Door or drawer fronts filling the rectangle from (x0, y0), `cols` across and
 * `rows` up, a shadow gap apart, standing `t` proud of the face at `z`.
 */
export function panels(
  g: THREE.Group, material: THREE.Material, x0: number, y0: number, w: number, h: number, z: number,
  cols: number, rows: number, t = 0.018, gap = 0.004,
): Panel[] {
  const out: Panel[] = [];
  const pw = w / cols;
  const ph = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const panel = { x: x0 + pw * (c + 0.5), y: y0 + ph * r + gap / 2, w: pw - gap, h: ph - gap };
      g.add(box(panel.w, panel.h, t, material, panel.x, panel.y, z + t / 2));
      out.push(panel);
    }
  }
  return out;
}

/**
 * A flat patch for a soft shadow lying on the floor: `w` x `d` with `margin`
 * more all round. Its texture fades out from the middle; the patch stretches
 * the middle of it, so the fade keeps its width whatever the size and the
 * corners come out round.
 */
export function softPatch(w: number, d: number, margin: number): THREE.BufferGeometry {
  const m = Math.min(margin, w / 2, d / 2);
  const xs = [-w / 2 - margin, -w / 2 + m, w / 2 - m, w / 2 + margin];
  const zs = [-d / 2 - margin, -d / 2 + m, d / 2 - m, d / 2 + margin];
  const uvs = [0, 0.5, 0.5, 1];
  const position: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      position.push(xs[i], 0, zs[j]);
      uv.push(uvs[i], uvs[j]);
    }
  }
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const a = j * 4 + i;
      index.push(a, a + 4, a + 1, a + 4, a + 5, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

// ─────────────────────────────────────────────
// Folding a model down to a few meshes
// ─────────────────────────────────────────────

/** Turn the triangles of a non-indexed geometry round, after a transform that mirrored it. */
function flipFaces(geometry: THREE.BufferGeometry): void {
  for (const attribute of Object.values(geometry.attributes)) {
    const { array, itemSize } = attribute as THREE.BufferAttribute;
    for (let i = 0; i < array.length; i += 3 * itemSize) {
      for (let k = 0; k < itemSize; k++) {
        const a = i + itemSize + k;
        const b = i + 2 * itemSize + k;
        [array[a], array[b]] = [array[b], array[a]];
      }
    }
  }
}

/**
 * Fold every mesh of a model into one mesh per material, in the model's own
 * frame. A piece of furniture is built from dozens of parts but only a handful
 * of materials, so this is what keeps a furnished room cheap to draw.
 */
export function bake(group: THREE.Group): THREE.Group {
  group.updateMatrixWorld(true);
  const toGroup = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; parts: THREE.BufferGeometry[] }>();
  const folded: THREE.Mesh[] = [];

  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;       // a mesh with several materials stays as it is
    const source = mesh.geometry;
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") geometry.deleteAttribute(name);
    }
    if (!geometry.attributes.uv) {
      geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
    }
    const matrix = new THREE.Matrix4().multiplyMatrices(toGroup, mesh.matrixWorld);
    geometry.applyMatrix4(matrix);
    if (matrix.determinant() < 0) flipFaces(geometry);
    const key = `${mesh.material.uuid}:${mesh.castShadow}:${mesh.receiveShadow}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material: mesh.material, cast: mesh.castShadow, receive: mesh.receiveShadow, parts: [] };
      buckets.set(key, bucket);
    }
    bucket.parts.push(geometry);
    folded.push(mesh);
  });

  for (const mesh of folded) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  }
  for (const bucket of buckets.values()) {
    const merged = bucket.parts.length === 1 ? bucket.parts[0] : mergeGeometries(bucket.parts);
    if (bucket.parts.length > 1) for (const part of bucket.parts) part.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.castShadow = bucket.cast;
    mesh.receiveShadow = bucket.receive;
    group.add(mesh);
  }
  return group;
}
