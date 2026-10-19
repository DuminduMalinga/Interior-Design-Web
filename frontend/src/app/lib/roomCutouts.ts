/**
 * Non-rectangular rooms. The layout engines describe an L-shaped (or other
 * non-rectangular) room as its width × length rectangle plus `cutouts`: the
 * parts of that rectangle that are not floor, as [x0, y0, x1, y1] in mm (x west
 * -> east, y south -> north). The 2D plan and the 3D model both draw the room
 * from them: no wall where a cut-out reaches the rectangle's edge, and a wall
 * along each cut-out edge that borders the floor.
 */

import type { Wall } from "./livingRoomLayout";

export type Cutout = [number, number, number, number];
type Vec = [number, number];

const EDGE_TOL = 1;

/** The stretches between two ends that the given spans leave free. */
function free(lo: number, hi: number, spans: Array<{ start: number; end: number }>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let cursor = lo;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.start > cursor) out.push([cursor, Math.min(span.start, hi)]);
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < hi) out.push([cursor, hi]);
  return out;
}

/**
 * Where a cut-out runs along one of the rectangle's walls, in that wall's
 * position (mm from its west / south end): not a wall of this room.
 */
export function cutoutSpans(wall: Wall, cutouts: Cutout[], room: { width: number; length: number }) {
  return cutouts.flatMap(([x0, y0, x1, y1]) => {
    if (wall === "south" && y0 <= EDGE_TOL) return [{ start: x0, end: x1 }];
    if (wall === "north" && y1 >= room.length - EDGE_TOL) return [{ start: x0, end: x1 }];
    if (wall === "west" && x0 <= EDGE_TOL) return [{ start: y0, end: y1 }];
    if (wall === "east" && x1 >= room.width - EDGE_TOL) return [{ start: y0, end: y1 }];
    return [];
  });
}

export interface NotchWall {
  /** The wall's two ends, in mm. */
  a: Vec;
  b: Vec;
  /** Which of the room's walls it stands in for: the one facing the same way into the room. */
  as: Wall;
  /** Whether each end reaches the rectangle's edge, where it meets an outer wall. */
  atEdge: [boolean, boolean];
}

/**
 * The walls round each notch: every cut-out edge inside the rectangle, less
 * any stretch shared with a neighbouring cut-out (no floor on either side).
 */
export function notchWalls(cutouts: Cutout[], room: { width: number; length: number }): NotchWall[] {
  const walls: NotchWall[] = [];
  const onEdgeX = (x: number) => x <= EDGE_TOL || x >= room.width - EDGE_TOL;
  const onEdgeY = (y: number) => y <= EDGE_TOL || y >= room.length - EDGE_TOL;
  cutouts.forEach((c, i) => {
    const [x0, y0, x1, y1] = c;
    const others = cutouts.filter((_, j) => j !== i);
    // [fixed coordinate, low end, high end, vertical?, index of a neighbour's facing side, the wall it stands in for]
    // The floor lies on the far side of the edge from the cut-out: west of its west
    // edge, so that face looks west into the room, like the room's east wall.
    const edges: Array<[number, number, number, boolean, number, Wall]> = [
      [x0, y0, y1, true, 2, "east"],
      [x1, y0, y1, true, 0, "west"],
      [y0, x0, x1, false, 3, "north"],
      [y1, x0, x1, false, 1, "south"],
    ];
    for (const [at, lo, hi, vertical, across, as] of edges) {
      if (vertical ? onEdgeX(at) : onEdgeY(at)) continue;
      const shared = others
        .filter((o) => Math.abs(o[across] - at) <= EDGE_TOL)
        .map((o) => (vertical ? { start: o[1], end: o[3] } : { start: o[0], end: o[2] }));
      for (const [s, e] of free(lo, hi, shared)) {
        walls.push({
          a: vertical ? [at, s] : [s, at],
          b: vertical ? [at, e] : [e, at],
          as,
          atEdge: vertical ? [onEdgeY(s), onEdgeY(e)] : [onEdgeX(s), onEdgeX(e)],
        });
      }
    }
  });
  return walls;
}

/** How far a notch wall stands in from the line of the outer wall it stands in for (mm). */
export function notchInset({ a, as }: NotchWall, room: { width: number; length: number }): number {
  return { south: a[1], north: room.length - a[1], west: a[0], east: room.width - a[0] }[as];
}

/** A notch wall's two ends as positions along the outer wall it stands in for. */
export function notchSpan({ a, b, as }: NotchWall): [number, number] {
  const [p, q] = as === "north" || as === "south" ? [a[0], b[0]] : [a[1], b[1]];
  return [Math.min(p, q), Math.max(p, q)];
}

/** Whether an opening (wall, inset, position, width) is in this notch wall. */
export function inNotchWall(
  n: NotchWall,
  o: { wall: Wall; inset?: number; position: number; width: number },
  room: { width: number; length: number },
): boolean {
  if (o.wall !== n.as || Math.abs((o.inset ?? 0) - notchInset(n, room)) > 5) return false;
  const [lo, hi] = notchSpan(n);
  const middle = o.position + o.width / 2;
  return middle >= lo && middle <= hi;
}

export interface FloorRect {
  rect: Cutout;
  /** Which of its sides lie on the rectangle's edge, under an outer wall. */
  edge: Record<Wall, boolean>;
}

/**
 * The room's floor - the rectangle less its cut-outs - as non-overlapping
 * rectangles: the rectangle is cut along every cut-out edge, the floor cells
 * are joined into runs along each row, and runs with the same span are stacked.
 */
export function floorRects(cutouts: Cutout[], room: { width: number; length: number }): FloorRect[] {
  const clampX = (x: number) => Math.min(Math.max(x, 0), room.width);
  const clampY = (y: number) => Math.min(Math.max(y, 0), room.length);
  const xs = [...new Set([0, room.width, ...cutouts.flatMap(([x0, , x1]) => [clampX(x0), clampX(x1)])])].sort((a, b) => a - b);
  const ys = [...new Set([0, room.length, ...cutouts.flatMap(([, y0, , y1]) => [clampY(y0), clampY(y1)])])].sort((a, b) => a - b);
  const isFloor = (x: number, y: number) => !cutouts.some(([x0, y0, x1, y1]) => x > x0 && x < x1 && y > y0 && y < y1);
  const done: Cutout[] = [];
  let open: Cutout[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    const [y0, y1] = [ys[j], ys[j + 1]];
    const runs: Cutout[] = [];
    for (let i = 0; i + 1 < xs.length; i++) {
      const [x0, x1] = [xs[i], xs[i + 1]];
      if (!isFloor((x0 + x1) / 2, (y0 + y1) / 2)) continue;
      const last = runs[runs.length - 1];
      if (last && last[2] === x0) last[2] = x1;
      else runs.push([x0, y0, x1, y1]);
    }
    const next: Cutout[] = [];
    for (const run of runs) {
      const below = open.find((o) => o[0] === run[0] && o[2] === run[2] && o[3] === run[1]);
      if (below) {
        open = open.filter((o) => o !== below);
        next.push([below[0], below[1], below[2], run[3]]);
      } else next.push(run);
    }
    done.push(...open);
    open = next;
  }
  return [...done, ...open].map((rect) => ({
    rect,
    edge: {
      west: rect[0] <= EDGE_TOL,
      east: rect[2] >= room.width - EDGE_TOL,
      south: rect[1] <= EDGE_TOL,
      north: rect[3] >= room.length - EDGE_TOL,
    },
  }));
}
