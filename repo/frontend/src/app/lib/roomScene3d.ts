/**
 * Turns a layout from any of the rule-based layout services into a three.js
 * model: the room (floor, walls with their door and window openings) and a
 * detailed model of every piece of furniture, all at real size.
 *
 * Units: the layout is in millimetres with x running west -> east and y south
 * -> north; the model is in metres with X east, Y up and Z south, centred on
 * the middle of the floor.
 *
 * The parts live in ./scene3d: materials and textures, the shapes everything is
 * put together from, the furniture by room, and the room shell.
 */

import * as THREE from "three";
import type { LivingRoomLayoutResult, Wall } from "./livingRoomLayout";
import { OPPOSITE, buildFurniture, roomKind, standsOnFloor } from "./scene3d/furniture";
import { Kit } from "./scene3d/materials";
import { MM, SLAB, WALL, type Frame } from "./scene3d/parts";
import { buildShell, fixToWall, pinFixture, showAllWalls, updateWalls, type WallView } from "./scene3d/shell";

export { SLAB, WALL, pinFixture, showAllWalls, updateWalls };

export interface RoomModel {
  /** The room and its furniture: what is exported. */
  root: THREE.Group;
  /** Drawn with the model but no part of it: the soft shadows under the furniture. */
  extras: THREE.Group;
  /** One group per piece of furniture, keyed by the item's id. */
  furniture: Map<string, THREE.Group>;
  /** Room size in metres, inside the walls. */
  size: { width: number; length: number; height: number };
  /** The four walls, each taken away while the camera is behind it, with whatever is fixed to it. */
  walls: WallView[];
  /** The corner to look in from: east (+1) or west (-1), south (+1) or north (-1). */
  view: { x: number; z: number };
  kit: Kit;
}

/** The pieces a room is furnished round: they count for more when choosing what to show. */
const CENTREPIECE: Record<string, number> = { bed: 4, sofa: 2, loveseat: 2 };

/**
 * The corner the room shows best from. The two walls nearest the camera are
 * taken away, so furniture standing against them is seen from behind, and a
 * wardrobe or a refrigerator there, close to the camera, stands in the way of
 * everything else. Look in towards the walls with the most to show - the bed's
 * or the sofa's above all - and not past anything tall.
 */
function bestCorner(layout: LivingRoomLayoutResult, f: Frame): { x: number; z: number } {
  const show: Record<Wall, number> = { north: 0, south: 0, east: 0, west: 0 };
  const tall: Array<{ wall: Wall; middle: number; size: number }> = [];
  for (const item of layout.furniture) {
    if (!standsOnFloor(item) && item.mounted !== "wall") continue;
    const [x0, y0, x1, y1] = item.bbox;
    const back = OPPOSITE[item.facing];
    const against = { west: x0 <= 20, east: x1 >= f.width - 20, south: y0 <= 20, north: y1 >= f.length - 20 }[back];
    if (!against) continue;
    const [lo, hi] = back === "north" || back === "south" ? [x0, x1] : [y0, y1];
    // a bed's height is its mattress; what stands against the wall is its headboard
    const high = Math.max(item.height * MM, item.type === "bed" ? 1.1 : 0.4);
    const size = (hi - lo) * MM * high;
    show[back] += size * (CENTREPIECE[item.type] ?? 1);
    if (high > 1.2 && item.type !== "shower" && standsOnFloor(item)) tall.push({ wall: back, middle: (lo + hi) / 2, size });   // a shower is glass
  }
  for (const o of layout.openings?.windows ?? []) show[o.wall] += o.width * MM * 0.5;

  const corners: Array<{ x: number; z: number; far: [Wall, Wall] }> = [
    { x: 1, z: 1, far: ["north", "west"] }, { x: -1, z: 1, far: ["north", "east"] },
    { x: 1, z: -1, far: ["south", "west"] }, { x: -1, z: -1, far: ["south", "east"] },
  ];
  const score = (corner: { x: number; z: number; far: [Wall, Wall] }) => {
    let total = show[corner.far[0]] + show[corner.far[1]];
    for (const piece of tall) {
      if (corner.far.includes(piece.wall)) continue;
      // against a near wall: the closer along it to the camera's corner, the more it hides
      const alongX = piece.wall === "north" || piece.wall === "south";
      const span = alongX ? f.width : f.length;
      const camera = alongX ? (corner.x > 0 ? f.width : 0) : (corner.z > 0 ? 0 : f.length);
      const closeness = 1 - Math.abs(piece.middle - camera) / span;
      total -= 3 * piece.size * closeness * closeness;
    }
    return total;
  };
  let best = corners[0];
  for (const corner of corners) if (score(corner) > score(best) + 0.01) best = corner;
  return { x: best.x, z: best.z };
}

export function buildRoomModel(layout: LivingRoomLayoutResult): RoomModel {
  const f: Frame = {
    width: layout.room.width,
    length: layout.room.length,
    height: layout.room.height > 0 ? layout.room.height : 2800,
  };
  const kit = new Kit();
  const kind = roomKind(layout);
  const root = new THREE.Group();
  root.name = layout.layout?.title ?? "room layout";
  const shell = buildShell(layout, f, kit, kind);
  const furnished = buildFurniture(layout, f, kit, kind);
  for (const { group, wall } of furnished.fixed) fixToWall(shell.walls, wall, group);
  root.add(shell.group, furnished.group);
  return {
    root,
    extras: furnished.shadows,
    furniture: furnished.pieces,
    size: { width: f.width * MM, length: f.length * MM, height: f.height * MM },
    walls: shell.walls,
    view: bestCorner(layout, f),
    kit,
  };
}

/** Free every geometry, material and texture of a model. */
export function disposeModel(model: RoomModel): void {
  for (const part of [model.root, model.extras]) {
    part.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    });
  }
  model.kit.dispose();
}
