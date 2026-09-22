"""
Occupancy raster used for area and circulation questions.

Two questions are hard to answer with rectangle algebra alone:

* how much floor is actually left once overlapping keep-clear zones are unioned
* whether a person of a given shoulder width can still walk from A to B

Both become easy on a coarse raster (100 mm cells by default): the first is a
cell count, the second a breadth-first search over cells whose surrounding
square is free.  Both the erosion (summed-area table) and the flood fill are
O(cells), and the raster is only built for whole-layout evaluation, never per
candidate, so the cost stays small.
"""

from __future__ import annotations

import math
from collections import deque
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from ..models.geometry import Rect, Shape


class OccupancyGrid:
    """Boolean occupancy raster over the room rectangle."""

    def __init__(self, width: float, length: float, cell: float = 100.0):
        self.cell = float(cell)
        self.width = float(width)
        self.length = float(length)
        self.nx = max(1, int(math.ceil(width / self.cell)))
        self.ny = max(1, int(math.ceil(length / self.cell)))
        self.blocked = bytearray(self.nx * self.ny)
        self._integral_cache: Optional[List[int]] = None
        self._mask_cache: Dict[float, bytearray] = {}

    # -- indexing ----------------------------------------------------------- #
    def index(self, ix: int, iy: int) -> int:
        return iy * self.nx + ix

    def cell_center(self, ix: int, iy: int) -> Tuple[float, float]:
        return ((ix + 0.5) * self.cell, (iy + 0.5) * self.cell)

    def cell_of(self, point) -> Tuple[int, int]:
        ix = int(min(max(point[0] / self.cell, 0), self.nx - 1))
        iy = int(min(max(point[1] / self.cell, 0), self.ny - 1))
        return ix, iy

    def in_bounds(self, ix: int, iy: int) -> bool:
        return 0 <= ix < self.nx and 0 <= iy < self.ny

    # -- marking ------------------------------------------------------------ #
    @staticmethod
    def _is_axis_rect(part) -> bool:
        """Fast path: an axis-aligned rectangle needs no point-in-polygon test."""
        pts = part.points
        if len(pts) != 4:
            return False
        xs = {round(p[0], 6) for p in pts}
        ys = {round(p[1], 6) for p in pts}
        return len(xs) == 2 and len(ys) == 2

    def mark_shape(self, shape: Shape) -> None:
        """Block every cell whose centre falls inside `shape`."""
        for part in shape.parts:
            x0, y0, x1, y1 = part.bounds
            ix0 = max(0, int(x0 / self.cell))
            ix1 = min(self.nx - 1, int(x1 / self.cell))
            iy0 = max(0, int(y0 / self.cell))
            iy1 = min(self.ny - 1, int(y1 / self.cell))
            if ix1 < ix0 or iy1 < iy0:
                continue
            if self._is_axis_rect(part):
                half = self.cell * 0.5
                ix0 = max(0, int((x0 - half) / self.cell) + 1)
                ix1 = min(self.nx - 1, int((x1 - half) / self.cell))
                iy0 = max(0, int((y0 - half) / self.cell) + 1)
                iy1 = min(self.ny - 1, int((y1 - half) / self.cell))
                for iy in range(iy0, iy1 + 1):
                    row = iy * self.nx
                    self.blocked[row + ix0: row + ix1 + 1] = bytes([1]) * (ix1 - ix0 + 1)
                continue
            for iy in range(iy0, iy1 + 1):
                for ix in range(ix0, ix1 + 1):
                    idx = self.index(ix, iy)
                    if self.blocked[idx]:
                        continue
                    if part.contains_point(self.cell_center(ix, iy), tol=1e-9):
                        self.blocked[idx] = 1

    def mark_rect(self, rect: Rect) -> None:
        self.mark_shape(Shape.of(rect))

    def copy(self) -> "OccupancyGrid":
        clone = OccupancyGrid(self.width, self.length, self.cell)
        clone.blocked = bytearray(self.blocked)
        return clone

    # -- measurement -------------------------------------------------------- #
    @property
    def cell_area(self) -> float:
        return self.cell * self.cell

    def free_area(self) -> float:
        return (len(self.blocked) - sum(self.blocked)) * self.cell_area

    def blocked_area(self) -> float:
        return sum(self.blocked) * self.cell_area

    # -- passability -------------------------------------------------------- #
    def _integral(self) -> List[int]:
        """Summed-area table of the blocked mask, built once per query."""
        if self._integral_cache is not None:
            return self._integral_cache
        nx, ny = self.nx, self.ny
        table = [0] * ((nx + 1) * (ny + 1))
        for iy in range(ny):
            row_sum = 0
            base = iy * nx
            out_row = (iy + 1) * (nx + 1)
            prev_row = iy * (nx + 1)
            for ix in range(nx):
                row_sum += self.blocked[base + ix]
                table[out_row + ix + 1] = table[prev_row + ix + 1] + row_sum
        self._integral_cache = table
        return table

    def passable_mask(self, clearance_width: float) -> bytearray:
        """Cells where a `clearance_width` square fits entirely in free space.

        Implemented with a summed-area table, so the whole mask costs O(cells)
        no matter how wide the clearance is.  A square is a slightly stricter
        test than a disc, which errs on the safe side.
        """
        key = round(clearance_width, 3)
        cached = self._mask_cache.get(key)
        if cached is not None:
            return cached
        r = max(0, int(round(clearance_width / 2.0 / self.cell - 0.5)))
        table = self._integral()
        nx, ny = self.nx, self.ny
        stride = nx + 1
        mask = bytearray(nx * ny)
        for iy in range(r, ny - r):
            row = iy * nx
            y0, y1 = iy - r, iy + r + 1
            top = y0 * stride
            bottom = y1 * stride
            for ix in range(r, nx - r):
                x0, x1 = ix - r, ix + r + 1
                total = (
                    table[bottom + x1] - table[bottom + x0] - table[top + x1] + table[top + x0]
                )
                if total == 0:
                    mask[row + ix] = 1
        self._mask_cache[key] = mask
        return mask

    def nearest_passable(self, point, mask: bytearray, search_cells: int = 6) -> Optional[Tuple[int, int]]:
        sx, sy = self.cell_of(point)
        if mask[self.index(sx, sy)]:
            return (sx, sy)
        for ring in range(1, search_cells + 1):
            best = None
            best_d = None
            for dy in range(-ring, ring + 1):
                for dx in range(-ring, ring + 1):
                    if max(abs(dx), abs(dy)) != ring:
                        continue
                    jx, jy = sx + dx, sy + dy
                    if self.in_bounds(jx, jy) and mask[self.index(jx, jy)]:
                        d = dx * dx + dy * dy
                        if best_d is None or d < best_d:
                            best_d, best = d, (jx, jy)
            if best is not None:
                return best
        return None

    def reachable_from(self, start, mask: bytearray) -> Optional[bytearray]:
        """Flood fill of `mask` from `start`; None when the start itself is blocked."""
        origin = self.nearest_passable(start, mask)
        if origin is None:
            return None
        seen = bytearray(self.nx * self.ny)
        seen[self.index(*origin)] = 1
        queue = deque([origin])
        while queue:
            ix, iy = queue.popleft()
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                jx, jy = ix + dx, iy + dy
                if not self.in_bounds(jx, jy):
                    continue
                idx = self.index(jx, jy)
                if seen[idx] or not mask[idx]:
                    continue
                seen[idx] = 1
                queue.append((jx, jy))
        return seen

    def path_exists(self, start, target, mask: bytearray, reach: bytearray = None) -> bool:
        if reach is None:
            reach = self.reachable_from(start, mask)
        if reach is None:
            return False
        goal = self.nearest_passable(target, mask, search_cells=8)
        if goal is None:
            return False
        return bool(reach[self.index(*goal)])

    def reachable_area(self, reach: Optional[bytearray]) -> float:
        if reach is None:
            return 0.0
        return sum(reach) * self.cell_area

    def largest_free_square_side(self) -> float:
        """Side of the largest free square - a cheap 'is the middle open' probe."""
        prev = [0] * self.nx
        best = 0
        for iy in range(self.ny):
            row = [0] * self.nx
            for ix in range(self.nx):
                if self.blocked[self.index(ix, iy)]:
                    continue
                if ix == 0 or iy == 0:
                    row[ix] = 1
                else:
                    row[ix] = 1 + min(prev[ix], row[ix - 1], prev[ix - 1])
                if row[ix] > best:
                    best = row[ix]
            prev = row
        return best * self.cell
