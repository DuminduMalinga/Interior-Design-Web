/** Kitchen units: base cabinets under a stone worktop, the sink, the cooker and the refrigerator. */

import * as THREE from "three";
import { FINISH } from "../roomPalette3d";
import { tone } from "./materials";
import {
  arch, barHandle, box, cyl, disc, metreUV, panels, rbox, rectangle, rod, roundedHole, sheet,
  type Builder, type Piece, type Side,
} from "./parts";
import { bowl, plant } from "./props";

const PLINTH = 0.1;
/** Thickness of the worktop. */
const TOP = 0.04;
/** How far the fronts stand in front of the carcass. */
const PROUD = 0.02;
/** Height of the tiled wall above the worktop. */
const SPLASH = 0.5;
const SPLASH_TILES = {
  cols: 4, rows: 4, metres: [0.4, 0.4] as [number, number], base: "#f4f2ec", grout: "#c9c6bf", vary: 0.03, joint: 0.02,
};

/** The tiled wall behind a unit, stopping under a window's sill where there is one. */
function splashback(p: Piece, g: THREE.Group, h: number): void {
  const tiles = p.kit.tiles(SPLASH_TILES, 0.2);
  const t = 0.012;
  for (const side of ["back", "left", "right"] as Side[]) {
    if (!p.against[side]) continue;
    const high = Math.min(SPLASH, (p.sill(side) ?? Infinity) - h);
    if (high < 0.04) continue;
    const behind = side === "back";
    const geometry = new THREE.BoxGeometry(behind ? p.w : t, high, behind ? t : p.d);
    geometry.translate(0, high / 2, 0);
    // tiles are laid out from the room, not from each unit, so they run on from one unit to the next
    const strip = new THREE.Mesh(metreUV(geometry, false, [p.origin.x, p.origin.z]), tiles);
    strip.position.set(behind ? 0 : (side === "left" ? -1 : 1) * (p.w / 2 - t / 2), h, behind ? -p.d / 2 + t / 2 : 0);
    strip.receiveShadow = true;
    g.add(strip);
  }
}

interface Unit {
  /** Height of the worktop. */
  h: number;
  /** The plane the fronts are fixed to, and the height they run between. */
  face: number;
  y0: number;
  y1: number;
}

/**
 * Plinth, carcass, worktop and splashback of a base unit. `hollow` leaves the
 * carcass open that far down under the worktop, for a sink to hang in.
 */
function baseUnit(p: Piece, g: THREE.Group, worktop?: THREE.Mesh, hollow = 0): Unit {
  const { kit, w, d } = p;
  const h = Math.max(p.h, 0.6);
  const carcass = kit.wood(FINISH.oakDark);
  const shell = d - PROUD;
  const full = h - TOP - hollow;
  g.add(box(w, PLINTH, d - 0.07, kit.paint(FINISH.charcoal, 0.7), 0, 0, -0.035));
  g.add(box(w, full - PLINTH, shell, carcass, 0, PLINTH, -PROUD / 2));
  if (hollow > 0) {
    const t = 0.018;
    for (const side of [-1, 1]) g.add(box(t, hollow, shell, carcass, side * (w / 2 - t / 2), full, -PROUD / 2));
    g.add(box(w, hollow, t, carcass, 0, full, -d / 2 + t / 2));
    g.add(box(w, hollow, t, carcass, 0, full, d / 2 - PROUD - t / 2));
  }
  g.add(worktop ?? box(w, TOP, d + 0.02, kit.stone(FINISH.stone), 0, h - TOP, 0.01));
  splashback(p, g, h);
  return { h, face: d / 2 - PROUD, y0: PLINTH + 0.004, y1: h - TOP - 0.004 };
}

/** Doors across a unit, one per 600 mm, under a row of drawers when `drawers` is set. */
function fronts(p: Piece, g: THREE.Group, u: Unit, drawers: boolean): void {
  const oak = p.kit.wood(FINISH.oak);
  const steel = p.kit.metal(FINISH.steel, 0.3);
  const modules = Math.max(1, Math.round(p.w / 0.6));
  const x0 = -p.w / 2 + 0.002;
  const width = p.w - 0.004;
  const t = PROUD - 0.002;
  const out = u.face + t;
  let top = u.y1;
  if (drawers) {
    const high = 0.15;
    for (const f of panels(g, oak, x0, top - high, width, high, u.face, modules, 1, t)) {
      barHandle(g, steel, Math.min(0.16, f.w * 0.5), f.x, f.y + f.h / 2, out, false);
    }
    top -= high;
  }
  panels(g, oak, x0, u.y0, width, top - u.y0, u.face, modules, 1, t).forEach((f, i) => {
    const side = i % 2 === 0 && i < modules - 1 ? 1 : -1;
    if (f.w > 0.12) barHandle(g, steel, 0.14, f.x + side * (f.w / 2 - 0.04), f.y + f.h - 0.1, out, true);
  });
}

/** A stretch of worktop over cupboards. The piece in a corner has no front to open. */
export const counter: Builder = (p) => {
  const { kit, w, d, item } = p;
  const g = new THREE.Group();
  if (item.role === "corner") {
    baseUnit(p, g, box(w, TOP, d, kit.stone(FINISH.stone), 0, Math.max(p.h, 0.6) - TOP, 0));
    return g;
  }
  const u = baseUnit(p, g);
  fronts(p, g, u, true);
  if (w < 0.5 || p.carries) return g;
  if (item.role === "prep counter") {
    g.add(rbox(0.34, 0.02, 0.24, 0.006, kit.wood(FINISH.walnut), 0, u.h, 0.04));          // chopping board
    g.add(rbox(0.09, 0.2, 0.07, 0.01, kit.wood(FINISH.oakDark), w / 2 - 0.12, u.h, -d / 2 + 0.14));   // knife block
  } else if (item.role === "serving counter") {
    g.add(bowl(p, 0, u.h, 0.02, 0.14, true));
  } else {
    g.add(plant(p, 0, u.h, -d / 2 + 0.16, 0.9));
  }
  return g;
};

export const drawerUnit: Builder = (p) => {
  const g = new THREE.Group();
  const u = baseUnit(p, g);
  const steel = p.kit.metal(FINISH.steel, 0.3);
  const t = PROUD - 0.002;
  for (const f of panels(g, p.kit.wood(FINISH.oak), -p.w / 2 + 0.002, u.y0, p.w - 0.004, u.y1 - u.y0, u.face, 1, 4, t)) {
    barHandle(g, steel, Math.min(0.16, f.w * 0.5), f.x, f.y + f.h - 0.045, u.face + t, false);
  }
  return g;
};

export const sink: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.6);
  const steel = kit.metal(FINISH.steel, 0.28);
  const chrome = kit.metal(FINISH.chrome, 0.15);
  const deep = 0.17;
  const bd = Math.min(0.4, d - 0.2);                         // bowl, front to back
  const bz = 0.03;
  // two bowls in a wide unit, a bowl and a drainer in a middling one, one bowl in a narrow one
  const twin = w >= 1.1;
  const drainer = !twin && w >= 0.85;
  const bowls = twin ? [{ x: -0.24, w: 0.42 }, { x: 0.24, w: 0.42 }]
    : drainer ? [{ x: -w / 2 + 0.3, w: 0.44 }] : [{ x: 0, w: Math.min(0.46, w - 0.14) }];

  const outline = rectangle(w, d + 0.02, 0, 0.01);
  for (const b of bowls) outline.holes.push(roundedHole(b.w, bd, b.x, bz, 0.04));
  const u = baseUnit(p, g, sheet(outline, TOP, kit.stone(FINISH.stone), h - TOP), deep + 0.01);
  fronts(p, g, u, false);

  for (const b of bowls) {
    const floor = h - deep;
    g.add(box(b.w, 0.004, bd, steel, b.x, floor, bz));
    for (const side of [-1, 1]) {
      g.add(box(0.004, deep - 0.002, bd, steel, b.x + side * (b.w / 2 - 0.002), floor, bz));
      g.add(box(b.w, deep - 0.002, 0.004, steel, b.x, floor, bz + side * (bd / 2 - 0.002)));
    }
    g.add(cyl(0.022, 0.003, kit.metal("#8d9196", 0.3), b.x, floor + 0.004, bz));
    const rim = rectangle(b.w + 0.03, bd + 0.03, b.x, bz);
    rim.holes.push(roundedHole(b.w - 0.004, bd - 0.004, b.x, bz, 0.04));
    g.add(sheet(rim, 0.003, steel, h));
  }
  if (drainer) {
    const from = bowls[0].x + bowls[0].w / 2 + 0.05;
    const span = w / 2 - 0.05 - from;
    g.add(box(span, 0.003, bd, steel, from + span / 2, h, bz));
    for (let x = from + 0.03; x < from + span - 0.02; x += 0.035) g.add(box(0.01, 0.005, bd - 0.07, steel, x, h + 0.003, bz));
  }

  // a swan-neck tap behind the bowls
  const tx = twin ? 0 : bowls[0].x;
  const tz = bz - bd / 2 - 0.055;
  g.add(cyl(0.024, 0.035, chrome, tx, h, tz));
  g.add(cyl(0.012, 0.24, chrome, tx, h + 0.035, tz));
  g.add(arch(0.075, 0.012, chrome, tx, h + 0.275, tz + 0.075));
  g.add(cyl(0.012, 0.04, chrome, tx, h + 0.235, tz + 0.15));
  g.add(rod([tx + 0.024, h + 0.02, tz], [tx + 0.07, h + 0.045, tz], 0.006, chrome));
  g.add(cyl(0.022, 0.09, kit.ceramic(FINISH.sage), tx + 0.14, h, tz));                 // soap
  g.add(cyl(0.006, 0.03, chrome, tx + 0.14, h + 0.09, tz));
  return g;
};

export const stove: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.6);
  const steel = kit.metal(FINISH.steel, 0.3);
  const black = kit.paint("#16171a", 0.35);
  const iron = kit.paint("#232427", 0.6);
  const face = d / 2 - PROUD;
  const t = PROUD - 0.002;
  const out = face + t;

  g.add(box(w, PLINTH, d - 0.07, kit.paint(FINISH.charcoal, 0.7), 0, 0, -0.035));
  g.add(box(w, h - PLINTH - 0.012, d - PROUD, steel, 0, PLINTH, -PROUD / 2));
  g.add(rbox(w, 0.012, d + 0.02, 0.004, steel, 0, h - 0.012, 0.01));
  splashback(p, g, h);

  // the front: a drawer, the oven door with its window, and the controls above
  const top = h - 0.016;
  const controls = 0.1;
  const drawer = 0.11;
  const y0 = PLINTH + drawer + 0.008;
  const y1 = top - controls - 0.006;
  g.add(box(w - 0.004, drawer, t, steel, 0, PLINTH + 0.004, face + t / 2));
  g.add(box(w - 0.004, y1 - y0, t, steel, 0, y0, face + t / 2));
  g.add(box(w - 0.12, y1 - y0 - 0.15, 0.003, new THREE.MeshStandardMaterial({ color: "#0c0d10", roughness: 0.08, metalness: 0.4 }),
    0, y0 + 0.05, out));
  barHandle(g, steel, w - 0.1, 0, y1 - 0.045, out, false);
  g.add(box(w - 0.004, controls, t, steel, 0, top - controls, face + t / 2));
  const knobs = w >= 0.85 ? 6 : 5;
  for (let i = 0; i < knobs; i++) {
    g.add(disc(0.017, 0.022, black, -w / 2 + (w * (i + 0.5)) / knobs, top - controls / 2, out + 0.011, 20));
  }

  // the hob
  g.add(rbox(w - 0.08, 0.006, d - 0.12, 0.003, black, 0, h, 0));
  const dx = Math.min(0.26, w * 0.22);
  const rings: Array<[number, number, number]> = [[-dx, -0.12, 1], [dx, -0.12, 0.85], [-dx, 0.12, 0.85], [dx, 0.12, 1]];
  if (w >= 0.85) rings.push([0, 0, 1.15]);
  for (const [x, z, size] of rings) {
    g.add(cyl(0.06 * size, 0.006, steel, x, h + 0.006, z));
    g.add(cyl(0.03 * size, 0.014, iron, x, h + 0.008, z));
    g.add(box(0.17 * size, 0.01, 0.012, iron, x, h + 0.022, z));
    g.add(box(0.012, 0.01, 0.17 * size, iron, x, h + 0.022, z));
  }
  return g;
};

export const fridge: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 1.0);
  const steel = kit.metal(FINISH.steel, 0.32);
  const bar = kit.metal("#9a9da2", 0.25);
  const door = 0.045;
  const face = d / 2 - door;
  g.add(box(w - 0.02, 0.03, d - 0.1, kit.paint(FINISH.black, 0.7), 0, 0, -0.03));
  g.add(rbox(w, h - 0.03, d - door - 0.004, 0.008, kit.metal(tone(FINISH.steel, -0.25), 0.45), 0, 0.03, -(door + 0.004) / 2));
  const leaf = (x: number, y0: number, y1: number, across: number) =>
    g.add(rbox(across - 0.006, y1 - y0 - 0.006, door, 0.012, steel, x, y0 + 0.003, face + door / 2));

  if (w >= 0.85) {
    // two doors over a freezer drawer, a dispenser in one of them
    const split = 0.03 + (h - 0.03) * 0.36;
    for (const side of [-1, 1]) {
      leaf((side * w) / 4, split, h, w / 2);
      barHandle(g, bar, Math.min(0.7, (h - split) * 0.6), side * 0.045, split + (h - split) * 0.45, d / 2, true);
    }
    leaf(0, 0.03, split, w);
    barHandle(g, bar, w * 0.6, 0, split - 0.09, d / 2, false);
    g.add(rbox(0.16, 0.26, 0.004, 0.002, kit.paint("#1b1d21", 0.3), -w / 4 - 0.04, split + (h - split) * 0.4, d / 2 + 0.001));
  } else {
    // a freezer door over the main one
    const split = 0.03 + (h - 0.03) * 0.68;
    leaf(0, 0.03, split, w);
    leaf(0, split, h, w);
    barHandle(g, bar, 0.5, -w / 2 + 0.06, split - 0.34, d / 2, true);
    barHandle(g, bar, 0.24, -w / 2 + 0.06, split + 0.2, d / 2, true);
  }
  return g;
};
