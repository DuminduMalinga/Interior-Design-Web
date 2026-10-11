/**
 * Turns a layout from any of the rule-based layout services into a three.js
 * model: the room shell (floor, walls with their door and window openings) and
 * one simple parametric model per piece of furniture, all at real size.
 *
 * Units: the layout is in millimetres with x running west -> east and y south
 * -> north; the model is in metres with X east, Y up and Z south, centred on
 * the middle of the floor.
 */

import * as THREE from "three";
import { furnitureColor } from "./roomPalette3d";
import type { LayoutDoor, LayoutFurnitureItem, LayoutWindow, LivingRoomLayoutResult, Wall } from "./livingRoomLayout";

const MM = 0.001;
const DOOR_HEIGHT = 2.1;
const WALL_COLOR = "#e7e5e4";
const FLOOR_COLOR = "#cdb99a";

// ─────────────────────────────────────────────
// Materials
// ─────────────────────────────────────────────
function solid(color: THREE.ColorRepresentation, roughness = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

function shade(color: string, amount: number): THREE.Color {
  const c = new THREE.Color(color);
  return amount >= 0 ? c.lerp(new THREE.Color("#ffffff"), amount) : c.lerp(new THREE.Color("#000000"), -amount);
}

// ─────────────────────────────────────────────
// Primitives (local frame: origin at the footprint centre on the floor, front = +Z)
// ─────────────────────────────────────────────
function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.005), Math.max(h, 0.005), Math.max(d, 0.005)), material);
  mesh.position.set(x, y + h / 2, z);       // `y` is the height of the box's underside
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(radius: number, h: number, material: THREE.Material, x = 0, y = 0, z = 0, top = radius): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, radius, h, 24), material);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function legs(group: THREE.Group, w: number, d: number, h: number, material: THREE.Material, size = 0.045, inset = 0.04) {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      group.add(box(size, h, size, material, sx * (w / 2 - inset - size / 2), 0, sz * (d / 2 - inset - size / 2)));
    }
  }
}

type Builder = (w: number, d: number, h: number, color: string, item: LayoutFurnitureItem, ceiling: number) => THREE.Group;

const sofa: Builder = (w, d, h, color) => {
  const g = new THREE.Group();
  const body = solid(color, 0.95);
  const cushion = solid(shade(color, 0.14), 0.95);
  const arm = Math.min(0.18, w * 0.12);
  const back = Math.min(0.22, d * 0.28);
  g.add(box(w, 0.3, d, body, 0, 0.04));                                        // base
  g.add(box(w - 2 * arm, 0.12, d - back - 0.02, cushion, 0, 0.34, back / 2 + 0.01));   // seat cushions
  g.add(box(w, Math.max(h, 0.6) - 0.04, back, body, 0, 0.04, -d / 2 + back / 2));       // back
  for (const side of [-1, 1]) g.add(box(arm, 0.58, d, body, side * (w / 2 - arm / 2), 0.04)); // arms
  return g;
};

const armchair: Builder = (w, d, h, color) => sofa(w, d, h, color, {} as LayoutFurnitureItem, 0);

/** A light chair on legs: dining chair, desk chair, stool (no back). */
const lightChair = (withBack: boolean): Builder => (w, d, h, color) => {
  const g = new THREE.Group();
  const frame = solid(shade(color, -0.25));
  const seatH = withBack ? 0.45 : Math.min(h, 0.48);
  legs(g, w * 0.9, d * 0.9, seatH - 0.05, frame, 0.035, 0);
  g.add(box(w * 0.92, 0.05, d * 0.92, solid(color), 0, seatH - 0.05));
  if (withBack) g.add(box(w * 0.92, Math.max(h - seatH, 0.3), 0.04, solid(color), 0, seatH, -d * 0.46 + 0.02));
  return g;
};

const table: Builder = (w, d, h, color) => {
  const g = new THREE.Group();
  const top = Math.min(0.05, h * 0.2);
  legs(g, w, d, h - top, solid(shade(color, -0.2)));
  g.add(box(w, top, d, solid(color, 0.6), 0, h - top));
  return g;
};

const cabinet: Builder = (w, d, h, color) => {
  const g = new THREE.Group();
  g.add(box(w - 0.02, 0.06, d - 0.04, solid(shade(color, -0.35)), 0, 0));       // plinth
  g.add(box(w, h - 0.06, d, solid(color), 0, 0.06));
  g.add(box(w + 0.01, 0.025, d + 0.01, solid(shade(color, 0.12), 0.5), 0, h - 0.02));   // top
  return g;
};

const bookshelf: Builder = (w, d, h, color) => {
  const g = new THREE.Group();
  const wood = solid(color);
  const t = 0.03;
  g.add(box(w, h, 0.015, solid(shade(color, -0.2)), 0, 0, -d / 2 + 0.008));     // back panel
  for (const side of [-1, 1]) g.add(box(t, h, d, wood, side * (w / 2 - t / 2), 0));
  const shelves = Math.max(2, Math.round(h / 0.38));
  const books = ["#b45309", "#1d4ed8", "#15803d", "#be123c", "#6d28d9"];
  for (let i = 0; i <= shelves; i++) {
    const y = (h - t) * (i / shelves);
    g.add(box(w - 2 * t, t, d, wood, 0, y));
    if (i < shelves) {
      g.add(box((w - 2 * t) * 0.7, (h / shelves) * 0.6, d * 0.6, solid(books[i % books.length]),
        -(w - 2 * t) * 0.12, y + t, 0));
    }
  }
  return g;
};

const television: Builder = (w, d) => {
  const g = new THREE.Group();
  const screenH = Math.min(w * 0.56, 0.9);
  const frame = new THREE.MeshStandardMaterial({ color: "#0b0f19", roughness: 0.35, metalness: 0.3 });
  const screen = new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 0.15, metalness: 0.4, emissive: "#0f1b33" });
  g.add(box(w, screenH, 0.045, frame, 0, 0.72, -d / 2 + 0.03));
  g.add(box(w - 0.04, screenH - 0.04, 0.01, screen, 0, 0.74, -d / 2 + 0.058));
  return g;
};

const glow = (color: string) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.6 });

const floorLamp: Builder = (w, _d, h, color) => {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: "#52525b", roughness: 0.4, metalness: 0.6 });
  const r = Math.min(w / 2, 0.2);
  g.add(cylinder(r * 0.8, 0.03, metal));
  g.add(cylinder(0.015, h - 0.3, metal, 0, 0.03));
  g.add(cylinder(r, 0.28, glow(color), 0, h - 0.28, 0, r * 0.65));
  return g;
};

/** A small lamp standing on a table or desk (`mount_height` is the surface it stands on). */
const tableLamp: Builder = (w, _d, _h, color, item) => {
  const g = new THREE.Group();
  const base = (item.mount_height ?? 600) * MM;
  const r = Math.max(Math.min(w / 2, 0.11), 0.07);
  const metal = new THREE.MeshStandardMaterial({ color: "#52525b", roughness: 0.4, metalness: 0.6 });
  g.add(cylinder(r * 0.6, 0.02, metal, 0, base));
  g.add(cylinder(0.012, 0.2, metal, 0, base + 0.02));
  g.add(cylinder(r, 0.16, glow(color), 0, base + 0.2, 0, r * 0.7));
  return g;
};

/** A light hung from the ceiling down to `mount_height`. */
const ceilingLight: Builder = (w, _d, _h, color, item, ceiling) => {
  const g = new THREE.Group();
  const at = Math.min((item.mount_height ?? ceiling * 1000 - 100) * MM, ceiling - 0.06);
  const r = Math.max(Math.min(w / 2, 0.22), 0.12);
  if (ceiling - at > 0.2) g.add(cylinder(0.006, ceiling - at - 0.12, solid("#27272a"), 0, at + 0.12));
  const lampShade = cylinder(r, 0.12, glow(color), 0, at, 0, r * 0.55);
  lampShade.castShadow = false;
  g.add(lampShade);
  return g;
};

const rug: Builder = (w, d, _h, color) => {
  const g = new THREE.Group();
  const outer = box(w, 0.012, d, solid(color, 1), 0, 0.002);
  const inner = box(w - 0.24, 0.004, d - 0.24, solid(shade(color, 0.18), 1), 0, 0.014);
  outer.castShadow = inner.castShadow = false;
  g.add(outer, inner);
  return g;
};

const bed: Builder = (w, d, h, color) => {
  const g = new THREE.Group();
  const frame = solid(color);
  g.add(box(w, 0.28, d, frame, 0, 0.04));
  g.add(box(w - 0.06, 0.2, d - 0.1, solid("#f1f5f9", 1), 0, 0.32, 0.03));                 // mattress
  g.add(box(w - 0.06, 0.03, d * 0.58, solid("#94a3b8", 1), 0, 0.52, d * 0.5 - d * 0.29 - 0.02)); // duvet
  g.add(box(w, Math.max(h, 0.9), 0.07, frame, 0, 0, -d / 2 + 0.035));                    // headboard
  const pillows = w > 1.3 ? [-1, 1] : [0];
  for (const side of pillows) {
    g.add(box(Math.min(0.62, w * 0.42), 0.1, 0.38, solid("#ffffff", 1), side * w * 0.24, 0.52, -d / 2 + 0.32));
  }
  return g;
};

const glass = () =>
  new THREE.MeshStandardMaterial({ color: "#bfdbfe", transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0.1,
    side: THREE.DoubleSide, depthWrite: false });

const shower: Builder = (w, d) => {
  const g = new THREE.Group();
  g.add(box(w, 0.05, d, solid("#f1f5f9", 0.4)));
  const screenH = 1.95;
  const front = box(w, screenH, 0.012, glass(), 0, 0.05, d / 2 - 0.006);
  const side = box(0.012, screenH, d, glass(), w / 2 - 0.006, 0.05, 0);
  front.castShadow = side.castShadow = false;
  g.add(front, side);
  g.add(cylinder(0.012, 2.0, solid("#94a3b8", 0.3), -w / 2 + 0.12, 0.05, -d / 2 + 0.06));   // riser
  g.add(cylinder(0.09, 0.02, solid("#94a3b8", 0.3), -w / 2 + 0.12, 2.03, -d / 2 + 0.14));   // head
  return g;
};

const toilet: Builder = (w, d, _h, color) => {
  const g = new THREE.Group();
  const china = solid(color, 0.25);
  g.add(box(w * 0.95, 0.42, 0.18, china, 0, 0.4, -d / 2 + 0.09));      // cistern
  g.add(box(w * 0.7, 0.4, d - 0.2, china, 0, 0, 0.08));                // pan
  g.add(box(w * 0.74, 0.03, d - 0.22, solid("#e2e8f0", 0.3), 0, 0.4, 0.08));   // seat
  return g;
};

const basin: Builder = (w, d, h, color) => {
  const g = new THREE.Group();
  const top = Math.max(Math.min(h, 0.9), 0.8);
  g.add(box(w, top - 0.14, d - 0.04, solid("#a3b8c2"), 0, 0.1, -0.02));        // vanity
  g.add(box(w, 0.14, d, solid(color, 0.25), 0, top - 0.14));                   // basin block
  g.add(box(w * 0.62, 0.02, d * 0.5, solid("#cbd5e1", 0.2), 0, top - 0.012, 0.03));   // bowl
  g.add(cylinder(0.012, 0.14, solid("#94a3b8", 0.3), 0, top, -d / 2 + 0.07)); // tap
  return g;
};

const stove: Builder = (w, d, h, color) => {
  const g = cabinet(w, d, h, color, {} as LayoutFurnitureItem, 0);
  const ring = solid("#18181b", 0.4);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cylinder(Math.min(w, d) * 0.16, 0.012, ring, sx * w * 0.22, h, sz * d * 0.2));
  return g;
};

const kitchenSink: Builder = (w, d, h, color) => {
  const g = cabinet(w, d, h, color, {} as LayoutFurnitureItem, 0);
  g.add(box(w * 0.6, 0.012, d * 0.55, solid("#94a3b8", 0.25), 0, h, 0.02));
  g.add(cylinder(0.014, 0.22, solid("#94a3b8", 0.3), 0, h, -d / 2 + 0.08));
  return g;
};

/** A fitting fixed to the wall behind it: mirror, towel rail, grab bar, mirror light. */
const wallFitting: Builder = (w, d, h, color, item) => {
  const g = new THREE.Group();
  const size = Math.max(Math.min(h, 1.4), 0.03);
  const centre = (item.mount_height ?? 1200) * MM;
  const depth = Math.max(Math.min(d, 0.12), 0.02);
  const material = item.type === "mirror"
    ? new THREE.MeshStandardMaterial({ color, roughness: 0.08, metalness: 0.25, emissive: "#1e3a5f", emissiveIntensity: 0.25 })
    : item.type === "mirror_light" ? glow(color) : solid(color, 0.4);
  g.add(box(w, size, depth, material, 0, Math.max(centre - size / 2, 0), -d / 2 + depth / 2));
  return g;
};

const drain: Builder = (w, _d, _h, color) => {
  const g = new THREE.Group();
  const disc = cylinder(Math.max(w / 2, 0.05), 0.006, solid(color, 0.3), 0, 0.001);
  disc.castShadow = false;
  g.add(disc);
  return g;
};

const plainBox: Builder = (w, d, h, color) => {
  const g = new THREE.Group();
  g.add(box(w, Math.max(h, 0.05), d, solid(color)));
  return g;
};

const BUILDERS: Record<string, Builder> = {
  sofa, loveseat: sofa, chair: armchair, reading_chair: armchair,
  desk_chair: lightChair(true), dining_chair: lightChair(true), stool: lightChair(false),
  coffee_table: table, side_table: table, bedside_table: cabinet, dining_table: table, desk: table, dressing_table: table,
  tv: television, tv_console: cabinet, storage_cabinet: cabinet, sideboard: cabinet, dresser: cabinet, wardrobe: cabinet,
  bookshelf, lamp: floorLamp, bedside_lamp: tableLamp, desk_lamp: tableLamp,
  pendant_light: ceilingLight, ceiling_light: ceilingLight,
  rug, bed, shower, toilet, washbasin: basin, bathroom_cabinet: cabinet,
  counter: cabinet, utensil_drawers: cabinet, fridge: cabinet, stove, sink: kitchenSink,
  mirror: wallFitting, towel_rail: wallFitting, towel_ring: wallFitting, grab_bar: wallFitting, mirror_light: wallFitting,
  floor_drain: drain,
};

// ─────────────────────────────────────────────
// Layout coordinates -> model coordinates
// ─────────────────────────────────────────────
interface Frame { width: number; length: number; height: number }

const toX = (x: number, f: Frame) => (x - f.width / 2) * MM;
const toZ = (y: number, f: Frame) => -(y - f.length / 2) * MM;

/** Rotation about the vertical axis that turns a model's front (+Z) to a compass facing. */
const FACING_ANGLE: Record<string, number> = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 };

/** A corner sofa is built straight from its two rectangles, already in room coordinates. */
function cornerSofa(item: LayoutFurnitureItem, f: Frame, color: string): THREE.Group {
  const g = new THREE.Group();
  const body = solid(color, 0.95);
  const cushion = solid(shade(color, 0.14), 0.95);
  const backT = 0.2;
  const h = Math.max(item.height * MM, 0.6);
  const [bx0, by0, bx1, by1] = item.bbox;
  const parts = item.parts ?? [item.bbox];
  // the side of the bounding box each compass direction names
  const edges = {
    south: (p: number[]) => Math.abs(p[1] - by0) < 1, north: (p: number[]) => Math.abs(p[3] - by1) < 1,
    west: (p: number[]) => Math.abs(p[0] - bx0) < 1, east: (p: number[]) => Math.abs(p[2] - bx1) < 1,
  };
  const opposite: Record<string, keyof typeof edges> = { north: "south", south: "north", east: "west", west: "east" };
  const backSide = opposite[item.facing];
  // the return is the part that does not span the whole back edge
  const spans = (p: number[]) => (backSide === "north" || backSide === "south")
    ? Math.abs(p[2] - p[0] - (bx1 - bx0)) < 1 : Math.abs(p[3] - p[1] - (by1 - by0)) < 1;

  for (const p of parts) {
    const [x0, y0, x1, y1] = p;
    const w = (x1 - x0) * MM, d = (y1 - y0) * MM;
    const cx = toX((x0 + x1) / 2, f), cz = toZ((y0 + y1) / 2, f);
    g.add(box(w, 0.3, d, body, cx, 0.04, cz));
    g.add(box(Math.max(w - 0.06, 0.1), 0.12, Math.max(d - 0.06, 0.1), cushion, cx, 0.34, cz));
    const sides: Array<keyof typeof edges> = spans(p) ? [backSide] : (["north", "south", "east", "west"] as const)
      .filter((s) => s !== item.facing && s !== backSide && edges[s](p));
    for (const side of sides) {
      if (!edges[side](p)) continue;
      if (side === "north" || side === "south") {
        const y = side === "south" ? y0 + backT * 500 : y1 - backT * 500;
        g.add(box(w, h - 0.04, backT, body, cx, 0.04, toZ(y, f)));
      } else {
        const x = side === "west" ? x0 + backT * 500 : x1 - backT * 500;
        g.add(box(backT, h - 0.04, d, body, toX(x, f), 0.04, cz));
      }
    }
  }
  return g;
}

function buildFurniture(item: LayoutFurnitureItem, f: Frame): THREE.Group {
  const color = furnitureColor(item.type);
  let group: THREE.Group;
  if (item.shape === "l" && item.parts) {
    group = cornerSofa(item, f, color);
  } else {
    const [x0, y0, x1, y1] = item.bbox;
    const builder = BUILDERS[item.type] ?? (item.mounted === "wall" ? wallFitting : plainBox);
    group = builder(item.width * MM, item.depth * MM, item.height * MM, color, item, f.height * MM);
    group.position.set(toX((x0 + x1) / 2, f), 0, toZ((y0 + y1) / 2, f));
    group.rotation.y = FACING_ANGLE[item.facing] ?? 0;
  }
  group.name = item.id;
  group.userData.itemId = item.id;
  return group;
}

// ─────────────────────────────────────────────
// Room shell
// ─────────────────────────────────────────────
const WALL_YAW: Record<Wall, number> = { north: 0, south: Math.PI, west: Math.PI / 2, east: -Math.PI / 2 };

/** A flat piece of wall facing into the room: [p0, p1] along the wall (mm), [z0, z1] above the floor (m). */
function wallPiece(wall: Wall, p0: number, p1: number, z0: number, z1: number, f: Frame, material: THREE.Material): THREE.Mesh | null {
  if (p1 - p0 < 1 || z1 - z0 < 0.001) return null;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry((p1 - p0) * MM, z1 - z0), material);
  const mid = (p0 + p1) / 2;
  const horizontal = wall === "north" || wall === "south";
  mesh.position.set(
    horizontal ? toX(mid, f) : toX(wall === "west" ? 0 : f.width, f),
    (z0 + z1) / 2,
    horizontal ? toZ(wall === "south" ? 0 : f.length, f) : toZ(mid, f),
  );
  mesh.rotation.y = WALL_YAW[wall];
  mesh.receiveShadow = true;
  return mesh;
}

/** A window or a door leaf: only drawn while its wall is (the camera is on the room side of it). */
export interface WallFixture {
  object: THREE.Object3D;
  /** A point on the wall and the wall's inward normal, in model coordinates. */
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

function buildShell(layout: LivingRoomLayoutResult, f: Frame, fixtures: WallFixture[]): THREE.Group {
  const shell = new THREE.Group();
  shell.name = "room";
  const H = f.height * MM;

  const floor = box(f.width * MM, 0.06, f.length * MM, solid(FLOOR_COLOR, 0.9), 0, -0.06);
  floor.castShadow = false;
  floor.name = "floor";
  shell.add(floor);

  // Each wall is a sheet facing inwards, so the walls between the camera and
  // the room are simply not drawn and the room can always be looked into.
  const wallMaterial = new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.95, side: THREE.FrontSide });
  const frameMaterial = solid("#f8fafc", 0.6);
  const doors: LayoutDoor[] = layout.openings?.doors ?? [];
  const windows: LayoutWindow[] = layout.openings?.windows ?? [];

  for (const wall of ["north", "south", "east", "west"] as Wall[]) {
    const length = wall === "north" || wall === "south" ? f.width : f.length;
    const openings = [
      ...doors.filter((d) => d.wall === wall).map((d) => ({ start: d.position, end: d.position + d.width, low: 0, high: Math.min(DOOR_HEIGHT, H) })),
      ...windows.filter((w) => w.wall === wall).map((w) => ({
        start: w.position, end: w.position + w.width,
        low: Math.min(w.sill_height * MM, H - 0.2), high: Math.min((w.sill_height + w.height) * MM, H - 0.05),
      })),
    ].map((o) => ({ ...o, start: Math.max(0, o.start), end: Math.min(length, o.end) }))
      .filter((o) => o.end > o.start).sort((a, b) => a.start - b.start);

    const pieces: Array<THREE.Mesh | null> = [];
    let cursor = 0;
    for (const o of openings) {
      const start = Math.max(o.start, cursor);
      pieces.push(wallPiece(wall, cursor, start, 0, H, f, wallMaterial));
      if (o.end > start) {
        pieces.push(wallPiece(wall, start, o.end, 0, o.low, f, wallMaterial));     // below a window
        pieces.push(wallPiece(wall, start, o.end, o.high, H, f, wallMaterial));    // above the opening
      }
      cursor = Math.max(cursor, o.end);
    }
    pieces.push(wallPiece(wall, cursor, length, 0, H, f, wallMaterial));
    for (const piece of pieces) if (piece) shell.add(piece);
  }

  // window panes and door leaves stand in a frame that sits on the wall line
  const onWall = (wall: Wall, position: number): THREE.Group => {
    const pivot = new THREE.Group();
    const horizontal = wall === "north" || wall === "south";
    pivot.position.set(
      horizontal ? toX(position, f) : toX(wall === "west" ? 0 : f.width, f), 0,
      horizontal ? toZ(wall === "south" ? 0 : f.length, f) : toZ(position, f));
    // local +X runs along the wall, local +Z into the room
    pivot.rotation.y = WALL_YAW[wall];
    fixtures.push({
      object: pivot,
      point: pivot.position.clone(),
      normal: new THREE.Vector3(Math.sin(WALL_YAW[wall]), 0, Math.cos(WALL_YAW[wall])),
    });
    return pivot;
  };
  // whether local +X runs towards increasing wall position (+1) or against it (-1)
  const ALONG_SIGN: Record<Wall, number> = { north: 1, south: -1, west: 1, east: -1 };

  for (const w of windows) {
    const low = Math.min(w.sill_height * MM, H - 0.2);
    const high = Math.min((w.sill_height + w.height) * MM, H - 0.05);
    const pivot = onWall(w.wall, w.position + w.width / 2);
    const pane = box(w.width * MM, high - low, 0.01, glass(), 0, low, 0);
    pane.castShadow = false;
    pivot.add(pane);
    const t = 0.04;
    pivot.add(box(w.width * MM, t, 0.06, frameMaterial, 0, low - t / 2, 0.02));           // sill
    pivot.add(box(w.width * MM, t, 0.04, frameMaterial, 0, high - t / 2, 0.01));
    for (const side of [-1, 1]) pivot.add(box(t, high - low, 0.04, frameMaterial, side * (w.width * MM / 2 - t / 2), low, 0.01));
    pivot.add(box(t * 0.7, high - low, 0.03, frameMaterial, 0, low, 0.01));               // mullion
    pivot.name = `window:${w.id}`;
    shell.add(pivot);
  }

  for (const d of doors) {
    const doorH = Math.min(DOOR_HEIGHT, H);
    const hingeAtStart = d.hinge === "left";
    const pivot = onWall(d.wall, hingeAtStart ? d.position : d.position + d.width);
    // towards the other jamb, in the pivot's own frame
    const along = ALONG_SIGN[d.wall] * (hingeAtStart ? 1 : -1);
    const leafMaterial = solid(d.is_main ? "#8b5e3c" : "#a8845f", 0.6);
    // the leaf runs along its own +X from the hinge
    const leaf = new THREE.Group();
    leaf.add(box(d.width * MM, doorH - 0.02, 0.04, leafMaterial, (d.width * MM) / 2, 0, 0));
    if (d.swing === "inward") {
      leaf.rotation.y = -Math.PI / 2;       // standing open, at right angles to the wall
      leaf.position.x = along * 0.02;
    } else {
      leaf.rotation.y = along > 0 ? 0 : Math.PI;   // closed, across the opening
    }
    pivot.add(leaf);
    pivot.name = `door:${d.id}`;
    shell.add(pivot);

    // a threshold on the floor marks the doorway even while its wall is hidden
    const horizontal = d.wall === "north" || d.wall === "south";
    const mid = d.position + d.width / 2;
    const inset = 40;                                    // mm inside the wall line
    const sill = box(horizontal ? d.width * MM : 0.08, 0.006, horizontal ? 0.08 : d.width * MM,
      solid(d.is_main ? "#facc15" : "#5eead4", 0.5),
      horizontal ? toX(mid, f) : toX(d.wall === "west" ? inset : f.width - inset, f), 0,
      horizontal ? toZ(d.wall === "south" ? inset : f.length - inset, f) : toZ(mid, f));
    sill.castShadow = false;
    sill.name = `threshold:${d.id}`;
    shell.add(sill);
  }
  return shell;
}

// ─────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────
export interface RoomModel {
  /** Everything: the room shell and the furniture. */
  root: THREE.Group;
  /** One group per piece of furniture, keyed by the item's id. */
  furniture: Map<string, THREE.Group>;
  /** Room size in metres. */
  size: { width: number; length: number; height: number };
  /** Windows and door leaves, to be hidden together with the wall they stand in. */
  fixtures: WallFixture[];
}

/** Show each window and door leaf only while the camera is on the room side of its wall. */
export function updateFixtureVisibility(model: RoomModel, camera: THREE.Vector3): void {
  for (const fixture of model.fixtures) {
    fixture.object.visible =
      (camera.x - fixture.point.x) * fixture.normal.x + (camera.z - fixture.point.z) * fixture.normal.z > 0;
  }
}

export function buildRoomModel(layout: LivingRoomLayoutResult): RoomModel {
  const f: Frame = {
    width: layout.room.width,
    length: layout.room.length,
    height: layout.room.height > 0 ? layout.room.height : 2800,
  };
  const root = new THREE.Group();
  root.name = layout.layout?.title ?? "room layout";
  const fixtures: WallFixture[] = [];
  root.add(buildShell(layout, f, fixtures));

  const furniture = new Map<string, THREE.Group>();
  const pieces = new THREE.Group();
  pieces.name = "furniture";
  for (const item of layout.furniture) {
    const group = buildFurniture(item, f);
    furniture.set(item.id, group);
    pieces.add(group);
  }
  root.add(pieces);
  return { root, furniture, fixtures, size: { width: f.width * MM, length: f.length * MM, height: f.height * MM } };
}

/** Free every geometry and material of a model. */
export function disposeModel(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
  });
}
