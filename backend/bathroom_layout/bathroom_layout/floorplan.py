"""
Floor-plan detector output -> a bathroom shell in millimetres.

The wall detector reports a room as a bounding box and every door and window on
the plan as a thin box lying in the wall it belongs to, all in image pixels.
This module turns that into a `Room` with `Door`s and `Window`s:

1. keep only the openings that actually lie on one of this room's four walls;
2. recover the real-world scale;
3. convert each opening to a position along its wall;
4. decide which door is the bathroom entrance.

Image axes run x -> right, y -> **down**; the engine's y runs south -> north,
so the top of the image is the north wall.

Two things a plan does not say are assumed, and reported in the notes:

* which way a door opens - taken as inward, the usual case for a bathroom;
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
#: an opening thinner than this after clamping is not worth carrying
MIN_OPENING_WIDTH = 300.0
#: rooms a second bathroom door usually leads to - never the bathroom entrance
SECONDARY_ROOM = re.compile(r"closet|dress|wardrobe|stor|balcon|terrace", re.I)

Box = Tuple[float, float, float, float]   # x1, y1, x2, y2 in image pixels


class InputError(ValueError):
    """Raised when the request is malformed or physically impossible."""


@dataclass
class Shell:
    """A bathroom ready for the layout engine, plus every assumption made to build it."""

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
            if door["wall"] != window["wall"]:
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
    """The bathroom entrance: not a cupboard or a balcony when there is a choice, then the widest."""
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
    """Convert a request (room box + plan detections, in pixels) into a bathroom shell."""
    room_in = payload.get("room") or {}
    if not room_in.get("bbox"):
        raise InputError("room.bbox is required")
    room_box = _box(room_in["bbox"], "room.bbox")
    left, top, right, bottom = room_box
    width_px, height_px = right - left, bottom - top
    if width_px <= 0 or height_px <= 0:
        raise InputError("room.bbox has zero or negative size")

    notes: List[str] = []
    tol = min(max(margin_ratio * min(width_px, height_px), margin_min), margin_max)

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
        hit = _on_wall(box, room_box, tol)
        if hit is None:
            continue
        wall, lo, hi = hit
        found[kind].append({
            "id": str(det.get("id") or "{}_{}".format(kind, index + 1)),
            "wall": wall, "lo": lo, "hi": hi, "box": box,
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

    room = Room(
        width=round(width_px * scale, 1),
        length=round(height_px * scale, 1),
        height=float(payload.get("room_height") or 2800.0),
        name=str(room_in.get("name") or "Bathroom"),
    )

    def convert(items: List[Dict], kind: str) -> List[Dict]:
        openings = []
        for item in items:
            wall = item["wall"]
            start = (item["lo"] - left) if wall in ("north", "south") else (bottom - item["hi"])
            wall_length = room.wall_length(wall)
            width = min(max((item["hi"] - item["lo"]) * scale, MIN_OPENING_WIDTH), wall_length)
            position = min(max(start * scale, 0.0), wall_length - width)
            openings.append(dict(item, position=position, width=width, sources=[item["id"]]))
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
        ))
    _pick_entrance(doors)

    windows = [
        Window(id=spec["id"], wall=spec["wall"], position=round(spec["position"], 1), width=round(spec["width"], 1),
               sill_height=float(payload.get("sill_height") or 900.0))
        for spec in window_specs
    ]

    if not doors:
        notes.append(
            "No door was detected on this room's walls, so the rules about the entrance and the walking "
            "paths (1 and 4) could not be applied.")
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
            notes.append("Door {} was taken as the bathroom entrance{}.".format(
                main.id, " (it leads to {})".format(main.leads_to) if main.leads_to else ""))

    return Shell(
        room=room, doors=doors, windows=windows,
        scale_mm_per_px=scale, scale_source=scale_source,
        doors_used=[s for spec in door_specs for s in spec["sources"]],
        windows_used=[s for spec in window_specs for s in spec["sources"]],
        notes=notes,
    )
