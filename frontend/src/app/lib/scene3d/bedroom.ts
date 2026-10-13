/** Bedroom furniture: the bed and what stands beside it, the wardrobe, the drawers, the dressing table and the desk. */

import * as THREE from "three";
import { FINISH } from "../roomPalette3d";
import { tone } from "./materials";
import { ball, barHandle, box, cyl, disc, lathe, legs, panels, rbox, ring, rod, type Builder } from "./parts";
import { books, laptop, mug, vase } from "./props";

const THROWS = [FINISH.sage, FINISH.terracotta, FINISH.mustard, FINISH.teal];

export const bed: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const top = THREE.MathUtils.clamp(p.h, 0.45, 0.65);      // the engine's bed height is the top of the mattress
  const board = 0.1;                                        // what the headboard takes up at the wall
  const head = -d / 2 + board;                              // where the mattress starts
  const length = d - board;
  const baseTop = top - 0.25;
  const cloth = kit.fabric(FINISH.greige);
  const sheets = kit.fabric("#f6f3ec");
  const duvet = kit.fabric(FINISH.linen);
  const accent = kit.fabric(THROWS[p.n % THROWS.length]);

  legs(g, w, length, 0.1, kit.wood(FINISH.walnut), { r: 0.03, inset: 0.08, taper: 0.8, z: board / 2 });
  g.add(rbox(w + 0.04, baseTop - 0.1, length, 0.025, kit.wood(FINISH.oak), 0, 0.1, board / 2));
  g.add(rbox(w - 0.04, 0.25, length - 0.06, 0.07, sheets, 0, baseTop, board / 2));

  // headboard: a padded board in upright channels
  const boardH = 1.1;
  g.add(rbox(w + 0.08, boardH, board * 0.5, 0.03, cloth, 0, 0, -d / 2 + board * 0.25));
  const channels = Math.max(3, Math.round(w / 0.24));
  const cw = (w + 0.06) / channels;
  for (let i = 0; i < channels; i++) {
    g.add(rbox(cw - 0.006, boardH - baseTop - 0.02, board * 0.6, 0.028, cloth,
      -(w + 0.06) / 2 + cw * (i + 0.5), baseTop + 0.02, -d / 2 + board * 0.7));
  }

  // pillows against the headboard, a cushion in front of each
  const sleepers = w > 1.3 ? 2 : 1;
  const pw = sleepers === 2 ? (w - 0.14) / 2 : Math.min(w - 0.16, 0.72);
  for (let i = 0; i < sleepers; i++) {
    const x = sleepers === 2 ? (i === 0 ? -1 : 1) * (pw / 2 + 0.02) : 0;
    const pillow = rbox(pw, 0.4, 0.15, 0.065, sheets, x, top - 0.02, head + 0.11);
    pillow.rotation.x = -0.32;
    g.add(pillow);
    const cushion = rbox(Math.min(pw * 0.72, 0.46), 0.34, 0.12, 0.055, i === 0 ? accent : duvet, x * 0.94, top - 0.01, head + 0.3);
    cushion.rotation.x = -0.42;
    g.add(cushion);
  }

  // the duvet, hanging over the sides and the foot, with the sheet turned back over its top edge
  const fold = head + 0.52;
  const cover = d / 2 - fold;
  g.add(rbox(w + 0.03, 0.09, cover, 0.04, duvet, 0, top - 0.035, fold + cover / 2));
  for (const side of [-1, 1]) {
    g.add(rbox(0.03, 0.24, cover - 0.02, 0.014, duvet, side * (w / 2 + 0.012), top - 0.2, fold + cover / 2));
  }
  g.add(rbox(w + 0.03, 0.24, 0.03, 0.014, duvet, 0, top - 0.2, d / 2 - 0.004));
  g.add(rbox(w + 0.04, 0.105, 0.24, 0.045, sheets, 0, top - 0.03, fold + 0.06));

  // a throw across the foot
  const across = d / 2 - 0.4;
  g.add(rbox(w + 0.06, 0.03, 0.44, 0.012, accent, 0, top + 0.05, across));
  for (const side of [-1, 1]) g.add(rbox(0.026, 0.3, 0.44, 0.012, accent, side * (w / 2 + 0.03), top - 0.22, across));
  return g;
};

export const bedsideTable: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.4);
  const leg = 0.17;
  legs(g, w, d, leg, kit.wood(FINISH.walnut), { r: 0.016, inset: 0.035, taper: 0.65 });
  g.add(rbox(w, h - leg, d, 0.012, kit.wood(FINISH.oak), 0, leg));
  const drawers = panels(g, kit.wood(tone(FINISH.oak, 0.05)), -w / 2 + 0.014, leg + 0.014, w - 0.028, h - leg - 0.028, d / 2, 1, 2, 0.014);
  const brass = kit.metal(FINISH.brass, 0.35);
  for (const f of drawers) g.add(ball(0.011, brass, f.x, f.y + f.h / 2, d / 2 + 0.022));
  if (!p.carries) g.add(books(p, 2, -0.03, h, 0, 0.3), mug(p, w * 0.24, h, d * 0.18));
  return g;
};

export const wardrobe: Builder = (p) => {
  const { kit, w, d, item } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 1.2);
  const plinth = 0.07;
  const frame = 0.022;                                      // the carcass shows as a frame round the doors
  const steel = kit.metal(FINISH.black, 0.45);
  const doors = Number.parseInt(item.model ?? "", 10) || Math.max(2, Math.round(w / 0.5));
  g.add(box(w - 0.04, plinth, d - 0.08, kit.paint(FINISH.charcoal, 0.7), 0, 0, -0.03));
  g.add(box(w, h - plinth, d - 0.02, kit.wood(FINISH.oak), 0, plinth, -0.01));
  const fronts = panels(g, kit.paint(FINISH.white, 0.45), -w / 2 + frame, plinth + frame, w - 2 * frame,
    h - plinth - 2 * frame, d / 2 - 0.02, doors, 1, 0.02);
  fronts.forEach((f, i) => {
    // doors open in pairs from where they meet; an odd last door opens on its own
    const side = i % 2 === 0 && i < doors - 1 ? 1 : -1;
    barHandle(g, steel, 0.3, f.x + side * (f.w / 2 - 0.035), f.y + Math.min(1.0, f.h * 0.5), d / 2, true);
  });
  return g;
};

/** A chest of drawers. */
export const dresser: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.5);
  const leg = 0.13;
  legs(g, w, d, leg, kit.wood(FINISH.walnut), { r: 0.02, inset: 0.04, taper: 0.6 });
  g.add(rbox(w, h - leg, d, 0.012, kit.wood(FINISH.oak), 0, leg));
  const drawers = panels(g, kit.wood(tone(FINISH.oak, 0.05)), -w / 2 + 0.016, leg + 0.016, w - 0.032, h - leg - 0.032,
    d / 2, w >= 0.9 ? 2 : 1, 3, 0.014);
  const brass = kit.metal(FINISH.brass, 0.35);
  for (const f of drawers) g.add(ball(0.012, brass, f.x, f.y + f.h / 2, d / 2 + 0.023));
  if (!p.carries) g.add(vase(p, -w * 0.28, h, -0.02), books(p, 2, w * 0.2, h, 0, -0.2));
  return g;
};

/** A dressing table with its mirror; the engine's height is the top of the mirror. */
export const dressingTable: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const total = Math.max(p.h, 1.2);
  const table = 0.76;
  const white = kit.paint(FINISH.white, 0.45);
  const brass = kit.metal(FINISH.brass, 0.3);
  legs(g, w, d, table - 0.15, kit.wood(FINISH.oak), { r: 0.018, inset: 0.03, taper: 0.55 });
  g.add(rbox(w, 0.13, d, 0.01, white, 0, table - 0.15));
  g.add(rbox(w + 0.02, 0.022, d + 0.01, 0.008, kit.wood(FINISH.oak), 0, table - 0.022));
  const drawers = panels(g, kit.paint(tone(FINISH.white, -0.03), 0.45), -w / 2 + 0.015, table - 0.14, w - 0.03, 0.105,
    d / 2, w > 0.9 ? 2 : 1, 1, 0.012);
  for (const f of drawers) g.add(ball(0.01, brass, f.x, f.y + f.h / 2, d / 2 + 0.02));

  // a round mirror on a stand at the back
  const r = Math.min(w * 0.3, (total - table - 0.06) / 2);
  const centre = table + 0.05 + r;
  const z = -d / 2 + 0.035;
  g.add(box(0.06, 0.06, 0.03, brass, 0, table, z));
  g.add(disc(r, 0.022, brass, 0, centre, z));
  g.add(disc(r - 0.014, 0.004, kit.mirror(), 0, centre, z + 0.012));

  // a tray of bottles
  const x = w * 0.3;
  g.add(rbox(0.24, 0.01, 0.15, 0.005, brass, x, table, 0.02));
  g.add(cyl(0.018, 0.075, kit.glass(0.55, "#d8b98a"), x - 0.06, table + 0.01, 0.03));
  g.add(box(0.036, 0.09, 0.036, kit.glass(0.55, "#e7c9c4"), x + 0.01, table + 0.01, 0));
  g.add(cyl(0.022, 0.05, kit.ceramic(FINISH.white), x + 0.07, table + 0.01, 0.04));
  return g;
};

/** A round upholstered stool on short brass legs. */
export const stool: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.3);
  const r = Math.min(w, d) / 2 - 0.01;
  const leg = 0.1;
  const seat = h - leg;
  const brass = kit.metal(FINISH.brass, 0.3);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    g.add(rod([Math.cos(a) * r * 0.8, 0, Math.sin(a) * r * 0.8], [Math.cos(a) * r * 0.62, leg + 0.02, Math.sin(a) * r * 0.62], 0.009, brass, 0.012));
  }
  g.add(ring(r * 0.98, 0.008, brass, 0, leg + 0.012, 0));
  g.add(lathe([[0.001, 0], [r * 0.9, 0], [r, 0.035], [r, seat - 0.06], [r * 0.93, seat - 0.015], [r * 0.7, seat], [0.001, seat]],
    kit.fabric(FINISH.blush), 0, leg, 0, 36));
  return g;
};

export const desk: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.6);
  const top = 0.03;
  const bar = 0.028;
  const steel = kit.metal(FINISH.black, 0.45);
  g.add(rbox(w, top, d, 0.008, kit.wood(FINISH.oak), 0, h - top));
  for (const sx of [-1, 1]) {                                // a steel loop at each end
    const x = sx * (w / 2 - 0.06);
    for (const sz of [-1, 1]) g.add(box(bar, h - top, bar, steel, x, 0, sz * (d / 2 - 0.06)));
    g.add(box(bar, bar, d - 0.12, steel, x, h - top - bar, 0));
    g.add(box(bar, bar, d - 0.12, steel, x, 0, 0));
  }
  g.add(box(w - 0.12, bar, 0.02, steel, 0, h - top - 0.2, -d / 2 + 0.06));
  // a drawer hung under the top
  const dw = Math.min(0.42, w * 0.38);
  const dx = w / 2 - 0.1 - dw / 2;
  const face = d / 2 - 0.07;
  g.add(box(dw, 0.1, d - 0.14, kit.paint(FINISH.white, 0.5), dx, h - top - 0.1, 0));
  g.add(box(dw - 0.006, 0.09, 0.014, kit.paint(tone(FINISH.white, -0.03), 0.5), dx, h - top - 0.095, face + 0.007));
  g.add(box(0.1, 0.008, 0.012, steel, dx, h - top - 0.055, face + 0.02));
  g.add(laptop(p, -w * 0.06, h, 0.03));
  g.add(mug(p, w * 0.3, h, d * 0.12));
  g.add(books(p, 3, w * 0.32, h, -d * 0.22, 0.15));
  return g;
};

/** A swivel chair on a five-star base, facing the desk. */
export const deskChair: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.7);
  const seatH = 0.47;
  const steel = kit.metal(FINISH.black, 0.45);
  const cloth = kit.fabric(FINISH.charcoal);
  const wheel = kit.paint("#111214", 0.5);
  const reach = Math.min(w, d) * 0.5 - 0.02;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
    const end: [number, number, number] = [Math.cos(a) * reach, 0.055, Math.sin(a) * reach];
    g.add(rod([0, 0.085, 0], end, 0.016, steel, 0.012));
    g.add(ball(0.026, wheel, end[0], 0.026, end[2]));
  }
  g.add(cyl(0.024, seatH - 0.14, steel, 0, 0.07, 0));
  g.add(box(0.2, 0.03, 0.2, steel, 0, seatH - 0.075, 0));
  g.add(rbox(w * 0.9, 0.07, d * 0.86, 0.03, cloth, 0, seatH - 0.045, 0.01));
  const rest = rbox(w * 0.84, h - seatH - 0.1, 0.05, 0.035, cloth, 0, seatH + 0.11, -d / 2 + 0.07);
  rest.rotation.x = -0.1;
  g.add(rest);
  g.add(rod([0, seatH - 0.06, -0.08], [0, seatH + 0.2, -d / 2 + 0.05], 0.014, steel));
  return g;
};
