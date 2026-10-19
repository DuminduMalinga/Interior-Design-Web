"""
Floor-plan detector output -> a dining-area shell in millimetres.

The wall detector reports a room as a bounding box and every door and window on
the plan as a thin box lying in the wall it belongs to, all in image pixels.
This module turns that into a `Room` with `Door`s and `Window`s:

1. keep only the openings that actually lie on one of this room's four walls;
2. recover the real-world scale;
3. convert each opening to a position along its wall;
4. decide which door is the main entrance.

Image axes run x -> right, y -> **down**; the engine's y runs south -> north,
so the top of the image is the north wall.

Two things a plan does not say are assumed, and reported in the notes:

* which way a door opens - taken as inward, the case that costs the most floor;
* which jamb it is hinged on - taken as the one nearer a corner, so the leaf
  opens against the side wall. Only the drawing depends on this guess: the
  engine keeps the whole door-width square clear, which covers either jamb.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .room import Door, Room, Window

#: a standard single door leaf - used to recover the scale when none is given
STANDARD_DOOR_WIDTH = 900.0
#: a cut-out of a non-rectangular room narrower than this (mm) is outline noise, not a notch
MIN_CUTOUT = 250.0
#: a room's printed size is used only within this factor of the plan's scale
PRINTED_SIZE_TOLERANCE = 1.5
#: an opening thinner than this after clamping is not worth carrying
MIN_OPENING_WIDTH = 300.0
#: rooms a second door usually leads to - never the main entrance
SECONDARY_ROOM = re.compile(r"closet|dress|wardrobe|stor|balcon|terrace", re.I)

Box = Tuple[float, float, float, float]   # x1, y1, x2, y2 in image pixels


class InputError(ValueError):
    """Raised when the request is malformed or physically impossible."""


@dataclass
class Shell:
    """A dining area ready for the layout engine, plus every assumption made to build it."""

    room: Room
    doors: List[Door]
    windows: List[Window]
    scale_mm_per_px: float
    scale_source: str                    # "provided" | "door" | "default"
    doors_used: List[str] = field(default_factory=list)
    windows_used: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)


def _box(raw, what: str) -> Box:
    try:
        x1, x2 = sorted((float(raw["x1"]), float(raw["x2"])))
        y1, y2 = sorted((float(raw["y1"]), float(raw["y2"])))
    except (KeyError, TypeError, ValueError):
        raise InputError("{} needs numeric x1, y1, x2, y2".format(what))
    return (x1, y1, x2, y2)


def _outline(raw) -> Optional[List[Tuple[float, float]]]:
    """The room's traced outline (image pixels), when the request carries a usable one."""
    try:
        points = [(float(p[0]), float(p[1])) for p in raw or []]
    except (TypeError, ValueError, IndexError):
        return None
    return points if len(points) >= 3 else None


def _inside(x: float, y: float, outline: List[Tuple[float, float]]) -> bool:
    """Point-in-polygon, by counting edge crossings of a ray to the right."""
    hit = False
    for (ax, ay), (bx, by) in zip(outline, outline[1:] + outline[:1]):
        if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
            hit = not hit
    return hit


def _cutouts_px(outline: List[Tuple[float, float]], box: Box) -> List[Box]:
    """The parts of the outline's bounding box that lie outside the outline, as rectangles.

    The box is cut into a grid along every corner's x and y; a cell whose
    centre is outside the outline is not floor. Cells are joined into runs
    along each row, then runs with the same span are stacked, so an L-shaped
    room comes out as one rectangle. A slanted edge (a bay window) is
    followed to the nearest grid line.
    """
    left, top, right, bottom = box
    xs = sorted({min(max(x, left), right) for x, _ in outline} | {left, right})
    ys = sorted({min(max(y, top), bottom) for _, y in outline} | {top, bottom})
    rows: List[List[Box]] = []
    for y0, y1 in zip(ys, ys[1:]):
        runs: List[Box] = []
        for x0, x1 in zip(xs, xs[1:]):
            if _inside((x0 + x1) / 2.0, (y0 + y1) / 2.0, outline):
                continue
            if runs and runs[-1][2] == x0:
                runs[-1] = (runs[-1][0], y0, x1, y1)
            else:
                runs.append((x0, y0, x1, y1))
        rows.append(runs)
    done: List[Box] = []
    open_runs: List[Box] = []
    for runs in rows:
        still: List[Box] = []
        for run in runs:
            above = next((o for o in open_runs if o[0] == run[0] and o[2] == run[2] and o[3] == run[1]), None)
            if above is not None:
                open_runs.remove(above)
                still.append((above[0], above[1], above[2], run[3]))
            else:
                still.append(run)
        done += open_runs
        open_runs = still
    return done + open_runs


def _notch_edges(cutouts: List[Box], room_box: Box) -> List[Tuple[str, float, bool, float, float, float, int]]:
    """The walls round each notch, in image pixels.

    Each is (the outer wall it runs parallel to and faces the same way as,
    its line, horizontal?, low end, high end, inset from that outer wall's
    line, index of its cut-out). A notch at the bottom-left of the box has a
    top edge facing north into the room, like the south wall, set back from
    it by the notch's depth.
    """
    left, top, right, bottom = room_box
    edges = []
    for index, (x1, y1, x2, y2) in enumerate(cutouts):
        if y1 > top + 1.0:
            edges.append(("south", y1, True, x1, x2, bottom - y1, index))
        if y2 < bottom - 1.0:
            edges.append(("north", y2, True, x1, x2, y2 - top, index))
        if x1 > left + 1.0:
            edges.append(("east", x1, False, y1, y2, right - x1, index))
        if x2 < right - 1.0:
            edges.append(("west", x2, False, y1, y2, x2 - left, index))
    return edges


def _on_notch(box: Box, edges, tol: float) -> Optional[Tuple[str, float, float, float, int]]:
    """The notch wall an opening lies on: (outer wall, clamped low, high, inset px, cut-out index)."""
    x1, y1, x2, y2 = box
    best = None
    for wall, line, horizontal, e_lo, e_hi, inset, index in edges:
        if horizontal:
            off = 0.0 if y1 <= line <= y2 else min(abs(y1 - line), abs(y2 - line))
            lo, hi, length, cross = max(x1, e_lo), min(x2, e_hi), x2 - x1, y2 - y1
        else:
            off = 0.0 if x1 <= line <= x2 else min(abs(x1 - line), abs(x2 - line))
            lo, hi, length, cross = max(y1, e_lo), min(y2, e_hi), y2 - y1, x2 - x1
        if off > tol or length <= 0 or cross > 1.5 * length or hi - lo < 0.5 * length:
            continue
        rank = (off, -(hi - lo))
        if best is None or rank < best[0]:
            best = (rank, wall, lo, hi, inset, index)
    return best[1:] if best else None


def _in_notch(room: Room, wall: str, start: float, end: float) -> bool:
    """True when an opening on the box's `wall` sits where a cut-out reaches that wall.

    There is no wall of this room there - the line belongs to the room next
    door, so a door or window found on it is that room's, not this one's.
    """
    middle = (start + end) / 2.0
    for x0, y0, x1, y1 in room.cutouts:
        if wall in ("north", "south"):
            reaches = y1 >= room.length - 1.0 if wall == "north" else y0 <= 1.0
            if reaches and x0 <= middle <= x1:
                return True
        else:
            reaches = x1 >= room.width - 1.0 if wall == "east" else x0 <= 1.0
            if reaches and y0 <= middle <= y1:
                return True
    return False


def _on_wall(box: Box, room_box: Box, tol: float) -> Optional[Tuple[str, float, float]]:
    """The wall of the room rectangle an opening lies on, and its clamped pixel span.

    An opening runs *along* its wall, so a box that is clearly longer one way
    can only belong to the two walls parallel to it; among the walls left, the
    one whose line the box sits on (or nearest to) wins.
    """
    left, top, right, bottom = room_box
    x1, y1, x2, y2 = box
    best = None
    for wall, line, horizontal in (
        ("north", top, True), ("south", bottom, True), ("west", left, False), ("east", right, False)
    ):
        if horizontal:
            off = 0.0 if y1 <= line <= y2 else min(abs(y1 - line), abs(y2 - line))
            lo, hi, length, cross = max(x1, left), min(x2, right), x2 - x1, y2 - y1
        else:
            off = 0.0 if x1 <= line <= x2 else min(abs(x1 - line), abs(x2 - line))
            lo, hi, length, cross = max(y1, top), min(y2, bottom), y2 - y1, x2 - x1
        if off > tol or length <= 0 or cross > 1.5 * length or hi - lo < 0.5 * length:
            continue
        rank = (off, -(hi - lo))
        if best is None or rank < best[0]:
            best = (rank, wall, lo, hi)
    return best[1:] if best else None


def _merge(openings: List[Dict], kind: str, notes: List[str]) -> List[Dict]:
    """Fold overlapping detections of one kind on one wall into a single opening."""
    merged: List[Dict] = []
    for opening in sorted(openings, key=lambda o: (o["wall"], o["position"])):
        previous = merged[-1] if merged else None
        if (previous is not None and previous["wall"] == opening["wall"]
                and abs(previous["inset"] - opening["inset"]) < 1.0
                and opening["position"] < previous["position"] + previous["width"] - 1.0):
            end = max(previous["position"] + previous["width"], opening["position"] + opening["width"])
            previous["width"] = end - previous["position"]
            previous["sources"] += opening["sources"]
            notes.append("{} '{}' overlaps '{}' on the {} wall; merged into one {:.0f} mm opening".format(
                kind, opening["id"], previous["id"], previous["wall"], previous["width"]))
        else:
            merged.append(opening)
    return merged


def _clear_of_doors(windows: List[Dict], doors: List[Dict], notes: List[str]) -> List[Dict]:
    """Trim - or drop - any window a door overlaps; the door has priority."""
    kept: List[Dict] = []
    for window in windows:
        start, end = window["position"], window["position"] + window["width"]
        for door in doors:
            if door["wall"] != window["wall"] or abs(door["inset"] - window["inset"]) >= 1.0:
                continue
            d0, d1 = door["position"], door["position"] + door["width"]
            if d1 <= start + 1.0 or d0 >= end - 1.0:
                continue
            before, after = (start, min(end, d0)), (max(start, d1), end)
            start, end = before if (before[1] - before[0]) >= (after[1] - after[0]) else after
        if end - start < MIN_OPENING_WIDTH:
            notes.append("window '{}' is covered by a door on the {} wall; dropped".format(
                window["id"], window["wall"]))
            continue
        window["position"], window["width"] = start, end - start
        kept.append(window)
    return kept


def _neighbour(box: Box, room_id, rooms: List[Dict], tol: float) -> Optional[str]:
    """Name of the other room a door opens on to, when the caller sent the room list."""
    best_name, best_overlap = None, 0.0
    for other in rooms:
        if other.get("id") == room_id or not other.get("bbox"):
            continue
        try:
            ox1, oy1, ox2, oy2 = _box(other["bbox"], "room")
        except InputError:
            continue
        w = min(box[2], ox2 + tol) - max(box[0], ox1 - tol)
        h = min(box[3], oy2 + tol) - max(box[1], oy1 - tol)
        if w > 0 and h > 0 and w * h > best_overlap:
            best_name, best_overlap = other.get("name") or other.get("id"), w * h
    return best_name


def _pick_entrance(doors: List[Door]) -> None:
    """The main entrance: not a cupboard or a balcony when there is a choice, then the widest."""
    if not doors or any(d.is_main for d in doors):
        return
    ranked = sorted(
        doors,
        key=lambda d: (bool(d.leads_to and SECONDARY_ROOM.search(d.leads_to)), -round(d.width), d.wall, d.position),
    )
    ranked[0].is_main = True


def build_shell(
    payload: Dict,
    default_mm_per_px: float = 20.0,
    margin_ratio: float = 0.08,
    margin_min: float = 10.0,
    margin_max: float = 60.0,
) -> Shell:
    """Convert a request (room box + plan detections, in pixels) into a dining-area shell."""
    room_in = payload.get("room") or {}
    if not room_in.get("bbox"):
        raise InputError("room.bbox is required")
    # A traced outline (sent for an L-shaped room, say) is the better
    # boundary: the room is built on the outline's bounding box, and whatever
    # of that box lies outside the outline is cut out of the floor below.
    outline = _outline(room_in.get("polygon"))
    if outline:
        xs, ys = [x for x, _ in outline], [y for _, y in outline]
        room_box = (min(xs), min(ys), max(xs), max(ys))
    else:
        room_box = _box(room_in["bbox"], "room.bbox")
    left, top, right, bottom = room_box
    width_px, height_px = right - left, bottom - top
    if width_px <= 0 or height_px <= 0:
        raise InputError("room.bbox has zero or negative size")

    notes: List[str] = []
    tol = min(max(margin_ratio * min(width_px, height_px), margin_min), margin_max)
    cutouts_px = _cutouts_px(outline, room_box) if outline else []
    notch_edges = _notch_edges(cutouts_px, room_box)

    # -- which detections lie on this room's walls? ---------------------------
    plan_door_spans: List[float] = []
    found: Dict[str, List[Dict]] = {"door": [], "window": []}
    for index, det in enumerate(payload.get("detections") or []):
        kind = str(det.get("class", "")).lower()
        if kind not in found or not det.get("bbox"):
            continue
        box = _box(det["bbox"], "{} detection".format(kind))
        if kind == "door":
            plan_door_spans.append(max(box[2] - box[0], box[3] - box[1]))
        notch_hit = _on_notch(box, notch_edges, tol) if notch_edges else None
        if notch_hit is not None:
            wall, lo, hi, inset_px, notch = notch_hit
        else:
            hit = _on_wall(box, room_box, tol)
            if hit is None:
                continue
            (wall, lo, hi), inset_px, notch = hit, 0.0, None
        found[kind].append({
            "id": str(det.get("id") or "{}_{}".format(kind, index + 1)),
            "wall": wall, "lo": lo, "hi": hi, "box": box, "inset_px": inset_px, "notch": notch,
            "swing": det.get("swing"), "hinge": det.get("hinge"),
        })

    # -- scale: caller-provided, recovered from the door leaves, or a default --
    try:
        provided = float(payload.get("scale_m_per_px") or 0.0)
    except (TypeError, ValueError):
        provided = 0.0
    if provided > 0:
        scale, scale_source = provided * 1000.0, "provided"
    elif plan_door_spans:
        spans = sorted(plan_door_spans)
        scale, scale_source = STANDARD_DOOR_WIDTH / spans[len(spans) // 2], "door"
        notes.append(
            "No scale came with the plan; {:.1f} mm per pixel was recovered from the {} detected door{} "
            "(a standard {:.0f} mm leaf).".format(
                scale, len(spans), "" if len(spans) == 1 else "s", STANDARD_DOOR_WIDTH))
    else:
        scale, scale_source = float(default_mm_per_px), "default"
        notes.append(
            "No scale and no door to recover one from; the default of {:.0f} mm per pixel was used, "
            "so the room size is a rough estimate.".format(scale))

    # A room's own printed size ("4 x 5 m"), when the plan has one, is exact:
    # this room's width and length are scaled to it, each on its own, so the
    # layout is planned for the size the plan states. One far off the plan's
    # scale is a misread, and the plan's scale is kept.
    sx = sy = scale
    try:
        width_m = float(room_in.get("width_m") or 0.0)
        length_m = float(room_in.get("length_m") or 0.0)
    except (TypeError, ValueError):
        width_m = length_m = 0.0
    if width_m > 0 and length_m > 0:
        fx, fy = width_m * 1000.0 / width_px, length_m * 1000.0 / height_px
        if all(1.0 / PRINTED_SIZE_TOLERANCE <= f / scale <= PRINTED_SIZE_TOLERANCE for f in (fx, fy)):
            sx, sy = fx, fy
            notes.append("The room is sized to the {:.2f} x {:.2f} m printed on the plan.".format(width_m, length_m))
        else:
            notes.append("The printed size {:.2f} x {:.2f} m does not match the room as drawn; it was "
                         "sized from the plan's scale instead.".format(width_m, length_m))

    # cut-outs in engine millimetres: x from the west wall, y up from the south wall
    cutouts = []
    kept = set()
    for index, (x1, y1, x2, y2) in enumerate(cutouts_px):
        cut = ((x1 - left) * sx, (bottom - y2) * sy, (x2 - left) * sx, (bottom - y1) * sy)
        if min(cut[2] - cut[0], cut[3] - cut[1]) >= MIN_CUTOUT:
            cutouts.append(tuple(round(v, 1) for v in cut))
            kept.add(index)
    if cutouts:
        notes.append(
            "The room is not a plain rectangle: {:.1f} m2 of its {:.1f} x {:.1f} m bounding box is not floor, "
            "so nothing is placed there.".format(
                sum((c[2] - c[0]) * (c[3] - c[1]) for c in cutouts) / 1e6,
                width_px * sx / 1000.0, height_px * sy / 1000.0))

    room = Room(
        width=round(width_px * sx, 1),
        length=round(height_px * sy, 1),
        cutouts=tuple(cutouts),
        height=float(payload.get("room_height") or 2800.0),
        name=str(room_in.get("name") or "Dining area"),
    )

    def convert(items: List[Dict], kind: str) -> List[Dict]:
        openings = []
        for item in items:
            wall = item["wall"]
            start = (item["lo"] - left) if wall in ("north", "south") else (bottom - item["hi"])
            wall_length = room.wall_length(wall)
            # along the wall, and straight out from it (the room may be scaled differently each way)
            along, across = (sx, sy) if wall in ("north", "south") else (sy, sx)
            width = min(max((item["hi"] - item["lo"]) * along, MIN_OPENING_WIDTH), wall_length)
            position = min(max(start * along, 0.0), wall_length - width)
            # set back from the wall line when it is in the wall round a notch
            inset = item["inset_px"] * across if item["notch"] in kept else 0.0
            if not inset and _in_notch(room, wall, position, position + width):
                notes.append("{} '{}' lies where the room's notch meets the {} wall - on the room next door's "
                             "wall, not this one's; left out".format(kind, item["id"], wall))
                continue
            openings.append(dict(item, position=position, width=width, inset=inset, sources=[item["id"]]))
        return _merge(openings, kind, notes)

    door_specs = convert(found["door"], "door")
    window_specs = _clear_of_doors(convert(found["window"], "window"), door_specs, notes)

    doors: List[Door] = []
    neighbours = payload.get("rooms") or []
    for spec in door_specs:
        wall_length = room.wall_length(spec["wall"])
        swing = spec["swing"] if spec["swing"] in ("inward", "outward", "sliding") else None
        hinge = spec["hinge"] if spec["hinge"] in ("left", "right") else None
        position, width = round(spec["position"], 1), round(spec["width"], 1)
        doors.append(Door(
            id=spec["id"], wall=spec["wall"], position=position, width=width,
            swing=swing or "inward",
            hinge=hinge or ("left" if position <= wall_length - (position + width) else "right"),
            swing_known=swing is not None, hinge_known=hinge is not None,
            leads_to=_neighbour(spec["box"], room_in.get("id"), neighbours, tol),
            inset=round(spec["inset"], 1),
        ))
    _pick_entrance(doors)

    windows = [
        Window(id=spec["id"], wall=spec["wall"], position=round(spec["position"], 1), width=round(spec["width"], 1),
               sill_height=float(payload.get("sill_height") or 900.0), inset=round(spec["inset"], 1))
        for spec in window_specs
    ]

    if not doors:
        notes.append(
            "No door was detected on this room's walls, so the rules about the entrance and the walking "
            "walking routes (1, 3 and 9) could not be applied.")
    else:
        assumed = [d.id for d in doors if not d.swing_known]
        if assumed:
            notes.append(
                "The plan does not show which way {} open{}; inward was assumed and the whole area the leaf "
                "could sweep is kept clear.".format(
                    "doors " + ", ".join(assumed) if len(assumed) > 1 else "door " + assumed[0],
                    "" if len(assumed) > 1 else "s"))
        if len(doors) > 1:
            main = next(d for d in doors if d.is_main)
            notes.append("Door {} was taken as the main entrance{}.".format(
                main.id, " (it leads to {})".format(main.leads_to) if main.leads_to else ""))

    return Shell(
        room=room, doors=doors, windows=windows,
        scale_mm_per_px=scale, scale_source=scale_source,
        doors_used=[s for spec in door_specs for s in spec["sources"]],
        windows_used=[s for spec in window_specs for s in spec["sources"]],
        notes=notes,
    )
