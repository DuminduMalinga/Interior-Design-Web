"""
Input parsing and output serialisation.

`load_scenario` turns the input JSON (section 2) into typed model objects and
fails loudly on anything it cannot make sense of, so the rest of the pipeline
can assume valid data.

Two input dialects are accepted: the millimetre schema documented in the README,
and the pixel-space output of the floor-plan detector (`bbox_px` / `scale_m_per_px`
with opening boxes), which `normalise_floorplan` converts into the first before
any parsing happens.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .config import Config
from .models.door import Door
from .models.furniture import FurnitureCatalogue
from .models.room import Room, WALL_NAMES
from .models.window import Window


class InputError(ValueError):
    """Raised when the input JSON is malformed or physically impossible."""


@dataclass
class UserRequirements:
    purpose: str = "family_social"
    preferred_layout: Optional[str] = None
    required_furniture: List[str] = field(default_factory=list)
    optional_furniture: List[str] = field(default_factory=list)
    excluded_furniture: List[str] = field(default_factory=list)
    notes: str = ""

    def to_dict(self) -> Dict:
        return {
            "purpose": self.purpose,
            "preferred_layout": self.preferred_layout,
            "required_furniture": list(self.required_furniture),
            "optional_furniture": list(self.optional_furniture),
            "excluded_furniture": list(self.excluded_furniture),
        }


@dataclass
class Scenario:
    """Everything one run of the generator needs."""

    room: Room
    doors: List[Door]
    windows: List[Window]
    requirements: UserRequirements
    config: Config
    catalogue: FurnitureCatalogue
    name: str = "scenario"
    source_path: Optional[str] = None
    input_doors: List[Dict] = field(default_factory=list)
    input_windows: List[Dict] = field(default_factory=list)

    @property
    def main_door(self) -> Optional[Door]:
        for door in self.doors:
            if door.is_main:
                return door
        return self.doors[0] if self.doors else None


# --------------------------------------------------------------------------- #
# Parsing
# --------------------------------------------------------------------------- #
def _require(data: Dict, key: str, context: str):
    if key not in data:
        raise InputError("missing '{}' in {}".format(key, context))
    return data[key]


def _positive(value, key: str, context: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise InputError("'{}' in {} must be a number".format(key, context))
    if number <= 0:
        raise InputError("'{}' in {} must be positive".format(key, context))
    return number


def _parse_room(data: Dict) -> Room:
    room_data = _require(data, "room", "input")
    width = _positive(_require(room_data, "width", "room"), "width", "room")
    length = _positive(_require(room_data, "length", "room"), "length", "room")
    height = float(room_data.get("height", 2800))
    return Room(width=width, length=length, height=height, name=room_data.get("name", "living_room"))


def _check_opening(kind: str, ident: str, wall: str, start: float, end: float, room: Room):
    if wall not in WALL_NAMES:
        raise InputError(
            "{} '{}' has unknown wall '{}' (expected one of {})".format(kind, ident, wall, ", ".join(WALL_NAMES))
        )
    wall_length = room.wall(wall).length
    if start < -1e-6 or end > wall_length + 1e-6:
        raise InputError(
            "{} '{}' runs from {:.0f} to {:.0f} mm which does not fit the {:.0f} mm {} wall".format(
                kind, ident, start, end, wall_length, wall
            )
        )


def _parse_doors(data: Dict, room: Room) -> List[Door]:
    doors: List[Door] = []
    raw_doors = data.get("doors") or []
    for index, raw in enumerate(raw_doors):
        ident = raw.get("id", "door_{}".format(index + 1))
        wall = _require(raw, "wall", "door '{}'".format(ident))
        position = float(_require(raw, "position", "door '{}'".format(ident)))
        width = _positive(raw.get("width", 900), "width", "door '{}'".format(ident))
        door = Door(
            id=ident,
            wall=wall,
            position=position,
            width=width,
            swing=raw.get("swing", "inward"),
            hinge=raw.get("hinge", "left"),
            is_main=bool(raw.get("is_main", False)),
        )
        _check_opening("door", ident, wall, door.start, door.end, room)
        doors.append(door)
    if doors and not any(d.is_main for d in doors):
        # widest door wins; ties break on input order for determinism
        main = max(doors, key=lambda d: (d.width, -doors.index(d)))
        main.is_main = True
    return doors


def _parse_windows(data: Dict, room: Room) -> List[Window]:
    windows: List[Window] = []
    for index, raw in enumerate(data.get("windows") or []):
        ident = raw.get("id", "window_{}".format(index + 1))
        wall = _require(raw, "wall", "window '{}'".format(ident))
        position = float(_require(raw, "position", "window '{}'".format(ident)))
        window = Window(
            id=ident,
            wall=wall,
            position=position,
            width=_positive(raw.get("width", 1200), "width", "window '{}'".format(ident)),
            height=float(raw.get("height", 1200)),
            sill_height=float(raw.get("sill_height", 900)),
        )
        _check_opening("window", ident, wall, window.start, window.end, room)
        windows.append(window)
    return windows


def _parse_requirements(data: Dict) -> UserRequirements:
    raw = data.get("user_requirements") or {}
    return UserRequirements(
        purpose=raw.get("purpose") or "family_social",
        preferred_layout=raw.get("preferred_layout"),
        required_furniture=list(raw.get("required_furniture") or []),
        optional_furniture=list(raw.get("optional_furniture") or []),
        excluded_furniture=list(raw.get("excluded_furniture") or []),
        notes=raw.get("notes", ""),
    )


def _check_overlapping_openings(doors: List[Door], windows: List[Window]):
    openings = [("door", d.id, d.wall, d.start, d.end) for d in doors]
    openings += [("window", w.id, w.wall, w.start, w.end) for w in windows]
    for i in range(len(openings)):
        for j in range(i + 1, len(openings)):
            k1, i1, w1, s1, e1 = openings[i]
            k2, i2, w2, s2, e2 = openings[j]
            if w1 == w2 and min(e1, e2) - max(s1, s2) > 1.0:
                raise InputError(
                    "{} '{}' and {} '{}' overlap on the {} wall".format(k1, i1, k2, i2, w1)
                )


# --------------------------------------------------------------------------- #
# Floor-plan detector input (pixel space)
# --------------------------------------------------------------------------- #
"""The detector that reads an architectural drawing emits a different shape of
JSON: a room bounding box and axis-aligned opening boxes, all in image pixels,
plus a metres-per-pixel scale.  It is normalised here into the millimetre /
wall-parameter schema above, so nothing downstream has to know it exists.

Image axes run x -> right, y -> **down**; the layout engine's y runs south ->
north, so the top of the image is the north wall.
"""

#: a standard single door leaf - used to recover the scale when it is missing
STANDARD_DOOR_WIDTH = 900.0
#: an opening thinner than this after clamping is not worth carrying
MIN_OPENING_WIDTH = 300.0
#: report when the bounding box and the detector's own area disagree by more
AREA_MISMATCH_RATIO = 0.2
#: an opening further than this fraction of the room from its wall is flagged
WALL_SNAP_WARN_RATIO = 0.1


def _is_floorplan_input(data: Dict) -> bool:
    """True for the pixel-space JSON emitted by the floor-plan detector."""
    return "room" not in data and "bbox_px" in data


def _opening_boxes(data: Dict, key: str) -> List[Dict]:
    boxes = []
    for index, raw in enumerate(data.get(key) or []):
        ident = raw.get("id", "{}_{}".format(key[:-1], index + 1))
        try:
            x1, x2 = sorted((float(raw["x1"]), float(raw["x2"])))
            y1, y2 = sorted((float(raw["y1"]), float(raw["y2"])))
        except (KeyError, TypeError, ValueError):
            raise InputError("{} '{}' needs numeric x1, y1, x2, y2".format(key[:-1], ident))
        boxes.append({"id": ident, "x1": x1, "y1": y1, "x2": x2, "y2": y2})
    return boxes


def _floorplan_scale(data: Dict, doors: List[Dict]) -> float:
    """Millimetres per pixel, from the stated scale or from a door leaf."""
    try:
        scale = float(data.get("scale_m_per_px"))
    except (TypeError, ValueError):
        scale = 0.0
    if scale > 0:
        return scale * 1000.0
    spans = sorted(max(d["x2"] - d["x1"], d["y2"] - d["y1"]) for d in doors)
    if not spans:
        raise InputError("no usable 'scale_m_per_px' and no door to recover the scale from")
    return STANDARD_DOOR_WIDTH / spans[len(spans) // 2]


def _snap_to_wall(box: Dict, bbox: Dict, kind: str, notes: List[str]) -> Dict:
    """Project one pixel box onto the nearest wall of the room rectangle.

    The long side of an opening runs *along* its wall, so the box orientation
    picks the pair of candidate walls and proximity picks which of the two.
    """
    left, right = bbox["left"], bbox["right"]
    top, bottom = bbox["top"], bbox["bottom"]
    cx = (box["x1"] + box["x2"]) / 2.0
    cy = (box["y1"] + box["y2"]) / 2.0
    span_x = box["x2"] - box["x1"]
    span_y = box["y2"] - box["y1"]

    if span_x >= span_y:                       # horizontal box -> north / south wall
        wall = "north" if abs(cy - top) <= abs(cy - bottom) else "south"
        offset = abs(cy - (top if wall == "north" else bottom))
        depth = bottom - top
        start_px, span_px = box["x1"] - left, span_x
    else:                                      # vertical box -> west / east wall
        wall = "west" if abs(cx - left) <= abs(cx - right) else "east"
        offset = abs(cx - (left if wall == "west" else right))
        depth = right - left
        start_px, span_px = bottom - box["y2"], span_y   # west/east run from the south end

    if depth and offset / depth > WALL_SNAP_WARN_RATIO:
        notes.append(
            "{} '{}' sits {:.0f} px inside the room (an internal wall in the plan); "
            "projected onto the {} wall".format(kind, box["id"], offset, wall))
    return {"id": box["id"], "wall": wall, "start_px": start_px, "span_px": span_px}


def _fit_to_wall(opening: Dict, wall_length: float, kind: str, notes: List[str]) -> Dict:
    """Clamp a converted opening so it sits inside its wall."""
    width = min(max(opening["width"], MIN_OPENING_WIDTH), wall_length)
    position = min(max(opening["position"], 0.0), wall_length - width)
    if abs(width - opening["width"]) > 1.0 or abs(position - opening["position"]) > 1.0:
        notes.append(
            "{} '{}' ran off the {:.0f} mm {} wall; clamped to {:.0f}-{:.0f} mm".format(
                kind, opening["id"], wall_length, opening["wall"], position, position + width))
    opening["position"], opening["width"] = round(position, 1), round(width, 1)
    return opening


def _merge_same_wall(openings: List[Dict], kind: str, notes: List[str]) -> List[Dict]:
    """Fold overlapping detections of the same kind into a single opening.

    The detector regularly reports one long window *and* the two halves it was
    split into; the engine rejects overlapping openings, so they are unioned.
    """
    merged: List[Dict] = []
    for opening in sorted(openings, key=lambda o: (o["wall"], o["position"])):
        previous = merged[-1] if merged else None
        if (previous is not None and previous["wall"] == opening["wall"]
                and opening["position"] < previous["position"] + previous["width"] - 1.0):
            end = max(previous["position"] + previous["width"],
                      opening["position"] + opening["width"])
            previous["width"] = round(end - previous["position"], 1)
            notes.append(
                "{} '{}' overlaps '{}' on the {} wall; merged into one {:.0f} mm opening".format(
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
        if abs(start - window["position"]) > 1.0 or abs(end - start - window["width"]) > 1.0:
            notes.append("window '{}' trimmed to {:.0f}-{:.0f} mm to clear a door".format(
                window["id"], start, end))
            window["position"], window["width"] = round(start, 1), round(end - start, 1)
        kept.append(window)
    return kept


def normalise_floorplan(data: Dict, name: str = "scenario") -> Dict:
    """Convert detector output (pixels) into the standard input schema (mm)."""
    raw_bbox = _require(data, "bbox_px", "input")
    x = float(raw_bbox.get("x", 0.0))
    y = float(raw_bbox.get("y", 0.0))
    width_px = _positive(_require(raw_bbox, "width", "bbox_px"), "width", "bbox_px")
    height_px = _positive(_require(raw_bbox, "height", "bbox_px"), "height", "bbox_px")
    bbox = {"left": x, "right": x + width_px, "top": y, "bottom": y + height_px}

    door_boxes = _opening_boxes(data, "doors")
    window_boxes = _opening_boxes(data, "windows")
    mm_per_px = _floorplan_scale(data, door_boxes)

    room_width = width_px * mm_per_px      # image x -> west/east extent
    room_length = height_px * mm_per_px    # image y -> south/north extent
    wall_length = {"north": room_width, "south": room_width,
                   "west": room_length, "east": room_length}

    notes: List[str] = []
    reported_area = data.get("room_area_m2")
    bbox_area = room_width * room_length / 1e6
    if reported_area and abs(bbox_area - float(reported_area)) / float(reported_area) > AREA_MISMATCH_RATIO:
        notes.append(
            "the bounding box is {:.1f} m2 but the detector reports {:.1f} m2; the room is not "
            "rectangular, so the shell is an approximation".format(bbox_area, float(reported_area)))

    def convert(boxes: List[Dict], kind: str) -> List[Dict]:
        openings = []
        for box in boxes:
            snapped = _snap_to_wall(box, bbox, kind, notes)
            openings.append(_fit_to_wall(
                {"id": snapped["id"], "wall": snapped["wall"],
                 "position": snapped["start_px"] * mm_per_px,
                 "width": snapped["span_px"] * mm_per_px},
                wall_length[snapped["wall"]], kind, notes))
        return _merge_same_wall(openings, kind, notes)

    doors = convert(door_boxes, "door")
    windows = _clear_of_doors(convert(window_boxes, "window"), doors, notes)
    for door in doors:                     # the detector says nothing about the leaf
        door.setdefault("swing", "inward")
        door.setdefault("hinge", "left")

    room_name = data.get("room_name") or data.get("room_type") or name
    if data.get("room_id") is not None:
        room_name = "{}_{}".format(room_name, data["room_id"])
    converted = {
        "name": data.get("name", room_name),
        "description": "converted from floor-plan detection ({:.0f}x{:.0f} px at {:.5f} m/px)".format(
            width_px, height_px, mm_per_px / 1000.0),
        "room": {
            "width": round(room_width, 1),
            "length": round(room_length, 1),
            "height": float(data.get("room_height", 2800)),
            "name": room_name,
        },
        "doors": doors,
        "windows": windows,
    }
    for key in ("user_requirements", "config", "furniture_overrides"):
        if data.get(key) is not None:
            converted[key] = data[key]

    for note in notes:
        print("[floorplan] {}".format(note))
    return converted


def parse_scenario(data: Dict, name: str = "scenario", source_path: str = None) -> Scenario:
    raw_doors = list(data.get("doors") or [])
    raw_windows = list(data.get("windows") or [])
    if _is_floorplan_input(data):
        data = normalise_floorplan(data, name=name)
    room = _parse_room(data)
    doors = _parse_doors(data, room)
    windows = _parse_windows(data, room)
    _check_overlapping_openings(doors, windows)
    requirements = _parse_requirements(data)
    config = Config.from_dict(data.get("config"))
    catalogue = FurnitureCatalogue(data.get("furniture_overrides"))

    unknown = [
        f
        for f in requirements.required_furniture + requirements.optional_furniture
        if not catalogue.has(f)
    ]
    if unknown:
        raise InputError(
            "unknown furniture type(s): {}. Known types: {}".format(
                ", ".join(unknown), ", ".join(catalogue.types())
            )
        )
    return Scenario(
        room=room,
        doors=doors,
        windows=windows,
        requirements=requirements,
        config=config,
        catalogue=catalogue,
        name=data.get("name", name),
        source_path=source_path,
        input_doors=raw_doors,
        input_windows=raw_windows,
    )


def load_scenario(path: str) -> Scenario:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    name = os.path.splitext(os.path.basename(path))[0]
    return parse_scenario(data, name=name, source_path=path)


def write_json(data: Dict, path: str) -> str:
    directory = os.path.dirname(os.path.abspath(path))
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
    return path
