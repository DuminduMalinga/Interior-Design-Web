/**
 * The room itself: the floor, the four walls with their window and door
 * openings, the windows, the doors and what hangs on the walls.
 *
 * Each wall is built whole, in a group of its own, and is taken away when the
 * camera goes round behind it, so the room can always be looked into. A low
 * kerb is left standing in its place to show where the wall and its doorways
 * are.
 *
 * A non-rectangular room (an L, say) comes as its bounding rectangle with
 * cut-outs: no wall is built where a cut-out reaches the rectangle's edge, and
 * a plain wall stands along each cut-out edge that borders the floor.
 */

import * as THREE from "three";
import type { LayoutDoor, LayoutFurnitureItem, LayoutWindow, LivingRoomLayoutResult, Wall } from "../livingRoomLayout";
import { FINISH } from "../roomPalette3d";
import { cutoutSpans, floorRects, inNotchWall, notchWalls, type Cutout } from "../roomCutouts";
import { OPPOSITE, standsOnFloor } from "./furniture";
import { seeded, tone, type Kit, type Rnd } from "./materials";
import { MM, SLAB, WALL, bake, box, disc, metreUV, rbox, rod, type Frame, type RoomKind } from "./parts";

const DOOR_HEIGHT = 2.1;
/** mm: the widest opening one door leaf fills; anything wider is an open doorway. */
const MAX_LEAF_WIDTH = 1100;
const SKIRTING = 0.08;
const KERB = 0.03;
/** Seconds a wall takes to come or go. */
const FADE = 0.2;

const WALLS: Wall[] = ["north", "south", "east", "west"];
const WALL_YAW: Record<Wall, number> = { north: 0, south: Math.PI, west: Math.PI / 2, east: -Math.PI / 2 };
/** Whether a wall's own +X runs towards increasing wall position (+1) or against it (-1). */
const ALONG_SIGN: Record<Wall, number> = { north: 1, south: -1, west: 1, east: -1 };

export interface WallView {
  wall: Wall;
  /** The whole wall: masonry, skirting, windows, doors and what hangs on it. */
  full: THREE.Group;
  /** What is left standing while the wall is taken away. */
  kerb: THREE.Group;
  /** A point on the wall's inside face and the direction into the room. */
  point: THREE.Vector3;
  normal: THREE.Vector3;
  /** Every material of the wall with the opacity it has when the wall is fully there. */
  materials: Faded[];
  /** Furniture fixed to this wall - a mirror, a towel rail, the television: it comes and goes with it. */
  fixtures: Array<{ group: THREE.Group; materials: Faded[] }>;
  /** How much of the wall is showing, 0 to 1. */
  shown: number;
}

/** A material and the opacity it has when what it belongs to is fully there. */
interface Faded { material: THREE.Material; opacity: number }

/** The materials of a part, made ready to thin out as the part goes. */
function fading(part: THREE.Object3D): Faded[] {
  const out: Faded[] = [];
  part.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material.transparent) material.alphaHash = true;
      out.push({ material, opacity: material.opacity });
    }
  });
  return out;
}

/** Tie a piece of furniture to the wall it is fixed to. */
export function fixToWall(walls: WallView[], wall: Wall, group: THREE.Group): void {
  walls.find((view) => view.wall === wall)?.fixtures.push({ group, materials: fading(group) });
}

// ─────────────────────────────────────────────
// Finishes, by room
// ─────────────────────────────────────────────
const BOARDS: Record<RoomKind, string> = {
  living: "#c8a57a", bedroom: "#d1b48c", dining: "#c29a6a", kitchen: "#cba777", bathroom: "",
};
const FLOOR_TILES = { cols: 2, rows: 2, metres: [1.2, 1.2] as [number, number], base: "#b9b1a4", grout: "#9d9588", vary: 0.06, joint: 0.006 };
const WALL_TILES = { cols: 2, rows: 4, metres: [1.2, 1.2] as [number, number], base: "#efede8", grout: "#d3d0c9", vary: 0.025, joint: 0.005 };
const WALL_COLOR = "#f2efe9";
const TRIM_COLOR = "#fbfaf7";
const FRAME_COLOR = "#3b3f45";

// ─────────────────────────────────────────────
// A wall's own frame
// ─────────────────────────────────────────────

/** Geometry is laid out along one wall: x along it, y up, z into the room from its inside face. */
interface Run {
  wall: Wall;
  /** Wall position (mm) to the wall's own x (m). */
  x: (position: number) => number;
}

/** A block between two wall positions, two heights and two depths, textured in the wall's frame. */
function block(run: Run, p0: number, p1: number, y0: number, y1: number, z0: number, z1: number, material: THREE.Material): THREE.Mesh | null {
  if (p1 - p0 < 1 || y1 - y0 < 0.001) return null;
  const xa = run.x(p0);
  const xb = run.x(p1);
  const geometry = new THREE.BoxGeometry(Math.abs(xb - xa), y1 - y0, z1 - z0);
  geometry.translate((xa + xb) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const mesh = new THREE.Mesh(metreUV(geometry, false), material);
  mesh.receiveShadow = true;
  return mesh;
}

/** The stretches of [from, to] that the given spans leave free. */
function between(from: number, to: number, spans: Array<{ start: number; end: number }>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let cursor = from;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.start > cursor) out.push([cursor, span.start]);
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < to) out.push([cursor, to]);
  return out;
}

// ─────────────────────────────────────────────
// Windows and doors
// ─────────────────────────────────────────────

function addWindow(g: THREE.Group, run: Run, kit: Kit, o: LayoutWindow, height: number): void {
  const low = Math.min(o.sill_height * MM, height - 0.2);
  const high = Math.min((o.sill_height + o.height) * MM, height - 0.05);
  const x0 = Math.min(run.x(o.position), run.x(o.position + o.width));
  const across = o.width * MM;
  const cx = x0 + across / 2;
  const frame = kit.paint(FRAME_COLOR, 0.5);
  const bar = 0.045;
  const z = -WALL / 2;
  const cast = (mesh: THREE.Mesh) => { mesh.castShadow = false; return mesh; };
  for (const x of [x0 + bar / 2, x0 + across - bar / 2]) g.add(cast(box(bar, high - low, 0.06, frame, x, low, z)));
  g.add(cast(box(across, bar, 0.06, frame, cx, low, z)));
  g.add(cast(box(across, bar, 0.06, frame, cx, high - bar, z)));
  const lights = across > 1.7 ? 3 : across > 0.8 ? 2 : 1;
  for (let i = 1; i < lights; i++) g.add(cast(box(0.04, high - low, 0.05, frame, x0 + (across * i) / lights, low, z)));
  g.add(cast(box(across - bar, high - low - bar, 0.006, kit.glass(0.2), cx, low + bar / 2, z)));
  g.add(cast(box(across + 0.08, 0.028, WALL / 2 + 0.045, kit.paint(TRIM_COLOR, 0.4), cx, low - 0.02, 0.045 / 2 - WALL / 4)));    // sill board
}

function addDoor(g: THREE.Group, run: Run, kit: Kit, o: LayoutDoor, height: number): void {
  const high = Math.min(DOOR_HEIGHT, height);
  const x0 = Math.min(run.x(o.position), run.x(o.position + o.width));
  const across = o.width * MM;
  const cx = x0 + across / 2;
  const trim = kit.paint(TRIM_COLOR, 0.45);
  const lining = 0.03;
  // the lining of the opening, and the architrave round it on the room side
  for (const x of [x0 + lining / 2, x0 + across - lining / 2]) g.add(box(lining, high, WALL + 0.02, trim, x, 0, -WALL / 2));
  g.add(box(across, lining, WALL + 0.02, trim, cx, high - lining, -WALL / 2));
  for (const x of [x0 - 0.03, x0 + across + 0.03]) g.add(box(0.06, high + 0.06, 0.012, trim, x, 0, 0.006));
  g.add(box(across + 0.12, 0.06, 0.012, trim, cx, high, 0.006));
  if (o.swing === "none") return;

  // the leaf runs along its own +X from the hinge
  const hingeAtStart = o.hinge === "left";
  const hinge = run.x(hingeAtStart ? o.position : o.position + o.width);
  const towards = ALONG_SIGN[run.wall] * (hingeAtStart ? 1 : -1);          // from the hinge to the other jamb
  const lw = across - 2 * lining - 0.006;
  const lh = high - lining - 0.008;
  const leaf = new THREE.Group();
  leaf.add(box(lw, lh, 0.04, kit.wood(FINISH.oak, 0.45), lw / 2, 0, 0));
  const inlay = kit.paint(tone(FINISH.walnut, -0.1), 0.5);
  for (const y of [lh * 0.34, lh * 0.67]) leaf.add(box(lw - 0.12, 0.006, 0.042, inlay, lw / 2, y, 0));
  const steel = kit.metal(FINISH.black, 0.4);
  for (const side of [-1, 1]) {
    leaf.add(disc(0.026, 0.008, steel, lw - 0.07, 1.0, side * 0.024, 20));
    leaf.add(rod([lw - 0.07, 1.0, side * 0.05], [lw - 0.19, 1.0, side * 0.05], 0.008, steel));
    leaf.add(rod([lw - 0.07, 1.0, side * 0.02], [lw - 0.07, 1.0, side * 0.05], 0.008, steel));
  }
  if (o.swing === "inward") {
    leaf.rotation.y = -Math.PI / 2;                    // standing open, at right angles to the wall
    leaf.position.set(hinge + towards * (lining + 0.02), 0, 0);
  } else if (o.swing === "sliding") {
    leaf.rotation.y = towards > 0 ? 0 : Math.PI;       // half slid back along the wall
    leaf.position.set(hinge - towards * across * 0.5, 0, 0.035);
  } else {
    leaf.rotation.y = towards > 0 ? 0 : Math.PI;       // closed, in the opening
    leaf.position.set(hinge + towards * (lining + 0.003), 0, -WALL / 2);
  }
  g.add(leaf);
}

// ─────────────────────────────────────────────
// What hangs on the walls
// ─────────────────────────────────────────────

/** A print in the manner of the ones in every furniture catalogue: a sun over rounded hills. */
function drawPrint(g: CanvasRenderingContext2D, w: number, h: number, rnd: Rnd): void {
  const inks = [FINISH.terracotta, FINISH.sage, FINISH.mustard, "#3f4a56", FINISH.blush, "#d9c7a8"]
    .map((ink) => ({ ink, key: rnd() })).sort((a, b) => a.key - b.key).map((entry) => entry.ink);
  const border = Math.min(w, h) * 0.09;
  g.fillStyle = "#f6f2ea";
  g.fillRect(0, 0, w, h);
  g.save();
  g.beginPath();
  g.rect(border, border, w - 2 * border, h - 2 * border);
  g.clip();
  g.fillStyle = "#efe6d6";
  g.fillRect(0, 0, w, h);
  g.fillStyle = inks[0];
  g.beginPath();
  g.arc(w * (0.3 + rnd() * 0.4), h * (0.3 + rnd() * 0.12), Math.min(w, h) * 0.15, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 3; i++) {
    const r = w * (0.26 + rnd() * 0.14);
    const cx = w * (0.15 + i * 0.35 + (rnd() - 0.5) * 0.15);
    const top = h * (0.5 + i * 0.09 + rnd() * 0.08);
    g.fillStyle = inks[i + 1];
    g.beginPath();
    g.moveTo(cx - r, h);
    g.lineTo(cx - r, top + r);
    g.arc(cx, top + r, r, Math.PI, 0);
    g.lineTo(cx + r, h);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function addPrint(g: THREE.Group, kit: Kit, rnd: Rnd, x: number, y: number, w: number, h: number): void {
  g.add(box(w, h, 0.022, kit.wood(FINISH.oak), x, y, 0.011));
  const picture = kit.picture(256, (256 * h) / w, (c, cw, ch) => drawPrint(c, cw, ch, rnd));
  const sheet = new THREE.Mesh(new THREE.BoxGeometry(w - 0.03, h - 0.03, 0.004),
    new THREE.MeshStandardMaterial({ map: picture, roughness: 0.9 }));
  sheet.position.set(x, y + h / 2, 0.023);
  g.add(sheet);
}

/**
 * Pictures over the sofa and the bed, a round mirror over a sideboard or a
 * chest of drawers, an extractor over the cooker - wherever no window, door or
 * other fitting is already in that place on the wall.
 */
function addHangings(g: THREE.Group, run: Run, kit: Kit, layout: LivingRoomLayoutResult, f: Frame): void {
  const height = f.height * MM;
  const openings = [...(layout.openings?.doors ?? []), ...(layout.openings?.windows ?? [])].filter((o) => o.wall === run.wall);
  const alongWall = (item: LayoutFurnitureItem): [number, number] =>
    run.wall === "north" || run.wall === "south" ? [item.bbox[0], item.bbox[2]] : [item.bbox[1], item.bbox[3]];
  const atWall = (item: LayoutFurnitureItem) => {
    const [x0, y0, x1, y1] = item.bbox;
    return { west: x0 <= 20, east: x1 >= f.width - 20, south: y0 <= 20, north: y1 >= f.length - 20 }[run.wall];
  };
  // fittings already fixed to this wall
  const fixed = layout.furniture.filter((item) => item.mounted === "wall" && atWall(item)).map(alongWall);

  for (const item of layout.furniture) {
    const kind = ({
      sofa: "print", loveseat: "print", bed: "pair", sideboard: "mirror", dresser: "mirror", storage_cabinet: "mirror", stove: "hood",
    } as Record<string, "print" | "pair" | "mirror" | "hood" | undefined>)[item.type];
    if (!kind || item.shape === "l" || !standsOnFloor(item) || OPPOSITE[item.facing] !== run.wall || !atWall(item)) continue;
    const [lo, hi] = alongWall(item);
    const span = (hi - lo) * MM;
    const across = kind === "hood" ? Math.min(span, 0.9) : kind === "mirror" ? 0.66
      : kind === "pair" ? Math.min(span * 0.72, 1.3) : Math.min(span * 0.55, 1.25);
    const middle = (lo + hi) / 2;
    const from = middle - (across * 1000) / 2 - 100;
    const to = middle + (across * 1000) / 2 + 100;
    const clear = (a: number, b: number) => b <= from || a >= to;
    if (across < 0.4 || !openings.every((o) => clear(o.position, o.position + o.width)) || !fixed.every(([a, b]) => clear(a, b))) continue;
    const rnd = seeded(`hanging:${item.id}`);
    const cx = run.x(middle);
    if (kind === "hood") {
      if (height < 2.2) continue;
      const steel = kit.metal(FINISH.steel, 0.3);
      g.add(rbox(across, 0.07, 0.48, 0.006, steel, cx, 1.62, 0.24));
      g.add(box(across - 0.06, 0.004, 0.42, kit.glow("#fff4dc", 0.6), cx, 1.616, 0.24));
      g.add(box(0.3, height - 1.71, 0.26, steel, cx, 1.69, 0.13));
    } else if (kind === "mirror") {
      const r = across / 2;
      const y = item.height * MM + 0.22 + r;
      if (y + r > height - 0.15) continue;
      g.add(disc(r, 0.02, kit.metal(FINISH.brass, 0.3), cx, y, 0.01));
      g.add(disc(r - 0.014, 0.004, kit.mirror(), cx, y, 0.021));
    } else if (kind === "pair") {
      const y = Math.max(1.32, item.height * MM + 0.75);
      const each = (across - 0.12) / 2;
      const tall = Math.min(each * 1.3, height - y - 0.2);
      if (tall < 0.3) continue;
      for (const side of [-1, 1]) addPrint(g, kit, rnd, cx + side * (each / 2 + 0.06), y, each, tall);
    } else {
      const y = item.height * MM + 0.3;
      const tall = Math.min(across * 0.66, height - y - 0.2);
      if (tall < 0.3) continue;
      addPrint(g, kit, rnd, cx, y, across, tall);
    }
  }
}

// ─────────────────────────────────────────────
// The shell
// ─────────────────────────────────────────────

export interface Shell {
  group: THREE.Group;
  walls: WallView[];
}

export function buildShell(layout: LivingRoomLayoutResult, f: Frame, kit: Kit, kind: RoomKind): Shell {
  const group = new THREE.Group();
  group.name = "room";
  const height = f.height * MM;
  const width = f.width * MM;
  const length = f.length * MM;
  // a kitchen is entered through an open doorway, and so is any opening too wide
  // for one door leaf: the lined opening, no leaf in it
  const doors: LayoutDoor[] = (layout.openings?.doors ?? [])
    .map((o) => (kind === "kitchen" || o.width > MAX_LEAF_WIDTH ? { ...o, swing: "none" as const } : o));
  const windows: LayoutWindow[] = layout.openings?.windows ?? [];
  const cutouts = (layout.room.cutouts ?? []) as Cutout[];

  // the floor: a slab under the room and its walls, boards running the long way.
  // A non-rectangular room gets one slab per rectangle of its floor, so nothing
  // is laid in a notch; each runs on under the outer walls it meets.
  const tiled = kind === "bathroom";
  const finish = tiled ? kit.tiles(FLOOR_TILES, 0.38) : kit.boards(BOARDS[kind]);
  const edge = tiled ? kit.paint("#cdc8c0", 0.7) : kit.wood(tone(BOARDS[kind], -0.14), 0.6);
  const wallMm = WALL / MM;
  // a slab between engine x0..x1 and y0..y1 (mm), its top flush with the floor
  const slabPiece = (x0: number, y0: number, x1: number, y1: number, top: THREE.Material, name: string) => {
    const geometry = new THREE.BoxGeometry((x1 - x0) * MM, SLAB, (y1 - y0) * MM);
    // placed before the texture is mapped, so the boards run on across pieces
    geometry.translate(((x0 + x1) / 2 - f.width / 2) * MM, -SLAB / 2, (f.length / 2 - (y0 + y1) / 2) * MM);
    metreUV(geometry, false);
    if (length > width) {
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
    }
    const mesh = new THREE.Mesh(geometry, [edge, edge, top, edge, edge, edge]);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  floorRects(cutouts, f).forEach(({ rect: [x0, y0, x1, y1], edge: at }, index) => {
    slabPiece(
      x0 - (at.west ? wallMm : 0), y0 - (at.south ? wallMm : 0),
      x1 + (at.east ? wallMm : 0), y1 + (at.north ? wallMm : 0),
      finish, index ? `floor-${index}` : "floor",
    );
  });

  const walls: WallView[] = [];
  for (const wall of WALLS) {
    const horizontal = wall === "north" || wall === "south";
    const span = horizontal ? f.width : f.length;
    const run: Run = { wall, x: (position) => ALONG_SIGN[wall] * (position - span / 2) * MM };
    // the north and south walls run on through the corners; the other two butt up to them
    const reach = horizontal ? WALL / MM : 0;
    const point = new THREE.Vector3(
      horizontal ? 0 : (wall === "west" ? -1 : 1) * width / 2, 0, horizontal ? (wall === "north" ? -1 : 1) * length / 2 : 0);
    const place = (part: THREE.Group, name: string) => {
      part.name = `${name}:${wall}`;
      part.position.copy(point);
      part.rotation.y = WALL_YAW[wall];
      return part;
    };
    const full = place(new THREE.Group(), "wall");
    const kerb = place(new THREE.Group(), "kerb");
    const sills = place(new THREE.Group(), "thresholds");
    const add = (to: THREE.Group, mesh: THREE.Mesh | null) => { if (mesh) to.add(mesh); };

    // only openings in the wall line itself; those set back from it are in a notch wall
    const wallDoors = doors.filter((o) => o.wall === wall && (o.inset ?? 0) < 1);
    const wallWindows = windows.filter((o) => o.wall === wall && (o.inset ?? 0) < 1);
    const paint = tiled ? kit.tiles(WALL_TILES, 0.3) : kit.paint(WALL_COLOR, 0.9);
    const trim = kit.paint(TRIM_COLOR, 0.5);
    const openings = [
      ...wallDoors.map((o) => ({ start: o.position, end: o.position + o.width, low: 0, high: Math.min(DOOR_HEIGHT, height) })),
      ...wallWindows.map((o) => ({
        start: o.position, end: o.position + o.width,
        low: Math.min(o.sill_height * MM, height - 0.2), high: Math.min((o.sill_height + o.height) * MM, height - 0.05),
      })),
    ].map((o) => ({ ...o, start: Math.max(0, o.start), end: Math.min(span, o.end) }))
      .filter((o) => o.end > o.start);
    // where a cut-out reaches this wall there is no wall at all, through the corner too
    const notched = cutoutSpans(wall, cutouts, f).map(({ start, end }) => ({
      start: start <= 1 ? -reach : start, end: end >= span - 1 ? span + reach : end,
    }));
    openings.push(...notched.map((o) => ({ ...o, low: 0, high: height })));
    openings.sort((a, b) => a.start - b.start);

    // masonry: whole height between the openings, and the pieces under and over each one
    let cursor = -reach;
    for (const o of openings) {
      const start = Math.max(o.start, cursor);
      add(full, block(run, cursor, start, 0, height, -WALL, 0, paint));
      if (o.end > start) {
        add(full, block(run, start, o.end, 0, o.low, -WALL, 0, paint));
        add(full, block(run, start, o.end, o.high, height, -WALL, 0, paint));
      }
      cursor = Math.max(cursor, o.end);
    }
    add(full, block(run, cursor, span + reach, 0, height, -WALL, 0, paint));

    // skirting, and the kerb that stands in for the wall, both broken at the doorways
    const doorSpans = [...wallDoors.map((o) => ({ start: o.position, end: o.position + o.width })), ...notched];
    for (const [a, b] of between(0, span, doorSpans)) add(full, block(run, a, b, 0, SKIRTING, 0, 0.012, trim));
    const kerbPaint = kit.paint(WALL_COLOR, 0.9);
    for (const [a, b] of between(-reach, span + reach, doorSpans)) add(kerb, block(run, a, b, 0, KERB, -WALL + 0.003, -0.003, kerbPaint));

    for (const o of wallWindows) addWindow(full, run, kit, o, height);
    for (const o of wallDoors) {
      addDoor(full, run, kit, o, height);
      add(sills, block(run, o.position, o.position + o.width, 0, 0.006, -WALL, 0,
        o.is_main ? kit.metal(FINISH.brass, 0.4) : kit.wood(FINISH.walnut, 0.5)));
    }
    addHangings(full, run, kit, layout, f);

    bake(full);
    bake(kerb);
    const normal = new THREE.Vector3(Math.sin(WALL_YAW[wall]), 0, Math.cos(WALL_YAW[wall]));
    walls.push({ wall, full, kerb, point, normal, materials: fading(full), fixtures: [], shown: 1 });
    kerb.visible = false;
    group.add(full, kerb, sills);
  }

  // the walls round each notch: plain masonry on the notch side of the edge,
  // taken away like the others when the camera goes behind them
  const paint = tiled ? kit.tiles(WALL_TILES, 0.3) : kit.paint(WALL_COLOR, 0.9);
  const trim = kit.paint(TRIM_COLOR, 0.5);
  const kerbPaint = kit.paint(WALL_COLOR, 0.9);
  notchWalls(cutouts, f).forEach(({ a, b, as, atEdge }, index) => {
    const horizontal = as === "north" || as === "south";
    const [p0, p1] = horizontal ? [a[0], b[0]] : [a[1], b[1]];
    const at = horizontal ? a[1] : a[0];
    const middle = (p0 + p1) / 2;
    const run: Run = { wall: as, x: (position) => ALONG_SIGN[as] * (position - middle) * MM };
    const point = horizontal
      ? new THREE.Vector3((middle - f.width / 2) * MM, 0, (f.length / 2 - at) * MM)
      : new THREE.Vector3((at - f.width / 2) * MM, 0, (f.length / 2 - middle) * MM);
    const place = (part: THREE.Group, name: string) => {
      part.name = `${name}:notch-${index}`;
      part.position.copy(point);
      part.rotation.y = WALL_YAW[as];
      return part;
    };
    const full = place(new THREE.Group(), "wall");
    const kerb = place(new THREE.Group(), "kerb");
    const sills = place(new THREE.Group(), "thresholds");
    const add = (to: THREE.Group, mesh: THREE.Mesh | null) => { if (mesh) to.add(mesh); };
    // run on into an outer wall's thickness where the notch meets it, so the corner is closed
    const start = p0 - (atEdge[0] ? WALL / MM : 0);
    const end = p1 + (atEdge[1] ? WALL / MM : 0);
    const notch = { a, b, as, atEdge };
    const myDoors = doors.filter((o) => inNotchWall(notch, o, f));
    const myWindows = windows.filter((o) => inNotchWall(notch, o, f));
    const gaps = [
      ...myDoors.map((o) => ({ start: o.position, end: o.position + o.width, low: 0, high: Math.min(DOOR_HEIGHT, height) })),
      ...myWindows.map((o) => ({
        start: o.position, end: o.position + o.width,
        low: Math.min(o.sill_height * MM, height - 0.2), high: Math.min((o.sill_height + o.height) * MM, height - 0.05),
      })),
    ].map((o) => ({ ...o, start: Math.max(p0, o.start), end: Math.min(p1, o.end) }))
      .filter((o) => o.end > o.start).sort((x, y) => x.start - y.start);
    // masonry: whole height between the openings, and the pieces under and over each one
    let cursor = start;
    for (const o of gaps) {
      const from = Math.max(o.start, cursor);
      add(full, block(run, cursor, from, 0, height, -WALL, 0, paint));
      if (o.end > from) {
        add(full, block(run, from, o.end, 0, o.low, -WALL, 0, paint));
        add(full, block(run, from, o.end, o.high, height, -WALL, 0, paint));
      }
      cursor = Math.max(cursor, o.end);
    }
    add(full, block(run, cursor, end, 0, height, -WALL, 0, paint));
    const doorSpans = myDoors.map((o) => ({ start: o.position, end: o.position + o.width }));
    for (const [x, y] of between(p0, p1, doorSpans)) add(full, block(run, x, y, 0, SKIRTING, 0, 0.012, trim));
    for (const o of myWindows) addWindow(full, run, kit, o, height);
    for (const o of myDoors) {
      addDoor(full, run, kit, o, height);
      add(sills, block(run, o.position, o.position + o.width, 0, 0.006, -WALL, 0,
        o.is_main ? kit.metal(FINISH.brass, 0.4) : kit.wood(FINISH.walnut, 0.5)));
    }
    // the slab under it, on the notch side of the edge
    const back = { east: [wallMm, 0], west: [-wallMm, 0], north: [0, wallMm], south: [0, -wallMm] }[as];
    const [ex, ey] = horizontal ? [[start, end], [at, at + back[1]]] : [[at, at + back[0]], [start, end]];
    slabPiece(Math.min(...ex), Math.min(...ey), Math.max(...ex), Math.max(...ey), edge, `floor:notch-${index}`);
    for (const [x, y] of between(start, end, doorSpans)) add(kerb, block(run, x, y, 0, KERB, -WALL + 0.003, -0.003, kerbPaint));
    bake(full);
    bake(kerb);
    const normal = new THREE.Vector3(Math.sin(WALL_YAW[as]), 0, Math.cos(WALL_YAW[as]));
    walls.push({ wall: as, full, kerb, point, normal, materials: fading(full), fixtures: [], shown: 1 });
    kerb.visible = false;
    group.add(full, kerb, sills);
  });
  return { group, walls };
}

function show(wall: WallView): void {
  wall.full.visible = wall.shown > 0;
  wall.kerb.visible = wall.shown < 1;
  for (const { material, opacity } of wall.materials) material.opacity = opacity * wall.shown;
  for (const fixture of wall.fixtures) {
    const shown = fixture.group.userData.pinned ? 1 : wall.shown;
    fixture.group.visible = shown > 0;
    for (const { material, opacity } of fixture.materials) material.opacity = opacity * shown;
  }
}

/**
 * Bring each wall in while the camera is on the room side of it and take it
 * away while the camera is behind it, over `dt` seconds of a short fade (at
 * once when `dt` is 0). Returns whether anything changed, so that it is drawn.
 */
export function updateWalls(walls: WallView[], camera: THREE.Vector3, dt: number): boolean {
  let changed = false;
  for (const wall of walls) {
    const target = (camera.x - wall.point.x) * wall.normal.x + (camera.z - wall.point.z) * wall.normal.z > 0 ? 1 : 0;
    if (wall.shown === target) continue;
    const step = dt > 0 ? dt / FADE : 1;
    wall.shown = THREE.MathUtils.clamp(wall.shown + (target > wall.shown ? step : -step), 0, 1);
    show(wall);
    changed = true;
  }
  return changed;
}

/** Put every wall back, whichever way the camera is looking: the state a model is exported in. */
export function showAllWalls(walls: WallView[]): void {
  for (const wall of walls) {
    wall.shown = 1;
    show(wall);
  }
}

/**
 * Keep one fixture in view even while its wall is taken away - the one that is
 * selected, so it can be seen - and let any other go with its wall again.
 */
export function pinFixture(walls: WallView[], group: THREE.Group | null): void {
  for (const wall of walls) {
    for (const fixture of wall.fixtures) fixture.group.userData.pinned = fixture.group === group;
    show(wall);
  }
}
