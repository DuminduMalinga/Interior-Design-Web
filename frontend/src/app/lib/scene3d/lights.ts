/**
 * Light fittings: the lamp on the floor, the lamps that stand on a table or a
 * desk, and the ones fixed to the ceiling and the wall.
 *
 * For every light but the floor lamp the engine's `mount_height` says how high
 * the light itself is; `base` is the top of the furniture a lamp stands on.
 */

import * as THREE from "three";
import { FINISH } from "../roomPalette3d";
import { MM, ball, box, cyl, lathe, rbox, rod, type Builder } from "./parts";

const WARM = "#ffe9c4";
type Vec = [number, number, number];

export const floorLamp: Builder = (p) => {
  const { kit, w } = p;
  const g = new THREE.Group();
  const h = Math.max(p.h, 1.2);
  const steel = kit.metal(FINISH.black, 0.45);
  const r = Math.min(w / 2, 0.19);
  g.add(cyl(r * 0.75, 0.02, steel, 0, 0, 0, r * 0.7, 32));
  g.add(cyl(0.011, h - 0.32, steel, 0, 0.02, 0));
  g.add(cyl(r, 0.3, kit.glow(WARM, 0.85), 0, h - 0.3, 0, r * 0.8, 32));
  return g;
};

/** A lamp with a pottery base and a drum shade. */
export const tableLamp: Builder = (p) => {
  const { kit, item } = p;
  const g = new THREE.Group();
  const light = (item.mount_height ?? 1000) * MM;
  const foot = p.base ?? Math.max(light - 0.4, 0);
  const body = Math.max(light - foot - 0.1, 0.12);
  g.add(lathe([[0.001, 0], [0.05, 0], [0.062, body * 0.3], [0.045, body * 0.75], [0.015, body], [0.001, body]],
    kit.ceramic("#ece7dc"), 0, foot, 0));
  g.add(cyl(0.005, 0.04, kit.metal(FINISH.brass, 0.35), 0, foot + body, 0));
  g.add(cyl(0.1, 0.16, kit.glow(WARM, 0.85), 0, foot + body + 0.02, 0, 0.075, 28));
  return g;
};

/** A jointed desk lamp, its head turned down over the work. */
export const deskLamp: Builder = (p) => {
  const { kit, item } = p;
  const g = new THREE.Group();
  const light = (item.mount_height ?? 1150) * MM;
  const foot = p.base ?? Math.max(light - 0.4, 0);
  const reach = Math.max(light - foot, 0.25);
  const steel = kit.metal(FINISH.black, 0.45);
  const elbow: Vec = [0, foot + reach * 0.62, -0.07];
  const tip: Vec = [0, foot + reach, 0.12];
  g.add(cyl(0.07, 0.016, steel, 0, foot, 0, 0.065, 28));
  g.add(rod([0, foot + 0.016, 0], elbow, 0.007, steel));
  g.add(rod(elbow, tip, 0.007, steel));
  g.add(ball(0.012, steel, ...elbow));
  g.add(cyl(0.065, 0.07, steel, tip[0], tip[1] - 0.06, tip[2] + 0.02, 0.03, 24));
  g.add(cyl(0.055, 0.004, kit.glow(WARM, 1.2), tip[0], tip[1] - 0.064, tip[2] + 0.02));
  return g;
};

/** A globe hung from the ceiling on a flex; `mount_height` is the bottom of the globe. */
export const pendant: Builder = (p) => {
  const { kit, w, item, ceiling } = p;
  const g = new THREE.Group();
  const r = Math.max(Math.min(w / 2, 0.16), 0.11);
  const bottom = Math.min((item.mount_height ?? 1500) * MM, ceiling - 2 * r - 0.1);
  const top = bottom + 2 * r;
  const brass = kit.metal(FINISH.brass, 0.3);
  g.add(cyl(0.05, 0.02, brass, 0, ceiling - 0.02, 0));
  g.add(cyl(0.004, Math.max(ceiling - 0.02 - top - 0.03, 0.01), kit.paint(FINISH.black, 0.6), 0, top + 0.03, 0, 0.004, 6));
  g.add(cyl(0.032, 0.04, brass, 0, top - 0.008, 0, 0.022, 20));
  const globe = ball(r, kit.glow("#fff1d8", 0.95), 0, bottom + r, 0);
  globe.castShadow = false;
  g.add(globe);
  return g;
};

/** A flat fitting on the ceiling; one set lower than the ceiling hangs as a pendant instead. */
export const ceilingLight: Builder = (p) => {
  const { kit, w, item, ceiling } = p;
  const at = Math.min((item.mount_height ?? ceiling / MM) * MM, ceiling);
  if (ceiling - at > 0.3) return pendant(p);
  const g = new THREE.Group();
  const r = Math.max(Math.min(w / 2, 0.24), 0.17);
  const shade = cyl(r, 0.07, kit.glow("#fff4dc", 0.9), 0, at - 0.082, 0, r * 0.96, 40);
  shade.castShadow = false;
  const plate = cyl(r + 0.012, 0.012, kit.paint(FINISH.white, 0.5), 0, at - 0.012, 0, r + 0.012, 40);
  plate.castShadow = false;
  g.add(shade, plate);
  return g;
};

/** A strip light on the wall behind it, over a mirror. */
export const mirrorLight: Builder = (p) => {
  const { kit, w, d, item } = p;
  const g = new THREE.Group();
  const y = (item.mount_height ?? 1700) * MM;
  const wall = -d / 2;
  const brass = kit.metal(FINISH.brass, 0.3);
  g.add(box(0.08, 0.05, 0.02, brass, 0, y - 0.025, wall + 0.01));
  g.add(rod([0, y, wall + 0.02], [0, y, wall + 0.07], 0.008, brass));
  const tube = rbox(Math.max(w, 0.3), 0.035, 0.035, 0.016, kit.glow("#fff4dc", 1.0), 0, y - 0.0175, wall + 0.085);
  tube.castShadow = false;
  g.add(tube);
  return g;
};
