/** Living-room furniture: the seating group, the tables, the TV wall, the bookshelf and the rug. */

import * as THREE from "three";
import { FINISH } from "../roomPalette3d";
import { tone } from "./materials";
import { MM, box, cyl, legs, rbox, type Builder, type Piece } from "./parts";
import { BOOK_COLORS, books, bowl, mug, plant } from "./props";

const ACCENTS = [FINISH.terracotta, FINISH.sage, FINISH.mustard];

interface SeatStyle {
  color: string;
  /** Width of each arm and height of the legs. */
  arm: number;
  leg: number;
  /** Loose scatter cushions. */
  pillows: number;
  leather?: boolean;
  /** A throw folded over one arm. */
  throwOver?: boolean;
}

/** A sofa or an armchair: a frame on legs, arms, and a seat and back cushion for each place. */
function upholstered(p: Piece, style: SeatStyle): THREE.Group {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.7);
  const cover = style.leather ? kit.leather(style.color) : kit.fabric(style.color);
  const cushion = style.leather ? kit.leather(tone(style.color, 0.06)) : kit.fabric(tone(style.color, 0.08));
  const { arm, leg } = style;
  const back = Math.min(0.2, d * 0.24);
  const frame = 0.17;
  const seatTop = leg + frame + 0.15;

  legs(g, w, d, leg, kit.wood(FINISH.walnut), { r: 0.022, inset: 0.06, taper: 0.6 });
  g.add(rbox(w, frame, d, 0.045, cover, 0, leg));
  const armH = Math.min(seatTop + 0.14, h - 0.12) - leg;
  for (const side of [-1, 1]) {
    g.add(rbox(arm, armH, d, Math.min(0.06, arm * 0.45), cover, side * (w / 2 - arm / 2), leg));
  }
  const inner = w - 2 * arm;
  g.add(rbox(inner + 0.03, h - leg - 0.07, back, 0.07, cover, 0, leg, -d / 2 + back / 2));

  const places = inner >= 1.55 ? 3 : inner >= 1.05 ? 2 : 1;
  const cw = inner / places;
  const seatDepth = d - back - 0.01;
  for (let i = 0; i < places; i++) {
    const x = -inner / 2 + cw * (i + 0.5);
    g.add(rbox(cw - 0.008, 0.16, seatDepth, 0.05, cushion, x, seatTop - 0.16, -d / 2 + back + seatDepth / 2));
    const rest = rbox(cw - 0.012, Math.min(0.4, h - seatTop + 0.02), 0.15, 0.065, cushion, x, seatTop - 0.02, -d / 2 + back + 0.07);
    rest.rotation.x = -0.16;
    g.add(rest);
  }

  for (let i = 0; i < style.pillows; i++) {
    const side = places === 1 ? 0 : i === 0 ? -1 : 1;
    const size = places === 1 ? 0.34 : 0.4;
    const pillow = rbox(size, size * 0.95, 0.12, 0.055, kit.fabric(ACCENTS[(p.n + i) % ACCENTS.length]),
      side * (inner / 2 - 0.23), seatTop - 0.01, -d / 2 + back + 0.2);
    pillow.rotation.set(-0.3, side * -0.2, side * 0.12);
    g.add(pillow);
  }

  if (style.throwOver) {
    const blanket = kit.fabric(tone(ACCENTS[(p.n + 2) % ACCENTS.length], 0.15));
    const x = w / 2 - arm / 2;
    g.add(rbox(arm + 0.03, 0.022, d * 0.42, 0.01, blanket, x, leg + armH - 0.004, d * 0.12));
    g.add(rbox(0.022, armH * 0.62, d * 0.42, 0.01, blanket, w / 2 + 0.006, leg + armH * 0.4, d * 0.12));
  }
  return g;
}

export const sofa: Builder = (p) =>
  upholstered(p, { color: FINISH.greige, arm: 0.17, leg: 0.13, pillows: 2, throwOver: p.w > 1.9 });

export const armchair: Builder = (p) => upholstered(p, { color: FINISH.teal, arm: 0.13, leg: 0.15, pillows: 1 });

export const readingChair: Builder = (p) =>
  upholstered(p, { color: FINISH.caramel, arm: 0.1, leg: 0.19, pillows: 0, leather: true });

/** A corner sofa is built straight from its two rectangles, already in room coordinates. */
export function cornerSofa(p: Piece, toX: (x: number) => number, toZ: (y: number) => number): THREE.Group {
  const { kit, item } = p;
  const g = new THREE.Group();
  const cover = kit.fabric(FINISH.greige);
  const cushion = kit.fabric(tone(FINISH.greige, 0.08));
  const backT = 0.2;
  const h = Math.max(item.height * MM, 0.7);
  const [bx0, by0, bx1, by1] = item.bbox;
  const parts = item.parts ?? [item.bbox];
  // the side of the bounding box each compass direction names
  const edges = {
    south: (q: number[]) => Math.abs(q[1] - by0) < 1, north: (q: number[]) => Math.abs(q[3] - by1) < 1,
    west: (q: number[]) => Math.abs(q[0] - bx0) < 1, east: (q: number[]) => Math.abs(q[2] - bx1) < 1,
  };
  const opposite: Record<string, keyof typeof edges> = { north: "south", south: "north", east: "west", west: "east" };
  const backSide = opposite[item.facing];
  // the return is the part that does not span the whole back edge
  const spans = (q: number[]) => (backSide === "north" || backSide === "south")
    ? Math.abs(q[2] - q[0] - (bx1 - bx0)) < 1 : Math.abs(q[3] - q[1] - (by1 - by0)) < 1;

  for (const q of parts) {
    const [x0, y0, x1, y1] = q;
    const w = (x1 - x0) * MM;
    const d = (y1 - y0) * MM;
    const cx = toX((x0 + x1) / 2);
    const cz = toZ((y0 + y1) / 2);
    g.add(rbox(w, 0.3, d, 0.04, cover, cx, 0.05, cz));
    g.add(rbox(Math.max(w - 0.08, 0.1), 0.14, Math.max(d - 0.08, 0.1), 0.05, cushion, cx, 0.33, cz));
    const sides: Array<keyof typeof edges> = spans(q) ? [backSide] : (["north", "south", "east", "west"] as const)
      .filter((s) => s !== item.facing && s !== backSide && edges[s](q));
    for (const side of sides) {
      if (!edges[side](q)) continue;
      if (side === "north" || side === "south") {
        const y = side === "south" ? y0 + backT * 500 : y1 - backT * 500;
        g.add(rbox(w, h - 0.05, backT, 0.06, cover, cx, 0.05, toZ(y)));
      } else {
        const x = side === "west" ? x0 + backT * 500 : x1 - backT * 500;
        g.add(rbox(backT, h - 0.05, d, 0.06, cover, toX(x), 0.05, cz));
      }
    }
  }
  return g;
}

export const coffeeTable: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.3);
  const oak = kit.wood(FINISH.oak);
  const steel = kit.metal(FINISH.black, 0.45);
  const top = 0.035;
  const post = 0.022;
  const x = w / 2 - 0.05;
  const z = d / 2 - 0.05;
  g.add(rbox(w, top, d, 0.012, oak, 0, h - top));
  g.add(box(w - 0.14, 0.018, d - 0.14, oak, 0, 0.13));                       // the shelf below
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(box(post, h - top, post, steel, sx * x, 0, sz * z));
    g.add(box(post, 0.02, d - 0.1, steel, sx * x, h - top - 0.02, 0));
  }
  for (const sz of [-1, 1]) g.add(box(w - 0.1, 0.02, post, steel, 0, h - top - 0.02, sz * z));
  g.add(books(p, 3, -w * 0.2, h, 0.02, 0.2));
  g.add(bowl(p, w * 0.22, h, -0.02, 0.1));
  return g;
};

export const sideTable: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.35);
  const r = Math.min(w, d) / 2 - 0.01;
  const steel = kit.metal(FINISH.black, 0.45);
  g.add(cyl(r, 0.022, kit.wood(FINISH.oak), 0, h - 0.022, 0, r, 40));
  g.add(cyl(0.016, h - 0.036, steel, 0, 0.014, 0));
  g.add(cyl(r * 0.62, 0.014, steel, 0, 0, 0, r * 0.58, 36));
  if (p.carries) return g;
  if (p.n % 2 === 0) g.add(plant(p, 0, h, 0, 0.85));
  else g.add(books(p, 2, -0.03, h, 0, 0.4), mug(p, 0.09, h, 0.07));
  return g;
};

export const tvConsole: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.35);
  const leg = 0.13;
  const oak = kit.wood(FINISH.oak);
  const shade = kit.wood(FINISH.oakDark);
  legs(g, w, d, leg, kit.metal(FINISH.black, 0.45), { r: 0.012, inset: 0.05, square: true });
  g.add(rbox(w, h - leg, d, 0.01, oak, 0, leg));
  // slatted doors: thin strips over a darker panel
  const doors = Math.max(2, Math.round(w / 0.5));
  const dw = (w - 0.04) / doors;
  const y0 = leg + 0.02;
  const high = h - leg - 0.04;
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + 0.02 + dw * (i + 0.5);
    g.add(box(dw - 0.004, high, 0.006, shade, x, y0, d / 2 + 0.003));
    const slats = Math.max(1, Math.floor((dw - 0.004) / 0.03));
    const pitch = (dw - 0.004) / slats;
    for (let s = 0; s < slats; s++) {
      g.add(box(pitch - 0.01, high, 0.01, oak, x - (dw - 0.004) / 2 + pitch * (s + 0.5), y0, d / 2 + 0.011));
    }
  }
  if (p.carries) return g;
  g.add(rbox(Math.min(0.8, w * 0.45), 0.055, 0.075, 0.02, kit.paint("#232428", 0.7), 0, h, -d / 2 + 0.14));   // soundbar
  g.add(plant(p, w / 2 - 0.14, h, 0.02, 0.9));
  g.add(books(p, 2, -w / 2 + 0.2, h, 0.03, -0.25));
  return g;
};

/** A flat screen hung on the wall behind it, its centre at `mount_height`. */
export const television: Builder = (p) => {
  const { kit, w, d, item } = p;
  const g = new THREE.Group();
  const high = p.h > 0.2 ? p.h : w * 0.56;
  const y0 = Math.max((item.mount_height ?? 1100) * MM - high / 2, 0.2);
  const wall = -d / 2;
  g.add(box(w * 0.3, high * 0.4, 0.03, kit.paint(FINISH.black, 0.6), 0, y0 + high * 0.3, wall + 0.015));       // bracket
  g.add(rbox(w, high, 0.028, 0.006, kit.paint("#101114", 0.4), 0, y0, wall + 0.044));
  const screen = new THREE.MeshStandardMaterial({ color: "#0b0f16", roughness: 0.12, metalness: 0.55, envMapIntensity: 1.3 });
  g.add(box(w - 0.016, high - 0.016, 0.002, screen, 0, y0 + 0.008, wall + 0.059));
  return g;
};

export const bookshelf: Builder = (p) => {
  const { kit, w, d, rnd } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 0.6);
  const t = 0.025;
  const oak = kit.wood(FINISH.oak);
  g.add(box(w, h, 0.012, kit.wood(FINISH.oakDark), 0, 0, -d / 2 + 0.006));
  for (const side of [-1, 1]) g.add(box(t, h, d, oak, side * (w / 2 - t / 2), 0));
  const levels = Math.max(3, Math.round(h / 0.36));
  const covers = BOOK_COLORS.map((color) => kit.paint(color, 0.7));
  const inner = w - 2 * t;
  const bay = (h - t) / levels - t;
  for (let i = 0; i <= levels; i++) {
    const y = ((h - t) * i) / levels;
    g.add(box(inner, t, d - 0.012, oak, 0, y, 0.006));
    if (i === levels) break;
    const floor = y + t;
    const mode = rnd();
    if (mode < 0.62) {
      // a row of books standing from one end, something set down beside them
      const fromLeft = rnd() > 0.4;
      const filled = inner * (0.5 + rnd() * 0.3);
      let used = 0.01;
      while (used < filled) {
        const bw = 0.022 + rnd() * 0.03;
        const bh = Math.min(bay - 0.02, 0.17 + rnd() * 0.1);
        const bd = Math.min(d - 0.06, 0.13 + rnd() * 0.06);
        const x = (fromLeft ? -1 : 1) * (inner / 2 - used - bw / 2);
        g.add(box(bw, bh, bd, covers[Math.floor(rnd() * covers.length)], x, floor, -d / 2 + 0.03 + bd / 2));
        used += bw + 0.002;
      }
      if (rnd() > 0.45 && bay > 0.26) {
        g.add(plant(p, (fromLeft ? 1 : -1) * (inner / 2 - 0.12), floor, 0.01, Math.min(0.7, bay / 0.36)));
      }
    } else if (mode < 0.85) {
      g.add(books(p, 3, (rnd() - 0.5) * inner * 0.4, floor, 0.01, (rnd() - 0.5) * 0.4));
    } else {
      g.add(bowl(p, (rnd() - 0.5) * inner * 0.3, floor, 0.01, 0.09));
    }
  }
  return g;
};

/** A woven rug with a trellis pattern, lying flat. */
export const rug: Builder = (p) => {
  const { kit, w, d } = p;
  const g = new THREE.Group();
  const pattern = kit.picture(640, (640 * d) / w, (c, cw, ch) => {
    c.fillStyle = FINISH.linen;
    c.fillRect(0, 0, cw, ch);
    for (let i = 0; i < 9000; i++) {                               // the pile
      c.fillStyle = p.rnd() > 0.5 ? "rgba(255, 255, 255, 0.10)" : "rgba(120, 104, 84, 0.08)";
      c.fillRect(p.rnd() * cw, p.rnd() * ch, 2, 2);
    }
    const inset = cw * 0.06;
    c.save();
    c.beginPath();
    c.rect(inset, inset, cw - 2 * inset, ch - 2 * inset);
    c.clip();
    c.strokeStyle = "rgba(96, 88, 78, 0.5)";
    c.lineWidth = cw * 0.006;
    const step = cw / 7;
    for (let x = -ch; x < cw + ch; x += step) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x + ch, ch);
      c.moveTo(x + ch, 0);
      c.lineTo(x, ch);
      c.stroke();
    }
    c.restore();
    c.strokeStyle = "rgba(96, 88, 78, 0.7)";
    c.lineWidth = cw * 0.01;
    c.strokeRect(inset, inset, cw - 2 * inset, ch - 2 * inset);
  });
  const top = new THREE.MeshStandardMaterial({ map: pattern, roughness: 1 });
  const edge = kit.fabric(tone(FINISH.linen, -0.06));
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), [edge, edge, top, edge, edge, edge]);
  mesh.position.y = 0.007;
  mesh.receiveShadow = true;
  g.add(mesh);
  return g;
};
