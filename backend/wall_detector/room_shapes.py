"""
Room outlines traced from the walls, so an L-shaped room comes back as an L
instead of its full bounding box.

YOLO only gives each room as an axis-aligned box. For anything that isn't a
plain rectangle that box spills into the neighbouring rooms, so the overlays
overlap. Here the real outline is recovered from the drawing itself:

1. Walls: the thick dark strokes. A morphological opening sized to the wall
   thickness drops thin lines (text, furniture, door swings, dimensions).
2. Doorways: doors and windows leave gaps in the walls. Inside every YOLO
   Door / Window box the wall stubs either side are bridged, so each room is
   fully closed.
3. Regions: every closed area between walls gets its own label (a flood fill,
   like the paint-bucket tool). Areas touching the image edge are outside.
4. Matching: each YOLO Room box takes the region that fills most of it,
   clipped to the box so a leaky doorway can't drag in a neighbour.
5. Outline: the region's edge is traced and simplified to its corners, with
   near-horizontal / near-vertical edges squared up. An L room gives 6
   corners instead of 4.

Any room whose outline can't be trusted keeps its plain box (shapeSource
"bbox"), so this never does worse than before.
"""

from __future__ import annotations

import cv2
import numpy as np

# A matched region must cover at least this much of its room's box ...
MIN_BOX_COVERAGE = 0.35
# Wall pixels are at most this many grey levels lighter than the wall tone.
WALL_TONE_MARGIN = 45
# Box grown by this fraction of its size before clipping, since YOLO boxes
# are a little loose / tight around the walls.
BOX_PAD = 0.04
# Edges within this many degrees of horizontal / vertical are squared up.
SNAP_DEGREES = 12.0


def _dark_mask(gray: np.ndarray) -> np.ndarray:
    """Ink pixels (walls, lines, text) as 255, paper as 0."""
    # Otsu picks the ink / paper split per image; clamp it so a plan with a
    # tinted background or grey hatching doesn't swallow everything.
    otsu, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    thresh = min(max(otsu, 60.0), 170.0)
    _, mask = cv2.threshold(gray, thresh, 255, cv2.THRESH_BINARY_INV)
    return mask


def _wall_thickness(dark: np.ndarray, wall_boxes: list[dict]) -> float:
    """Typical wall thickness in pixels."""
    # A YOLO Wall box's short side is the wall's thickness (plus a little slack).
    sides = sorted(
        min(b["x2"] - b["x1"], b["y2"] - b["y1"])
        for b in wall_boxes
        if min(b["x2"] - b["x1"], b["y2"] - b["y1"]) > 1
    )
    if sides:
        # lower half: long walls drawn at a slant inflate the short side
        return float(np.median(sides[: max(1, len(sides) // 2)]))
    # No wall boxes: the thickest strokes in the drawing are the walls. Twice
    # the distance-transform ridge value is a stroke's width.
    dist = cv2.distanceTransform(dark, cv2.DIST_L2, 3)
    ridge = dist[dist > 1.0]
    return float(np.percentile(ridge, 95) * 2) if ridge.size else 6.0


def _wall_mask(gray: np.ndarray, dark: np.ndarray, thickness: float) -> np.ndarray:
    """Keep only strokes about as thick as a wall, and as dark."""
    # An opening with a square a bit under half the wall thickness wipes out
    # anything thinner, then restores the walls to (nearly) full size.
    k = int(max(2, round(thickness * 0.45)))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    walls = cv2.morphologyEx(dark, cv2.MORPH_OPEN, kernel)
    # Solid furniture (a grey bed, a filled worktop) is thick too, but walls
    # are drawn in the plan's darkest heavy tone. The commonest grey among
    # the thick strokes is that wall tone; anything much lighter is dropped.
    thick = gray[walls > 0]
    if thick.size:
        tone = int(np.bincount(thick, minlength=256).argmax())
        walls[gray > tone + WALL_TONE_MARGIN] = 0
        walls = cv2.morphologyEx(walls, cv2.MORPH_OPEN, kernel)
    # Bridge the hairline gaps opening leaves at joints.
    j = int(max(3, round(thickness * 0.6)))
    return cv2.morphologyEx(walls, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (j, j)))


def _close_openings(walls: np.ndarray, openings: list[dict], thickness: float) -> None:
    """Bridge the wall gap inside each door / window box (in place)."""
    h, w = walls.shape
    pad = int(round(thickness))
    for b in openings:
        x1 = int(max(0, b["x1"] - pad))
        y1 = int(max(0, b["y1"] - pad))
        x2 = int(min(w, b["x2"] + pad))
        y2 = int(min(h, b["y2"] + pad))
        if x2 - x1 < 3 or y2 - y1 < 3:
            continue
        roi = walls[y1:y2, x1:x2]
        # A closing along each axis, as long as the box, joins the wall stubs
        # either side of the gap with a strip exactly as thick as the wall.
        # It can only fill between wall pixels in the same row / column, so it
        # doesn't paint over the room itself.
        span_x = x2 - x1 + 1
        span_y = y2 - y1 + 1
        horiz = cv2.morphologyEx(roi, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (span_x, 1)))
        vert = cv2.morphologyEx(roi, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (1, span_y)))
        np.maximum(roi, np.maximum(horiz, vert), out=roi)


def _footprint(walls: np.ndarray, openings: list[dict]) -> np.ndarray:
    """The building's footprint: True inside the outer walls."""
    # Rooms reach the outside through any opening YOLO missed (a bay window,
    # a front door). Closing the walls with a square wider than the widest
    # opening seals the outer shell; a flood fill from the image edge then
    # finds the true outside, while the rooms themselves keep the plain wall
    # mask, so their outlines aren't affected.
    h, w = walls.shape
    spans = [max(b["x2"] - b["x1"], b["y2"] - b["y1"]) for b in openings]
    k = int(max(max(spans, default=0) * 1.3, min(h, w) * 0.05, 9))
    shell = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    # Border padding so the flood fill can get round the whole plan.
    padded = cv2.copyMakeBorder(shell, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    mask = np.zeros((h + 4, w + 4), dtype=np.uint8)
    cv2.floodFill(padded, mask, (0, 0), 128)
    return padded[1:-1, 1:-1] != 128


def _orthogonalize(pts: np.ndarray) -> np.ndarray:
    """Square up near-axis edges and drop the points that become redundant."""
    pts = pts.astype(np.float64).copy()
    n = len(pts)
    tan_snap = np.tan(np.radians(SNAP_DEGREES))
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        dx, dy = abs(b[0] - a[0]), abs(b[1] - a[1])
        if dy <= dx * tan_snap:  # near horizontal: share one y
            y = (a[1] + b[1]) / 2
            a[1] = b[1] = y
        elif dx <= dy * tan_snap:  # near vertical: share one x
            x = (a[0] + b[0]) / 2
            a[0] = b[0] = x

    return _tidy(pts)


def _tidy(pts: np.ndarray) -> np.ndarray:
    """Drop duplicate points and points in the middle of a straight run."""
    out: list[np.ndarray] = []
    n = len(pts)
    for i in range(n):
        prev = out[-1] if out else pts[i - 1]
        cur, nxt = pts[i], pts[(i + 1) % n]
        if np.allclose(cur, prev, atol=0.5):
            continue
        cross = (cur[0] - prev[0]) * (nxt[1] - cur[1]) - (cur[1] - prev[1]) * (nxt[0] - cur[0])
        if abs(cross) < 1e-6:
            continue
        out.append(cur)
    return np.array(out) if len(out) >= 3 else pts


def _drop_steps(pts: np.ndarray, max_step: float) -> np.ndarray:
    """Flatten short steps in the outline onto the longer wall beside them.

    Where a door or window breaks a wall, the room's area pokes a wall's
    thickness into the gap. That bump is as wide as the opening, so the
    smoothing can't remove it, and the outline gets a small notch or tab.
    Any step (a short edge between two parallel edges) shallower than
    max_step is removed by moving the shorter of those two edges in line
    with the longer one. A real L-shaped step is many walls deep and stays.
    """
    pts = pts.copy()
    for _ in range(4 * len(pts)):
        n = len(pts)
        if n <= 4:
            break
        for i in range(n):
            a, b, c, d = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
            step = c - b
            if abs(step[0]) < 1e-6 and 0 < abs(step[1]) < max_step:
                axis = 1  # vertical step between two horizontal edges
            elif abs(step[1]) < 1e-6 and 0 < abs(step[0]) < max_step:
                axis = 0  # horizontal step between two vertical edges
            else:
                continue
            other = 1 - axis
            if abs(a[axis] - b[axis]) > 1e-6 or abs(c[axis] - d[axis]) > 1e-6:
                continue  # not a step: a neighbouring edge isn't parallel
            if abs(b[other] - a[other]) >= abs(d[other] - c[other]):
                c[axis] = d[axis] = b[axis]
            else:
                a[axis] = b[axis] = c[axis]
            pts = _tidy(pts)
            break
        else:
            break
    return pts


def _trace(mask: np.ndarray, thickness: float) -> np.ndarray | None:
    """Outline of the largest blob in a mask, simplified to its corners."""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    # Tolerance ~ half a wall: small notches (a door jamb, a radiator) vanish,
    # a real L-shaped step, which is far bigger than a wall, survives.
    eps = max(2.0, thickness * 0.5, cv2.arcLength(contour, True) * 0.004)
    approx = cv2.approxPolyDP(contour, eps, True).reshape(-1, 2)
    if len(approx) < 3:
        return None
    return _drop_steps(_orthogonalize(approx), thickness * 1.6)


def trace_room_shapes(
    image_rgb: np.ndarray,
    rooms: list[dict],
    walls: list[dict],
    openings: list[dict],
) -> list[dict | None]:
    """Outline for each room box, in the order given.

    rooms / walls / openings are YOLO boxes ({x1, y1, x2, y2}, pixels). Each
    result is {"polygon": [[x, y], ...], "areaPx": float}, or None when the
    room's outline couldn't be recovered and the box should be used instead.
    """
    if not rooms:
        return []
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    h, w = gray.shape
    dark = _dark_mask(gray)
    thickness = _wall_thickness(dark, walls)
    wall_px = _wall_mask(gray, dark, thickness)
    _close_openings(wall_px, openings, thickness)

    free = cv2.bitwise_not(wall_px)
    # The outer shell uses all the ink, not just the walls: windows are drawn
    # as thin lines, and those still mark where the building ends.
    free[~_footprint(np.maximum(wall_px, dark), openings)] = 0
    n_labels, labels = cv2.connectedComponents(free, connectivity=4)

    outside = np.zeros(n_labels, dtype=bool)
    outside[0] = True  # label 0 is the walls and everything outside the building

    # Pick a region for each room.
    picks: list[tuple[int, tuple[int, int, int, int]] | None] = []
    for r in rooms:
        bw, bh = r["x2"] - r["x1"], r["y2"] - r["y1"]
        x1 = int(max(0, r["x1"] - bw * BOX_PAD))
        y1 = int(max(0, r["y1"] - bh * BOX_PAD))
        x2 = int(min(w, r["x2"] + bw * BOX_PAD))
        y2 = int(min(h, r["y2"] + bh * BOX_PAD))
        if x2 - x1 < 4 or y2 - y1 < 4:
            picks.append(None)
            continue
        inside = np.bincount(labels[y1:y2, x1:x2].ravel(), minlength=n_labels)
        inside[outside] = 0
        best = int(inside.argmax())
        if inside[best] / max(1.0, bw * bh) < MIN_BOX_COVERAGE:
            picks.append(None)
            continue
        picks.append((best, (x1, y1, x2, y2)))

    # Each room's pixels: its region, clipped to its (padded) box.
    masks: list[np.ndarray | None] = []
    for pick in picks:
        if pick is None:
            masks.append(None)
            continue
        label, (x1, y1, x2, y2) = pick
        m = np.zeros((h, w), dtype=np.uint8)
        m[y1:y2, x1:x2] = (labels[y1:y2, x1:x2] == label).astype(np.uint8) * 255
        masks.append(m)

    # One region can be claimed by several room boxes: an open-plan living +
    # dining with no wall between them, or a doorway YOLO missed so two rooms
    # leak into each other. Pixels in more than one box go to the smallest
    # box, the most specific claim: a room nested in an L room's bounding box
    # keeps its own floor, and the L room keeps the rest.
    order = sorted(
        (i for i in range(len(rooms)) if masks[i] is not None),
        key=lambda i: (rooms[i]["x2"] - rooms[i]["x1"]) * (rooms[i]["y2"] - rooms[i]["y1"]),
    )
    claimed = np.zeros((h, w), dtype=bool)
    for i in order:
        masks[i][claimed] = 0
        claimed |= masks[i] > 0

    # Smoothing: an opening then a closing, two walls thick, trims the tabs
    # that poke into door gaps and window recesses and fills small notches,
    # so the outline follows the room rather than every jamb. Any real room
    # or corridor is far wider than that, so it survives untouched.
    k = int(max(3, round(thickness * 2)))
    smooth = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))

    out: list[dict | None] = []
    for r, m in zip(rooms, masks):
        if m is None:
            out.append(None)
            continue
        m = cv2.morphologyEx(cv2.morphologyEx(m, cv2.MORPH_OPEN, smooth), cv2.MORPH_CLOSE, smooth)
        poly = _trace(m, thickness)
        if poly is None:
            out.append(None)
            continue
        area = float(cv2.contourArea(poly.astype(np.float32)))
        box_area = max(1.0, (r["x2"] - r["x1"]) * (r["y2"] - r["y1"]))
        if area / box_area < MIN_BOX_COVERAGE:
            out.append(None)
            continue
        out.append(
            {
                "polygon": [[round(float(x), 1), round(float(y), 1)] for x, y in poly],
                "areaPx": round(area, 2),
            }
        )
    return out
