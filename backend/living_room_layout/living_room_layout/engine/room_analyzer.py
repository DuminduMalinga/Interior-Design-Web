"""
Room analysis: geometry -> facts the rest of the pipeline reasons about.

Pipeline steps 2-8 of the specification live here:

    Analyse Room Geometry -> Detect Doors -> Detect Door Swing Areas ->
    Detect Windows -> Detect Solid Walls -> Calculate Usable Floor Area ->
    Determine Room Characteristics

Nothing here places furniture; it only produces a `RoomAnalysis` record that the
layout selector, candidate generator, constraint checker and scorer all share.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from ..config import Config
from ..io_json import Scenario
from ..models.door import Door
from ..models.geometry import Point, Rect, Shape
from ..models.room import OPPOSITE_WALL, WALL_NAMES, Room, Wall, WallSegment
from ..models.window import Window
from .grid import OccupancyGrid


# --------------------------------------------------------------------------- #
# Per-wall record
# --------------------------------------------------------------------------- #
@dataclass
class WallInfo:
    """Everything known about one wall."""

    name: str
    length: float
    doors: List[Door] = field(default_factory=list)
    windows: List[Window] = field(default_factory=list)
    solid_segments: List[WallSegment] = field(default_factory=list)
    door_free_segments: List[WallSegment] = field(default_factory=list)

    @property
    def has_door(self) -> bool:
        return bool(self.doors)

    @property
    def has_window(self) -> bool:
        return bool(self.windows)

    @property
    def solid_length(self) -> float:
        return sum(s.length for s in self.solid_segments)

    @property
    def longest_solid(self) -> Optional[WallSegment]:
        return max(self.solid_segments, key=lambda s: s.length) if self.solid_segments else None

    @property
    def longest_solid_length(self) -> float:
        seg = self.longest_solid
        return seg.length if seg else 0.0

    @property
    def window_coverage(self) -> float:
        return sum(w.width for w in self.windows) / self.length if self.length else 0.0

    @property
    def is_solid_wall(self) -> bool:
        """A wall with a usable uninterrupted stretch and no opening across it."""
        return self.longest_solid_length >= 1200.0

    def to_dict(self) -> Dict:
        return {
            "wall": self.name,
            "length": round(self.length, 1),
            "doors": [d.id for d in self.doors],
            "windows": [w.id for w in self.windows],
            "solid_segments": [s.to_dict() for s in self.solid_segments],
            "longest_solid_run": round(self.longest_solid_length, 1),
            "total_solid_length": round(self.solid_length, 1),
            "window_coverage": round(self.window_coverage, 2),
            "classified_as": "solid_wall" if self.is_solid_wall else "interrupted_wall",
        }


# --------------------------------------------------------------------------- #
# Analysis record
# --------------------------------------------------------------------------- #
@dataclass
class RoomAnalysis:
    room: Room
    doors: List[Door]
    windows: List[Window]
    config: Config
    walls: Dict[str, WallInfo]
    size_class: str
    proportion: str
    aspect_ratio: float
    long_axis: str
    usable_area: float
    usable_ratio: float
    open_span: float
    main_door: Optional[Door]
    entry_point: Optional[Point]
    door_blocked_shape: Shape
    window_zones: Dict[str, Rect]
    base_grid: OccupancyGrid
    facts: List[str] = field(default_factory=list)

    # -- derived helpers ---------------------------------------------------- #
    @property
    def area_m2(self) -> float:
        return self.room.area_m2

    @property
    def usable_area_m2(self) -> float:
        return self.usable_area / 1_000_000.0

    def wall_info(self, name: str) -> WallInfo:
        return self.walls[name]

    def solid_walls(self) -> List[WallInfo]:
        """Walls with a genuinely usable uninterrupted run, longest first."""
        return sorted(
            [w for w in self.walls.values() if w.is_solid_wall],
            key=lambda w: -w.longest_solid_length,
        )

    def window_walls(self) -> List[WallInfo]:
        return [w for w in self.walls.values() if w.has_window]

    def door_walls(self) -> List[WallInfo]:
        return [w for w in self.walls.values() if w.has_door]

    def best_media_wall(self) -> Optional[str]:
        """Preferred wall for a TV: solid, long, and not facing a big window."""
        candidates = self.solid_walls()
        if not candidates:
            return None

        def penalty(info: WallInfo) -> float:
            opposite = self.walls[OPPOSITE_WALL[info.name]]
            score = -info.longest_solid_length
            score += 2000.0 * opposite.window_coverage  # TV opposite glass = glare
            score += 1200.0 if info.has_door else 0.0
            score += 800.0 * info.window_coverage
            return score

        return min(candidates, key=penalty).name

    def largest_window(self) -> Optional[Window]:
        return max(self.windows, key=lambda w: w.width * w.height) if self.windows else None

    def free_wall_run(self, wall: str) -> float:
        return self.walls[wall].longest_solid_length

    def to_dict(self) -> Dict:
        return {
            "area_m2": round(self.area_m2, 2),
            "usable_area_m2": round(self.usable_area_m2, 2),
            "usable_ratio": round(self.usable_ratio, 3),
            "size_class": self.size_class,
            "proportion": self.proportion,
            "aspect_ratio": round(self.aspect_ratio, 2),
            "long_axis": self.long_axis,
            "largest_open_span_mm": round(self.open_span, 1),
            "main_door": self.main_door.id if self.main_door else None,
            "entry_point": [round(self.entry_point[0], 1), round(self.entry_point[1], 1)]
            if self.entry_point
            else None,
            "walls": [self.walls[n].to_dict() for n in WALL_NAMES],
            "solid_walls": [w.name for w in self.solid_walls()],
            "window_walls": [w.name for w in self.window_walls()],
            "best_media_wall": self.best_media_wall(),
            "facts": list(self.facts),
        }


# --------------------------------------------------------------------------- #
# Analyzer
# --------------------------------------------------------------------------- #
class RoomAnalyzer:
    """Turns a `Scenario` into a `RoomAnalysis`."""

    def __init__(self, scenario: Scenario):
        self.scenario = scenario
        self.room = scenario.room
        self.config = scenario.config

    # -- public ------------------------------------------------------------- #
    def analyze(self) -> RoomAnalysis:
        room = self.room
        cfg = self.config
        facts: List[str] = []

        walls = self._analyse_walls()
        size_class = self._size_class(room.area_m2)
        proportion, long_axis = self._proportion()
        door_shape = self._door_blocked_shape()
        window_zones = self._window_zones()

        grid = OccupancyGrid(room.width, room.length, cfg.search.grid_cell)
        grid.mark_shape(door_shape)
        usable_area = grid.free_area()
        usable_ratio = usable_area / room.area if room.area else 0.0
        open_span = grid.largest_free_square_side()

        main_door = self.scenario.main_door
        entry = main_door.entry_point(room, cfg.clearances.door_clearance_min * 0.6) if main_door else None

        facts.append(
            "Room is {:.0f} x {:.0f} mm ({:.1f} m2), classified as {}".format(
                room.width, room.length, room.area_m2, size_class
            )
        )
        facts.append(
            "Proportion is {} (aspect ratio {:.2f}, long axis {})".format(
                proportion, room.aspect_ratio, long_axis
            )
        )
        facts.append(
            "{} door(s) and {} window(s) detected".format(len(self.scenario.doors), len(self.scenario.windows))
        )
        if main_door:
            facts.append(
                "Main entrance is '{}' on the {} wall; {} swing reserves {:.2f} m2".format(
                    main_door.id, main_door.wall, main_door.swing,
                    (main_door.swing_shape(room).area / 1e6) if main_door.swing_shape(room) else 0.0,
                )
            )
        solid = [w.name for w in self._solid_walls_from(walls)]
        facts.append(
            "Solid wall runs available on: {}".format(", ".join(solid) if solid else "none")
        )
        for info in walls.values():
            if info.has_window and info.window_coverage >= 0.6:
                facts.append(
                    "The {} wall is {:.0f}% glazed, so it cannot host tall furniture".format(
                        info.name, info.window_coverage * 100
                    )
                )
        facts.append(
            "Usable floor area after door swings and clearances: {:.1f} m2 ({:.0f}% of the floor)".format(
                usable_area / 1e6, usable_ratio * 100
            )
        )

        analysis = RoomAnalysis(
            room=room,
            doors=self.scenario.doors,
            windows=self.scenario.windows,
            config=cfg,
            walls=walls,
            size_class=size_class,
            proportion=proportion,
            aspect_ratio=room.aspect_ratio,
            long_axis=long_axis,
            usable_area=usable_area,
            usable_ratio=usable_ratio,
            open_span=open_span,
            main_door=main_door,
            entry_point=entry,
            door_blocked_shape=door_shape,
            window_zones=window_zones,
            base_grid=grid,
            facts=facts,
        )
        return analysis

    # -- steps -------------------------------------------------------------- #
    def _analyse_walls(self) -> Dict[str, WallInfo]:
        walls: Dict[str, WallInfo] = {}
        for name in WALL_NAMES:
            wall: Wall = self.room.wall(name)
            doors = [d for d in self.scenario.doors if d.wall == name]
            windows = [w for w in self.scenario.windows if w.wall == name]
            info = WallInfo(name=name, length=wall.length, doors=doors, windows=windows)
            info.solid_segments = self._gaps(
                name,
                wall.length,
                [(d.start, d.end) for d in doors] + [(w.start, w.end) for w in windows],
            )
            info.door_free_segments = self._gaps(
                name, wall.length, [(d.start, d.end) for d in doors]
            )
            walls[name] = info
        return walls

    @staticmethod
    def _gaps(
        name: str,
        length: float,
        intervals: List[Tuple[float, float]],
        min_length: float = 1.0,
    ) -> List[WallSegment]:
        """Stretches of [0, length] not covered by `intervals`."""
        merged: List[List[float]] = []
        for start, end in sorted(intervals):
            if merged and start <= merged[-1][1] + 1e-6:
                merged[-1][1] = max(merged[-1][1], end)
            else:
                merged.append([start, end])
        segments: List[WallSegment] = []
        cursor = 0.0
        for start, end in merged:
            if start - cursor > min_length:
                segments.append(WallSegment(name, cursor, start))
            cursor = max(cursor, end)
        if length - cursor > min_length:
            segments.append(WallSegment(name, cursor, length))
        return segments

    @staticmethod
    def _solid_walls_from(walls: Dict[str, WallInfo]) -> List[WallInfo]:
        return sorted(
            [w for w in walls.values() if w.is_solid_wall], key=lambda w: -w.longest_solid_length
        )

    def _size_class(self, area_m2: float) -> str:
        rooms = self.config.rooms
        if area_m2 < rooms.small_room_area:
            return "small"
        if area_m2 >= rooms.large_room_area:
            return "large"
        return "medium"

    def _proportion(self) -> Tuple[str, str]:
        rooms = self.config.rooms
        ratio = self.room.aspect_ratio
        long_axis = "x" if self.room.width >= self.room.length else "y"
        if ratio >= rooms.narrow_aspect_ratio:
            return "narrow", long_axis
        if ratio <= rooms.square_aspect_ratio:
            return "square", long_axis
        return "balanced", long_axis

    def _door_blocked_shape(self) -> Shape:
        depth = self.config.clearances.door_clearance_min
        parts = []
        for door in self.scenario.doors:
            parts.append(door.blocked_zone(self.room, depth))
        return Shape.of(*parts) if parts else Shape(())

    def _window_zones(self) -> Dict[str, Rect]:
        depth = self.config.clearances.window_access_depth
        return {w.id: w.access_zone(self.room, depth) for w in self.scenario.windows}
