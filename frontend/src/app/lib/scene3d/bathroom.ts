/** Bathroom fixtures and fittings: shower, toilet, basin, cabinet, mirror, towels, grab bars and the drain. */

import * as THREE from "three";
import type { LayoutFurnitureItem } from "../livingRoomLayout";
import { FINISH } from "../roomPalette3d";
import { MM, arch, barHandle, box, cyl, disc, lathe, panels, rbox, ring, rod, type Builder, type Piece } from "./parts";
import { plant } from "./props";

const TOWELS = [FINISH.sage, FINISH.terracotta, "#e9e4da"];

const isLevel = (item: LayoutFurnitureItem) => (item.model ?? "").startsWith("level");

/** Height of the floor one stands on inside a shower: a tray, or tiles level with the room's. */
export const showerFloor = (item: LayoutFurnitureItem) => (isLevel(item) ? 0.004 : 0.05);

/** A mixer tap standing on height `y`, its spout towards +Z. */
function mixer(p: Piece, g: THREE.Group, x: number, y: number, z: number, high = 0.16): void {
  const chrome = p.kit.metal(FINISH.chrome, 0.15);
  g.add(cyl(0.02, 0.02, chrome, x, y, z));
  g.add(cyl(0.013, high, chrome, x, y + 0.02, z));
  g.add(rod([x, y + high, z], [x, y + high - 0.012, z + 0.11], 0.011, chrome));
  g.add(rod([x, y + high + 0.02, z], [x, y + high + 0.05, z - 0.03], 0.007, chrome));       // lever
}

/**
 * A shower enclosure: a tray or a level floor, glass on the sides that are not
 * walls, and a rain head with its valve on the wall behind. One steps in at
 * the front, which is left partly open.
 */
export const shower: Builder = (p) => {
  const { kit, w, d, item } = p;
  const g = new THREE.Group();
  const high = Math.min(Math.max(p.h, 1.9), p.ceiling - 0.2);
  const glass = kit.glass(0.22, "#cfe6ee");
  const chrome = kit.metal(FINISH.chrome, 0.15);
  const floor = showerFloor(item);

  if (isLevel(item)) {
    g.add(box(w, floor, d, kit.tiles({ cols: 6, rows: 6, metres: [0.6, 0.6], base: "#c9cdd0", grout: "#a9adb0", joint: 0.02 }, 0.4)));
  } else {
    g.add(rbox(w, floor, d, 0.012, kit.ceramic("#f6f6f3")));
  }

  const pane = 0.008;
  const screen = (across: number, x: number, z: number, turned: boolean) => {
    const leaf = box(turned ? pane : across, high, turned ? across : pane, glass, x, floor, z);
    leaf.castShadow = false;
    g.add(leaf);
    g.add(box(turned ? 0.014 : across, 0.014, turned ? across : 0.014, chrome, x, floor + high, z));     // top rail
  };
  // a fixed screen on each side that is not a wall, and across part of the front
  if (!p.against.left) screen(d, -w / 2 + pane / 2, 0, true);
  if (!p.against.right) screen(d, w / 2 - pane / 2, 0, true);
  if (!p.against.front) {
    // the front screen joins the one at the side; the way in is left open beside the wall
    const fixed = Math.max(w * 0.5, w - 0.7);
    const open = p.against.right && !p.against.left ? 1 : -1;
    const x = (-open * (w - fixed)) / 2;
    screen(fixed, x, d / 2 - pane / 2, false);
    g.add(box(0.014, high, 0.014, chrome, x + (open * fixed) / 2, floor, d / 2 - pane / 2));
  }

  // fittings on a wall the shower stands against
  const wall = p.against.back ? "back" : p.against.left ? "left" : p.against.right ? "right" : null;
  if (wall) {
    const fit = new THREE.Group();
    const reach = 0.32;
    fit.add(disc(0.045, 0.012, chrome, 0, 1.1, 0.006));                                    // valve
    fit.add(rod([0, 1.1, 0.012], [0.035, 1.12, 0.05], 0.008, chrome));
    fit.add(rod([0, 2.0, 0], [0, 2.02, reach], 0.011, chrome));                            // arm
    fit.add(cyl(0.11, 0.012, chrome, 0, 1.985, reach));                                    // rain head
    fit.add(cyl(0.012, 0.03, chrome, 0, 1.997, reach));
    fit.add(rod([0.14, 0.95, 0.03], [0.14, 1.55, 0.03], 0.009, chrome));                   // rail with a hand shower
    fit.add(rod([0.14, 1.42, 0.03], [0.14, 1.5, 0.11], 0.013, chrome));
    if (wall === "back") fit.position.set(0, 0, -d / 2);
    else {
      fit.position.set((wall === "left" ? -1 : 1) * (w / 2), 0, 0);
      fit.rotation.y = wall === "left" ? Math.PI / 2 : -Math.PI / 2;
    }
    g.add(fit);
  }
  return g;
};

export const toilet: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.7);
  const china = kit.ceramic(FINISH.ceramic);
  const rim = Math.min(0.43, h * 0.52);                     // top of the pan
  const wall = -d / 2;
  // the cistern against the wall
  const tank = Math.min(w * 0.95, 0.4);
  g.add(rbox(tank, h - rim - 0.02, 0.17, 0.035, china, 0, rim + 0.02, wall + 0.085));
  g.add(rbox(tank + 0.012, 0.03, 0.182, 0.012, china, 0, h - 0.03, wall + 0.085));
  g.add(cyl(0.022, 0.006, kit.metal(FINISH.chrome, 0.15), 0, h, wall + 0.085));
  // the pan: a pedestal carrying an oval bowl
  const length = d - 0.17;
  const cz = wall + 0.17 + length / 2 - 0.02;
  const stretch = Math.max(length / (w * 0.92), 1);
  g.add(rbox(w * 0.56, rim - 0.1, length * 0.72, 0.08, china, 0, 0, cz - length * 0.08));
  const pan = lathe([[0.001, 0], [w * 0.28, 0], [w * 0.4, 0.05], [w * 0.46, 0.12], [w * 0.4, 0.12], [w * 0.3, 0.05], [0.001, 0.03]],
    china, 0, rim - 0.12, cz, 36);
  pan.scale.z = stretch;
  g.add(pan);
  const seat = cyl(w * 0.46, 0.03, kit.paint("#fdfdfb", 0.35), 0, rim, cz, w * 0.47, 36);
  seat.scale.z = stretch;
  g.add(seat);
  return g;
};

/**
 * A washbasin: a vanity cupboard with a bowl standing on it, or, for the
 * wall-hung models, a basin on brackets with the floor under it left clear.
 */
export const basin: Builder = (p) => {
  const { kit, w, d, item } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.7);
  const china = kit.ceramic(FINISH.ceramic);
  const chrome = kit.metal(FINISH.chrome, 0.15);
  const wall = -d / 2;

  if (!(item.model ?? "").startsWith("vanity")) {
    // an oval bowl running back to a ledge at the wall that carries the tap
    const deep = 0.16;
    const across = w / 2;
    const out = (d - 0.06) / 2;
    g.add(rbox(w * 0.86, deep, 0.11, 0.03, china, 0, h - deep, wall + 0.055));
    const oval = lathe([[0.001, 0], [0.5, 0], [0.9, 0.06], [1, deep], [0.94, deep], [0.82, 0.07], [0.45, 0.02], [0.001, 0.02]],
      china, 0, h - deep, wall + 0.06 + out, 36);
    oval.scale.set(across, 1, out);
    g.add(oval);
    mixer(p, g, 0, h, wall + 0.05, 0.13);
    g.add(cyl(0.017, 0.2, chrome, 0, h - deep - 0.2, wall + 0.1));                       // waste trap
    g.add(rod([0, h - deep - 0.2, wall + 0.1], [0, h - deep - 0.2, wall], 0.015, chrome));
    return g;
  }

  // a cupboard hung on the wall, clear of the floor
  const body = 0.5;
  const top = h - 0.1;                                      // the counter the bowl stands on
  const oak = kit.wood(FINISH.oak);
  g.add(box(w, body, d - 0.02, kit.wood(FINISH.oakDark), 0, top - 0.03 - body, -0.01));
  g.add(rbox(w + 0.01, 0.03, d + 0.01, 0.008, kit.stone("#ecebe6"), 0, top - 0.03, 0.005));
  const steel = kit.metal(FINISH.black, 0.45);
  for (const f of panels(g, oak, -w / 2 + 0.003, top - 0.03 - body + 0.003, w - 0.006, body - 0.006, d / 2 - 0.02, 1, 2, 0.018)) {
    barHandle(g, steel, Math.min(0.2, f.w * 0.4), f.x, f.y + f.h - 0.04, d / 2 - 0.002, false);
  }
  const r = Math.min(0.18, d / 2 - 0.08, w / 2 - 0.06);
  const x = w > 0.8 ? -w * 0.14 : 0;
  g.add(lathe([[0.001, 0], [r * 0.5, 0], [r * 0.9, 0.06], [r, 0.12], [r - 0.012, 0.12], [r * 0.82, 0.06], [r * 0.4, 0.014], [0.001, 0.014]],
    china, x, top, 0.04, 36));
  mixer(p, g, x, top, wall + 0.06, 0.22);
  if (w > 0.8) {
    g.add(plant(p, w * 0.32, top, -0.02, 0.75));
    g.add(cyl(0.022, 0.1, kit.ceramic(FINISH.sage), w * 0.14, top, wall + 0.09));
    g.add(cyl(0.006, 0.03, chrome, w * 0.14, top + 0.1, wall + 0.09));
  }
  return g;
};

/** A tall cupboard, hung clear of the floor like the vanity. */
export const tallCabinet: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.8);
  const clear = 0.2;
  g.add(box(w, h - clear, d - 0.02, kit.wood(FINISH.oakDark), 0, clear, -0.01));
  const steel = kit.metal(FINISH.black, 0.45);
  panels(g, kit.wood(FINISH.oak), -w / 2 + 0.003, clear + 0.003, w - 0.006, h - clear - 0.006, d / 2 - 0.02, 1, 2, 0.018)
    .forEach((f, i) => barHandle(g, steel, 0.2, f.x + f.w / 2 - 0.04, i === 0 ? f.y + f.h - 0.16 : f.y + 0.16, d / 2 - 0.002, true));
  return g;
};

/** A mirror on the wall behind it, lit from behind; `mount_height` is its bottom edge. */
export const mirror: Builder = (p) => {
  const { kit, w, d, item } = p;
  const g = new THREE.Group();
  const high = Math.max(p.h, 0.3);
  const y0 = (item.mount_height ?? 1100) * MM;
  const wall = -d / 2;
  const halo = box(w + 0.03, high + 0.03, 0.006, kit.glow("#fff6e6", 0.9), 0, y0 - 0.015, wall + 0.006);
  halo.castShadow = false;
  g.add(halo);
  g.add(rbox(w, high, 0.03, 0.006, kit.paint(FINISH.black, 0.5), 0, y0, wall + 0.025));
  g.add(box(w - 0.016, high - 0.016, 0.002, kit.mirror(), 0, y0 + 0.008, wall + 0.041));
  return g;
};

/** A bar on two brackets with a towel folded over it; `mount_height` is the height of the bar. */
export const towelRail: Builder = (p) => {
  const { kit, w, d, item } = p;
  const g = new THREE.Group();
  const y = (item.mount_height ?? 1100) * MM;
  const wall = -d / 2;
  const out = 0.07;
  const chrome = kit.metal(FINISH.chrome, 0.15);
  g.add(rod([-w / 2, y, wall + out], [w / 2, y, wall + out], 0.009, chrome));
  for (const side of [-1, 1]) {
    g.add(rod([side * (w / 2 - 0.03), y, wall], [side * (w / 2 - 0.03), y, wall + out], 0.008, chrome));
    g.add(disc(0.02, 0.006, chrome, side * (w / 2 - 0.03), y, wall + 0.003, 16));
  }
  const towel = kit.fabric(TOWELS[p.n % TOWELS.length]);
  const across = w * 0.62;
  g.add(rbox(across, 0.46, 0.022, 0.01, towel, 0, y - 0.45, wall + out + 0.013));
  g.add(rbox(across, 0.26, 0.022, 0.01, towel, 0, y - 0.25, wall + out - 0.013));
  g.add(rbox(across, 0.024, 0.05, 0.011, towel, 0, y - 0.006, wall + out));
  return g;
};

/** A ring with a hand towel through it. */
export const towelRing: Builder = (p) => {
  const { kit, d, item } = p;
  const g = new THREE.Group();
  const y = (item.mount_height ?? 1100) * MM;
  const wall = -d / 2;
  const chrome = kit.metal(FINISH.chrome, 0.15);
  g.add(disc(0.022, 0.006, chrome, 0, y + 0.09, wall + 0.003, 16));
  g.add(rod([0, y + 0.09, wall], [0, y + 0.09, wall + 0.045], 0.008, chrome));
  g.add(ring(0.085, 0.007, chrome, 0, y, wall + 0.045, true));
  const towel = kit.fabric(TOWELS[(p.n + 1) % TOWELS.length]);
  g.add(rbox(0.15, 0.34, 0.02, 0.009, towel, 0, y - 0.42, wall + 0.057));
  g.add(rbox(0.15, 0.2, 0.02, 0.009, towel, 0, y - 0.28, wall + 0.033));
  return g;
};

/**
 * A grab bar: along the wall behind it, or - when it is deeper than it is
 * wide - a rail that folds down from the wall beside the toilet.
 */
export const grabBar: Builder = (p) => {
  const { kit, w, d, item } = p;
  const g = new THREE.Group();
  const y = (item.mount_height ?? 700) * MM;
  const wall = -d / 2;
  const steel = kit.metal(FINISH.steel, 0.25);
  if (d > w * 1.5) {
    const end = d / 2 - 0.02;
    g.add(rbox(0.1, 0.24, 0.012, 0.004, steel, 0, y - 0.19, wall + 0.006));
    for (const drop of [0, -0.16]) g.add(rod([0, y + drop, wall], [0, y + drop, end], 0.015, steel));
    const loop = arch(0.08, 0.015, steel, 0, y - 0.08, end);
    loop.rotation.x = Math.PI / 2;                           // turned to close the two rails at the front
    g.add(loop);
    return g;
  }
  const out = Math.max(Math.min(d, 0.1), 0.05);
  g.add(rod([-w / 2, y, wall + out], [w / 2, y, wall + out], 0.016, steel));
  for (const side of [-1, 1]) {
    g.add(rod([side * (w / 2 - 0.02), y, wall], [side * (w / 2 - 0.02), y, wall + out], 0.014, steel));
    g.add(disc(0.035, 0.006, steel, side * (w / 2 - 0.02), y, wall + 0.003, 20));
  }
  return g;
};

/** A square grating set in the floor. */
export const drain: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const size = Math.max(Math.min(w, d), 0.1);
  const y = (p.base ?? 0) + 0.001;                           // in the floor of the shower it serves, or the room's
  const plate = rbox(size, 0.004, size, 0.002, kit.metal(FINISH.steel, 0.3), 0, y);
  plate.castShadow = false;
  g.add(plate);
  const slot = kit.paint("#2a2c30", 0.6);
  for (let i = -2; i <= 2; i++) {
    const bar = box(size * 0.7, 0.001, size * 0.06, slot, 0, y + 0.004, i * size * 0.15);
    bar.castShadow = false;
    g.add(bar);
  }
  return g;
};
