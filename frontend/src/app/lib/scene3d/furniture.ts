/**
 * Turns the layout's furniture list into models: which builder makes each
 * type, and where in the room each model stands.
 */

import * as THREE from "three";
import type { Facing, LayoutFurnitureItem, LivingRoomLayoutResult, Wall } from "../livingRoomLayout";
import { furnitureColor } from "../roomPalette3d";
import { basin, drain, grabBar, mirror, shower, showerFloor, tallCabinet, toilet, towelRail, towelRing } from "./bathroom";
import { bed, bedsideTable, desk, deskChair, dresser, dressingTable, stool, wardrobe } from "./bedroom";
import { diningChair, diningTable, sideboard, storageCabinet } from "./dining";
import { counter, drawerUnit, fridge, sink, stove } from "./kitchen";
import { ceilingLight, deskLamp, floorLamp, mirrorLight, pendant, tableLamp } from "./lights";
import { armchair, bookshelf, coffeeTable, cornerSofa, readingChair, rug, sideTable, sofa, television, tvConsole } from "./living";
import { seeded, type Kit } from "./materials";
import {
  MM, SLAB, WALL, bake, box, rbox, softPatch, toX, toZ,
  type Builder, type Frame, type Piece, type RoomKind, type Side,
} from "./parts";

/** Anything of a type no builder knows stands in the room as a plain block. */
const plainBox: Builder = (p) => {
  const g = new THREE.Group();
  g.add(rbox(p.w, Math.max(p.h, 0.05), p.d, 0.012, p.kit.paint(furnitureColor(p.item.type))));
  return g;
};

/** ... and an unknown fitting as a panel on the wall behind it, centred on its fixing height. */
const wallFitting: Builder = (p) => {
  const g = new THREE.Group();
  const high = THREE.MathUtils.clamp(p.h, 0.03, 1.4);
  const deep = THREE.MathUtils.clamp(p.d, 0.02, 0.08);
  const centre = (p.item.mount_height ?? 1200) * MM;
  g.add(box(p.w, high, deep, p.kit.paint(furnitureColor(p.item.type)), 0, Math.max(centre - high / 2, 0), -p.d / 2 + deep / 2));
  return g;
};

const BUILDERS: Record<string, Builder> = {
  sofa, loveseat: sofa, chair: armchair, reading_chair: readingChair,
  coffee_table: coffeeTable, side_table: sideTable, tv_console: tvConsole, tv: television, bookshelf, rug,
  bed, bedside_table: bedsideTable, wardrobe, dresser, dressing_table: dressingTable, stool, desk, desk_chair: deskChair,
  dining_table: diningTable, dining_chair: diningChair, sideboard, storage_cabinet: storageCabinet,
  counter, utensil_drawers: drawerUnit, sink, stove, fridge,
  shower, toilet, washbasin: basin, bathroom_cabinet: tallCabinet, mirror, towel_rail: towelRail,
  towel_ring: towelRing, grab_bar: grabBar, floor_drain: drain,
  lamp: floorLamp, bedside_lamp: tableLamp, desk_lamp: deskLamp, pendant_light: pendant,
  ceiling_light: ceilingLight, mirror_light: mirrorLight,
};

/** Which room this is, told from what stands in it: it decides the floor and the walls. */
export function roomKind(layout: LivingRoomLayoutResult): RoomKind {
  const has = (...types: string[]) => layout.furniture.some((item) => types.includes(item.type));
  if (has("toilet", "shower", "washbasin")) return "bathroom";
  if (has("stove", "sink", "fridge")) return "kitchen";
  if (has("bed")) return "bedroom";
  if (has("sofa", "loveseat", "tv_console")) return "living";
  return has("dining_table") ? "dining" : "living";
}

// ─────────────────────────────────────────────
// Where each piece stands
// ─────────────────────────────────────────────

/** Rotation about the vertical axis that turns a model's front (+Z) to a compass facing. */
const FACING_ANGLE: Record<Facing, number> = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 };
/** The compass direction a model's own +X points in, by the way it faces. */
const RIGHT_OF: Record<Facing, Wall> = { south: "east", east: "north", north: "west", west: "south" };
export const OPPOSITE: Record<Wall, Wall> = { north: "south", south: "north", east: "west", west: "east" };
/** One step towards each compass direction, in model X and Z. */
const STEP: Record<Wall, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
/** Chairs the engines draw pushed in: only the part left showing is in their box. */
const TUCKED = new Set(["dining_chair", "desk_chair", "stool"]);

/** Whether a piece stands on the floor and has some height: the things other things stand on, or cast a shadow. */
export const standsOnFloor = (item: LayoutFurnitureItem) =>
  (!item.mounted || item.mounted === "floor") && item.type !== "rug" && item.height > 0;

/** Pieces that stand on slim legs, with mostly air between them and the floor. */
const ON_LEGS = new Set([
  "dining_table", "coffee_table", "side_table", "desk", "dressing_table", "dining_chair", "desk_chair", "stool", "lamp",
]);

/** How strong a shadow a piece leaves on the floor under it: less on legs, none when it hangs clear on the wall. */
function grounding(item: LayoutFurnitureItem): number {
  if (item.type === "washbasin") return (item.model ?? "").startsWith("vanity") ? 0.45 : 0;
  if (item.type === "bathroom_cabinet") return 0.45;
  return ON_LEGS.has(item.type) ? 0.6 : 1;
}

interface Spot {
  x: number;
  z: number;
  angle: number;
  /** Across the front and front to back. */
  w: number;
  d: number;
  facing: Facing;
}

function spot(item: LayoutFurnitureItem, f: Frame): Spot {
  const [x0, y0, x1, y1] = item.bbox;
  const facing: Facing = item.facing in FACING_ANGLE ? item.facing : "south";
  const northSouth = facing === "north" || facing === "south";
  // The footprint is read off the bounding box: the engines do not agree on
  // whether `width` runs across the front or along the room's x axis.
  const w = (northSouth ? x1 - x0 : y1 - y0) * MM;
  let d = (northSouth ? y1 - y0 : x1 - x0) * MM;
  let x = toX((x0 + x1) / 2, f);
  let z = toZ((y0 + y1) / 2, f);
  const full = item.depth * MM;
  if (TUCKED.has(item.type) && full > d + 0.01 && Math.abs(item.width * MM - w) < 0.02) {
    // the rest of the chair is under the table in front of it
    x += (STEP[facing][0] * (full - d)) / 2;
    z += (STEP[facing][1] * (full - d)) / 2;
    d = full;
  }
  return { x, z, angle: FACING_ANGLE[facing], w, d, facing };
}

/** A point in a spot's own frame, in the room. */
function inRoom(s: Spot, lx: number, lz: number): [number, number] {
  return [s.x + lx * Math.cos(s.angle) + lz * Math.sin(s.angle), s.z - lx * Math.sin(s.angle) + lz * Math.cos(s.angle)];
}

/** The floor-standing piece that the middle of `item` is over. */
function under(item: LayoutFurnitureItem, items: LayoutFurnitureItem[]): LayoutFurnitureItem | undefined {
  const cx = (item.bbox[0] + item.bbox[2]) / 2;
  const cy = (item.bbox[1] + item.bbox[3]) / 2;
  return items.find((other) => other !== item && standsOnFloor(other)
    && cx >= other.bbox[0] - 1 && cx <= other.bbox[2] + 1 && cy >= other.bbox[1] - 1 && cy <= other.bbox[3] + 1);
}

/**
 * Where a piece goes, and what it stands on. Lamps and the mirror light are
 * given as a spot over the furniture they belong to; they are set down on it
 * here: the desk lamp at a back corner, the mirror light on the wall behind.
 */
function settle(item: LayoutFurnitureItem, f: Frame, items: LayoutFurnitureItem[]): { spot: Spot; base: number | null } {
  const own = spot(item, f);
  const host = item.mounted === "table" || item.mounted === "drain" || item.type === "mirror_light" ? under(item, items) : undefined;
  if (!host) return { spot: own, base: null };
  const at = spot(host, f);
  if (item.mounted === "drain") return { spot: own, base: host.type === "shower" ? showerFloor(host) : null };
  if (item.type === "mirror_light") {
    const deep = 0.06;
    const [x, z] = inRoom(at, 0, -at.d / 2 + deep / 2);
    return { spot: { ...at, x, z, w: Math.min(at.w * 0.5, 0.6), d: deep }, base: null };
  }
  const [x, z] = item.type === "desk_lamp"
    ? inRoom(at, -at.w / 2 + 0.17, -at.d / 2 + 0.15)
    : inRoom(at, 0, -Math.min(0.05, at.d / 4));
  return { spot: { ...own, x, z, angle: at.angle, facing: at.facing }, base: host.height * MM };
}

// ─────────────────────────────────────────────
// Building
// ─────────────────────────────────────────────

export interface Furnished {
  /** Every piece of furniture, one group each. */
  group: THREE.Group;
  pieces: Map<string, THREE.Group>;
  /** The pieces that are fixed to a wall, and which wall. */
  fixed: Array<{ group: THREE.Group; wall: Wall }>;
  /**
   * The soft shadow each standing piece leaves on the floor under it, and the
   * room's own on the ground it stands on. Not part of the model.
   */
  shadows: THREE.Group;
}

export function buildFurniture(layout: LivingRoomLayoutResult, f: Frame, kit: Kit, kind: RoomKind): Furnished {
  const group = new THREE.Group();
  group.name = "furniture";
  const shadows = new THREE.Group();
  shadows.name = "contact shadows";
  const pieces = new Map<string, THREE.Group>();
  const fixed: Furnished["fixed"] = [];
  const counts = new Map<string, number>();
  const items = layout.furniture;
  const windows = layout.openings?.windows ?? [];

  const fade = kit.picture(64, 64, (g, s) => {
    const falloff = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    for (const [stop, alpha] of [[0, 1], [0.25, 0.62], [0.5, 0.3], [0.75, 0.09], [1, 0]]) {
      falloff.addColorStop(stop, `rgba(0, 0, 0, ${alpha})`);
    }
    g.fillStyle = falloff;
    g.fillRect(0, 0, s, s);
  });
  const shade = (opacity: number) => new THREE.MeshBasicMaterial({
    map: fade, transparent: true, opacity, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const contact = new Map<number, THREE.MeshBasicMaterial>();
  const shadow = (w: number, d: number, x: number, z: number, angle: number, strength = 1) => {
    if (strength <= 0) return;
    if (!contact.has(strength)) contact.set(strength, shade(0.4 * strength));
    const patch = new THREE.Mesh(softPatch(w, d, 0.13), contact.get(strength)!);
    patch.position.set(x, 0.016, z);            // just over a rug, so it shows on one as on the floor
    patch.rotation.y = angle;
    shadows.add(patch);
  };
  const ground = new THREE.Mesh(softPatch(f.width * MM + 2 * WALL, f.length * MM + 2 * WALL, 0.55), shade(0.34));
  ground.position.y = -SLAB - 0.002;
  shadows.add(ground);

  for (const item of items) {
    const { spot: s, base } = settle(item, f, items);
    const n = counts.get(item.type) ?? 0;
    counts.set(item.type, n + 1);

    // which sides of the footprint are against a wall, and what window is in that wall above it
    const [x0, y0, x1, y1] = item.bbox;
    const near = 20;
    const touching: Record<Wall, boolean> = {
      west: x0 <= near, east: x1 >= f.width - near, south: y0 <= near, north: y1 >= f.length - near,
    };
    const walls: Record<Side, Wall> = {
      front: s.facing, back: OPPOSITE[s.facing], right: RIGHT_OF[s.facing], left: OPPOSITE[RIGHT_OF[s.facing]],
    };
    const piece: Piece = {
      kit, item, w: s.w, d: s.d, h: item.height * MM, ceiling: f.height * MM, kind, n, base,
      rnd: seeded(`${layout.layout?.type ?? ""}:${item.id}`),
      against: {
        front: touching[walls.front], back: touching[walls.back], left: touching[walls.left], right: touching[walls.right],
      },
      sill: (side) => {
        const wall = walls[side];
        if (!touching[wall]) return null;
        const [lo, hi] = wall === "north" || wall === "south" ? [x0, x1] : [y0, y1];
        const sills = windows
          .filter((o) => o.wall === wall && o.position < hi - 1 && o.position + o.width > lo + 1)
          .map((o) => o.sill_height * MM);
        return sills.length ? Math.min(...sills) : null;
      },
      origin: { x: s.x * Math.cos(s.angle) - s.z * Math.sin(s.angle), z: s.x * Math.sin(s.angle) + s.z * Math.cos(s.angle) },
      carries: standsOnFloor(item) && items.some((other) => other.mounted === "table" && under(other, items) === item),
    };

    let model: THREE.Group;
    if (item.shape === "l" && item.parts) {
      model = bake(cornerSofa(piece, (x) => toX(x, f), (y) => toZ(y, f)));
      for (const [px0, py0, px1, py1] of item.parts) {
        shadow((px1 - px0) * MM, (py1 - py0) * MM, toX((px0 + px1) / 2, f), toZ((py0 + py1) / 2, f), 0);
      }
    } else {
      const builder = BUILDERS[item.type] ?? (item.mounted === "wall" ? wallFitting : plainBox);
      model = bake(builder(piece));
      model.position.set(s.x, 0, s.z);
      model.rotation.y = s.angle;
      if (standsOnFloor(item)) shadow(s.w, s.d, s.x, s.z, s.angle, grounding(item));
      if (item.mounted === "wall") {
        // fixed to the wall its back is on, if its back does reach that wall
        const [bx, bz] = STEP[walls.back];
        const gap = bx !== 0 ? (s.x + (bx * s.d) / 2) * bx - (f.width * MM) / 2 : (s.z + (bz * s.d) / 2) * bz - (f.length * MM) / 2;
        if (Math.abs(gap) < 0.03) fixed.push({ group: model, wall: walls.back });
      }
    }
    model.name = item.id;
    model.userData.itemId = item.id;
    pieces.set(item.id, model);
    group.add(model);
  }
  return { group, pieces, fixed, shadows };
}
