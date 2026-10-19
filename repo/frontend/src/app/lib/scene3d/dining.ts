/** Dining furniture: the table, its chairs and the sideboard. */

import * as THREE from "three";
import { FINISH } from "../roomPalette3d";
import { tone } from "./materials";
import { ball, box, legs, panels, rbox, rod, type Builder, type Piece } from "./parts";
import { books, bowl, lamp, plant, vase } from "./props";

export const diningTable: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.6);
  const top = 0.04;
  const inset = 0.09;
  const oak = kit.wood(FINISH.oak);
  const under = kit.wood(FINISH.oakDark);
  g.add(rbox(w, top, d, 0.014, oak, 0, h - top));
  // rails under the top, and a tapered leg at each corner, splayed a little
  for (const sz of [-1, 1]) g.add(box(w - 2 * inset - 0.04, 0.07, 0.022, under, 0, h - top - 0.07, sz * (d / 2 - inset)));
  for (const sx of [-1, 1]) g.add(box(0.022, 0.07, d - 2 * inset - 0.04, under, sx * (w / 2 - inset), h - top - 0.07, 0));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(rod([sx * (w / 2 - inset + 0.02), 0, sz * (d / 2 - inset + 0.02)],
        [sx * (w / 2 - inset), h - top, sz * (d / 2 - inset)], 0.02, oak, 0.032));
    }
  }
  if (p.carries) return g;
  const long = Math.max(w, d);
  if (long < 1.1) {
    g.add(bowl(p, 0, h, 0, 0.12, true));
  } else {
    g.add(vase(p, 0, h, 0));
    if (long >= 1.7) g.add(bowl(p, w >= d ? long * 0.24 : 0, h, w >= d ? 0 : long * 0.24, 0.13, true));
  }
  return g;
};

/** A chair with an upholstered seat and back on a timber frame, its front towards the table. */
export const diningChair: Builder = (p) => {
  const { kit, w } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.7);
  const d = Math.min(p.d, 0.52);
  const seatH = 0.46;
  const sw = w * 0.9;
  const sd = d * 0.82;
  const oak = kit.wood(FINISH.oak);
  const pad = kit.fabric(p.kind === "living" ? FINISH.sage : FINISH.blush);
  const x = sw / 2 - 0.03;
  const back = -d / 2 + 0.05;
  const front = back + sd - 0.04;
  const middle = back + sd / 2 - 0.02;
  for (const sx of [-1, 1]) {
    g.add(rod([sx * (x + 0.012), 0, front + 0.015], [sx * x, seatH - 0.05, front], 0.013, oak, 0.017));
    g.add(rod([sx * (x + 0.012), 0, back - 0.02], [sx * x, seatH - 0.05, back], 0.013, oak, 0.017));
    g.add(rod([sx * x, seatH - 0.05, back], [sx * (x - 0.01), h - 0.03, back - 0.035], 0.017, oak, 0.013));   // carried up to the back
  }
  g.add(box(sw - 0.02, 0.02, sd, oak, 0, seatH - 0.065, middle));
  g.add(rbox(sw, 0.05, sd, 0.022, pad, 0, seatH - 0.05, middle));
  const rest = rbox(sw - 0.01, 0.2, 0.035, 0.016, pad, 0, h - 0.25, back - 0.02);
  rest.rotation.x = -0.1;
  g.add(rest);
  return g;
};

/** A low cupboard on legs: doors, a timber top, and something standing on it. */
function cupboard(p: Piece, withLamp: boolean): THREE.Group {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.4);
  const leg = h > 1.0 ? 0.1 : 0.16;
  const top = 0.025;
  const oak = kit.wood(FINISH.oak);
  legs(g, w, d, leg, oak, { r: 0.02, inset: 0.04, taper: 0.6 });
  g.add(box(w, h - leg - top, d, kit.paint(tone(FINISH.charcoal, -0.25), 0.6), 0, leg));
  g.add(rbox(w + 0.02, top, d + 0.015, 0.008, oak, 0, h - top, 0.004));
  const doors = Math.max(2, Math.round(w / 0.47));
  const faces = panels(g, kit.paint(FINISH.charcoal, 0.5), -w / 2 + 0.006, leg + 0.006, w - 0.012, h - leg - top - 0.012,
    d / 2, doors, h > 1.2 ? 2 : 1, 0.018);
  const brass = kit.metal(FINISH.brass, 0.35);
  faces.forEach((f, i) => {
    const side = (i % doors) % 2 === 0 && i % doors < doors - 1 ? 1 : -1;
    g.add(ball(0.012, brass, f.x + side * (f.w / 2 - 0.04), f.y + f.h - 0.08, d / 2 + 0.027));
  });
  if (p.carries || h > 1.3) return g;
  if (withLamp) g.add(lamp(p, -w / 2 + 0.2, h, 0));
  else g.add(plant(p, -w / 2 + 0.18, h, 0));
  g.add(books(p, 2, w * 0.08, h, 0.02, 0.2));
  if (w > 1.1) g.add(vase(p, w / 2 - 0.2, h, -0.02, 0.9));
  return g;
}

export const sideboard: Builder = (p) => cupboard(p, true);

export const storageCabinet: Builder = (p) => cupboard(p, false);
