/**
 * The small things that make a furnished room look lived in: plants, books,
 * vases, a laptop on the desk. They are styling, not furniture - each one is
 * added to the piece it stands on and takes up no floor of its own.
 */

import * as THREE from "three";
import { FINISH } from "../roomPalette3d";
import { tone } from "./materials";
import { ball, box, cyl, lathe, rbox, rod, type Piece } from "./parts";

export const BOOK_COLORS = ["#b5654a", "#3f5a6b", "#d9c9a8", "#7d8f76", "#c9a04a", "#4a4a4f", "#e8e2d6", "#8a5a4a"];
const UP = new THREE.Vector3(0, 1, 0);

/** A potted plant with upright leaves, standing on height `y`. */
export function plant(p: Piece, x: number, y: number, z: number, size = 1): THREE.Group {
  const g = new THREE.Group();
  const pot = p.kit.ceramic(p.rnd() > 0.5 ? "#f1ede4" : FINISH.terracotta);
  g.add(lathe([[0.001, 0], [0.04, 0], [0.058, 0.085], [0.05, 0.085], [0.036, 0.012], [0.001, 0.012]], pot));
  g.add(cyl(0.048, 0.006, p.kit.paint("#4a3a2c", 0.9), 0, 0.072, 0));
  const leaves = [p.kit.paint("#5f8a55", 0.7), p.kit.paint("#4c7446", 0.7)];
  const count = 9;
  for (let i = 0; i < count; i++) {
    const turn = (i / count) * Math.PI * 2 + p.rnd() * 0.6;
    const lean = 0.12 + p.rnd() * 0.42;
    const length = 0.13 + p.rnd() * 0.15;
    const axis = new THREE.Vector3(Math.sin(lean) * Math.cos(turn), Math.cos(lean), Math.sin(lean) * Math.sin(turn));
    const leaf = ball(1, leaves[i % 2], 0, 0, 0, [0.03, length / 2, 0.012]);
    leaf.position.copy(axis).multiplyScalar(length / 2).add(new THREE.Vector3(0, 0.075, 0));
    leaf.quaternion.setFromUnitVectors(UP, axis);
    g.add(leaf);
  }
  g.position.set(x, y, z);
  g.scale.setScalar(size);
  return g;
}

/** A few books lying in a stack, the top ones a little askew. */
export function books(p: Piece, count: number, x: number, y: number, z: number, turn = 0): THREE.Group {
  const g = new THREE.Group();
  let top = 0;
  for (let i = 0; i < count; i++) {
    const w = 0.24 - i * 0.015 - p.rnd() * 0.02;
    const t = 0.022 + p.rnd() * 0.014;
    const cover = box(w, t, w * 0.72, p.kit.paint(BOOK_COLORS[Math.floor(p.rnd() * BOOK_COLORS.length)], 0.7), 0, top, 0);
    cover.rotation.y = (p.rnd() - 0.5) * 0.35;
    g.add(cover);
    g.add(box(w - 0.008, t - 0.006, w * 0.72 - 0.004, p.kit.paint("#f3efe6", 0.9), 0.006, top + 0.003, 0).rotateY(cover.rotation.y));
    top += t;
  }
  g.position.set(x, y, z);
  g.rotation.y = turn;
  return g;
}

/** A vase with a few dried stems. */
export function vase(p: Piece, x: number, y: number, z: number, size = 1): THREE.Group {
  const g = new THREE.Group();
  const glaze = p.kit.ceramic([FINISH.white, FINISH.sage, FINISH.terracotta, "#2f3a44"][Math.floor(p.rnd() * 4)]);
  g.add(lathe([[0.001, 0], [0.036, 0], [0.058, 0.06], [0.062, 0.12], [0.036, 0.2], [0.03, 0.235], [0.037, 0.26],
    [0.03, 0.26], [0.024, 0.235], [0.03, 0.2], [0.054, 0.12], [0.05, 0.06], [0.001, 0.02]], glaze));
  const stem = p.kit.paint("#a58e63", 0.9);
  const plume = p.kit.paint("#e1d2b3", 1);
  for (let i = 0; i < 5; i++) {
    const turn = p.rnd() * Math.PI * 2;
    const lean = 0.08 + p.rnd() * 0.3;
    const length = 0.26 + p.rnd() * 0.2;
    const tip: [number, number, number] = [Math.sin(lean) * Math.cos(turn) * length, 0.2 + Math.cos(lean) * length, Math.sin(lean) * Math.sin(turn) * length];
    g.add(rod([0, 0.2, 0], tip, 0.0025, stem, 0.0025, 6));
    const head = ball(1, plume, tip[0], tip[1], tip[2], [0.018, 0.075, 0.018]);
    head.quaternion.setFromUnitVectors(UP, new THREE.Vector3(tip[0], tip[1] - 0.2, tip[2]).normalize());
    g.add(head);
  }
  g.position.set(x, y, z);
  g.scale.setScalar(size);
  return g;
}

/** A shallow bowl, with fruit in it when `fruit` is set. */
export function bowl(p: Piece, x: number, y: number, z: number, r = 0.13, fruit = false): THREE.Group {
  const g = new THREE.Group();
  g.add(lathe([[0.001, 0], [r * 0.45, 0], [r * 0.85, r * 0.3], [r, r * 0.55], [r * 0.95, r * 0.55],
    [r * 0.8, r * 0.3 + 0.008], [r * 0.4, 0.012], [0.001, 0.012]], p.kit.ceramic(fruit ? "#f1ede4" : "#3b4046")));
  if (fruit) {
    const colors = ["#d98a3d", "#c9463d", "#e3c14a", "#8fa84a"];
    for (let i = 0; i < 4; i++) {
      const turn = (i / 4) * Math.PI * 2 + p.rnd();
      g.add(ball(r * 0.3, p.kit.paint(colors[i], 0.5), Math.cos(turn) * r * 0.36, r * 0.36, Math.sin(turn) * r * 0.36));
    }
  }
  g.position.set(x, y, z);
  return g;
}

export function mug(p: Piece, x: number, y: number, z: number): THREE.Mesh {
  return lathe([[0.001, 0], [0.034, 0], [0.04, 0.09], [0.035, 0.09], [0.03, 0.01], [0.001, 0.01]],
    p.kit.ceramic([FINISH.white, FINISH.sage, FINISH.blush][Math.floor(p.rnd() * 3)]), x, y, z, 20);
}

/** An open laptop, its screen towards +Z before `turn`. */
export function laptop(p: Piece, x: number, y: number, z: number, turn = 0): THREE.Group {
  const g = new THREE.Group();
  const shell = p.kit.metal("#b9bcc1", 0.4);
  g.add(rbox(0.32, 0.014, 0.22, 0.005, shell));
  g.add(box(0.27, 0.001, 0.1, p.kit.paint("#2a2c30", 0.6), 0, 0.014, -0.03));           // keys
  const lid = new THREE.Group();
  lid.add(rbox(0.32, 0.21, 0.008, 0.004, shell, 0, 0, -0.004));
  lid.add(box(0.3, 0.19, 0.001, new THREE.MeshStandardMaterial({ color: "#1a2233", emissive: "#3a5f8f", emissiveIntensity: 0.35, roughness: 0.2 }), 0, 0.01, 0.0005));
  lid.position.set(0, 0.014, -0.108);
  lid.rotation.x = -0.3;
  g.add(lid);
  g.position.set(x, y, z);
  g.rotation.y = turn;
  return g;
}

/** A table lamp with a drum shade, standing on height `y`. */
export function lamp(p: Piece, x: number, y: number, z: number, height = 0.42): THREE.Group {
  const g = new THREE.Group();
  const body = height - 0.17;
  g.add(lathe([[0.001, 0], [0.05, 0], [0.065, body * 0.3], [0.05, body * 0.75], [0.016, body], [0.001, body]],
    p.kit.ceramic(tone(FINISH.sage, -0.05))));
  g.add(cyl(0.006, 0.05, p.kit.metal(FINISH.brass, 0.35), 0, body, 0));
  const shade = cyl(0.11, 0.15, p.kit.glow("#fff0d6", 0.75), 0, body + 0.03, 0, 0.085, 28);
  g.add(shade);
  g.position.set(x, y, z);
  return g;
}
