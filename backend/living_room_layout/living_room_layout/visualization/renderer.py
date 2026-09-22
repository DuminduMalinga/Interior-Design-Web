"""
Optional 2D visualisation (specification 17).

Draws the room shell, the openings and the zones they reserve, the walkable
area found by the circulation analysis, and every placed piece with its label
and facing direction.

matplotlib is imported lazily, so the rest of the system runs without it.
"""

from __future__ import annotations

import os
from typing import Dict, List, Optional

from ..models.furniture import Furniture
from ..rules.circulation_rules import build_grid

# category -> (fill, edge)
CATEGORY_COLORS: Dict[str, tuple] = {
    "seating": ("#9fc6e8", "#2f6690"),
    "table": ("#f6d8a8", "#b07d2b"),
    "media": ("#c9c2e8", "#5b4b9c"),
    "storage": ("#c5e0b4", "#4b7d38"),
    "work": ("#f4b8b8", "#a03d3d"),
    "lighting": ("#ffe9a8", "#b08b1e"),
    "soft": ("#ececec", "#9a9a9a"),
    "misc": ("#dddddd", "#777777"),
}

ARROW = {0: (0, 1), 90: (-1, 0), 180: (0, -1), 270: (1, 0)}


class LayoutVisualizer:
    """Renders a `GenerationResult` to a matplotlib figure or a PNG file."""

    def __init__(self, result, show_grid: bool = True, show_paths: bool = True):
        self.result = result
        self.show_grid = show_grid
        self.show_paths = show_paths

    # ------------------------------------------------------------------ #
    def render(self, path: Optional[str] = None, dpi: int = 130, show: bool = False):
        try:
            import matplotlib
            if not show:
                matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            from matplotlib.patches import Polygon as MplPolygon, Rectangle, Wedge
        except ImportError as error:  # pragma: no cover - optional dependency
            raise RuntimeError(
                "matplotlib is required for visualisation: pip install matplotlib"
            ) from error

        gen = self.result
        room = gen.scenario.room
        clear = gen.scenario.config.clearances

        scale = 0.0016  # mm -> inches
        fig, ax = plt.subplots(figsize=(room.width * scale + 3.4, room.length * scale + 2.2))

        self._draw_walkable(ax)
        self._draw_room(ax, room, Rectangle)
        self._draw_openings(ax, gen, room, clear, Rectangle, Wedge)
        self._draw_furniture(ax, gen, MplPolygon, Rectangle)
        self._draw_entry_path(ax, gen)
        self._finish(ax, plt, gen, room)

        fig.tight_layout()
        if path:
            directory = os.path.dirname(os.path.abspath(path))
            if directory:
                os.makedirs(directory, exist_ok=True)
            fig.savefig(path, dpi=dpi)
        if show:  # pragma: no cover - interactive
            plt.show()
        else:
            plt.close(fig)
        return path

    # ------------------------------------------------------------------ #
    def _draw_walkable(self, ax) -> None:
        """Light shading over the floor a person can actually walk on."""
        if not self.show_paths:
            return
        report = self.result.result.circulation
        grid = report.grid if report else None
        if grid is None:
            return
        mask = grid.passable_mask(self.result.scenario.config.clearances.circulation_min)
        reach = report.path_cells
        cell = grid.cell
        for iy in range(grid.ny):
            for ix in range(grid.nx):
                idx = grid.index(ix, iy)
                if not mask[idx]:
                    continue
                reached = reach is not None and reach[idx]
                ax.add_patch(
                    _rect(ax, ix * cell, iy * cell, cell, cell,
                          facecolor="#cfe9d4" if reached else "#f0dede",
                          edgecolor="none", zorder=0.5, alpha=0.85)
                )

    def _draw_room(self, ax, room, Rectangle) -> None:
        ax.add_patch(
            Rectangle((0, 0), room.width, room.length, facecolor="#fdfdfb",
                      edgecolor="#333333", linewidth=2.5, zorder=0.2)
        )
        ax.set_xlim(-500, room.width + 500)
        ax.set_ylim(-500, room.length + 500)
        ax.set_aspect("equal")

    def _draw_openings(self, ax, gen, room, clear, Rectangle, Wedge) -> None:
        import math

        for door in gen.scenario.doors:
            zone = door.clearance_zone(room, clear.door_clearance_min)
            ax.add_patch(
                Rectangle((zone.x0, zone.y0), zone.width, zone.height, facecolor="none",
                          edgecolor="#c0392b", linewidth=1.0, linestyle=":", hatch="///",
                          alpha=0.55, zorder=1.0)
            )
            opening = door.opening_rect(room, depth=90)
            ax.add_patch(
                Rectangle((opening.x0, opening.y0), opening.width, opening.height,
                          facecolor="#c0392b", edgecolor="#7b241c", linewidth=1.0, zorder=5.0)
            )
            swing = door.swing_shape(room)
            if swing is not None:
                for part in swing.parts:
                    ax.add_patch(
                        _poly(part.points, facecolor="#c0392b", alpha=0.13,
                              edgecolor="#c0392b", linestyle="--", linewidth=0.9, zorder=1.2)
                    )
            centre = door.center_point(room)
            ax.annotate(
                door.id, xy=(centre[0], centre[1]), xytext=(0, -14 if door.wall == "south" else 8),
                textcoords="offset points", ha="center", fontsize=7, color="#7b241c", zorder=6.0,
            )

        for window in gen.scenario.windows:
            zone = window.access_zone(room, clear.window_access_depth)
            ax.add_patch(
                Rectangle((zone.x0, zone.y0), zone.width, zone.height, facecolor="#5dade2",
                          edgecolor="none", alpha=0.13, zorder=1.0)
            )
            band = window.access_zone(room, 90)
            ax.add_patch(
                Rectangle((band.x0, band.y0), band.width, band.height, facecolor="#5dade2",
                          edgecolor="#2471a3", linewidth=1.0, zorder=5.0)
            )
            centre = window.center_point(room)
            ax.annotate(
                "{} ({:.0f} sill)".format(window.id, window.sill_height),
                xy=(centre[0], centre[1]),
                xytext=(0, 8 if window.wall == "south" else -14),
                textcoords="offset points", ha="center", fontsize=7, color="#1a5276", zorder=6.0,
            )

    def _draw_furniture(self, ax, gen, MplPolygon, Rectangle) -> None:
        for item in gen.result.items:
            fill, edge = CATEGORY_COLORS.get(item.spec.category, CATEGORY_COLORS["misc"])
            for rect in item.part_rects():
                ax.add_patch(
                    Rectangle((rect.x0, rect.y0), rect.width, rect.height, facecolor=fill,
                              edgecolor=edge, linewidth=1.4, zorder=3.0)
                )
            box = item.bbox
            label = (item.role or item.type).replace("_", " ").upper()
            ax.text(
                box.cx, box.cy, label, ha="center", va="center", fontsize=7.2,
                color="#20303d", zorder=4.0, fontweight="bold",
            )
            # facing arrow
            dx, dy = ARROW[item.rotation % 360]
            length = min(box.width, box.height) * 0.32 + 120
            ax.annotate(
                "", xy=(box.cx + dx * length, box.cy + dy * length), xytext=(box.cx, box.cy),
                arrowprops=dict(arrowstyle="-|>", color=edge, linewidth=1.2), zorder=4.0,
            )

    def _draw_entry_path(self, ax, gen) -> None:
        entry = gen.analysis.entry_point
        door = gen.analysis.main_door
        if entry is None or door is None:
            return
        centre = door.center_point(gen.scenario.room)
        ax.annotate(
            "", xy=(gen.scenario.room.center[0], gen.scenario.room.center[1]),
            xytext=(centre[0], centre[1]),
            arrowprops=dict(arrowstyle="-|>", color="#1e8449", linewidth=1.6,
                            linestyle="--", alpha=0.8),
            zorder=2.5,
        )
        ax.text(entry[0], entry[1], "entrance", fontsize=7, color="#1e8449",
                ha="center", va="bottom", zorder=4.0)

    def _finish(self, ax, plt, gen, room) -> None:
        from matplotlib.patches import Patch

        result = gen.result
        circ = result.circulation
        ax.set_title(
            "{}  -  {} layout  -  score {:.0f}  -  {}".format(
                gen.scenario.name, result.layout.name, result.score.total,
                "VALID" if result.valid else "INVALID",
            ),
            fontsize=11, fontweight="bold",
        )
        subtitle = "{:.0f} x {:.0f} mm ({:.1f} m2, {})".format(
            room.width, room.length, room.area_m2, gen.analysis.size_class
        )
        if circ:
            subtitle += "   |   walking path {:.0f} mm".format(circ.width_achieved) if circ.valid \
                else "   |   circulation FAILED"
        ax.set_xlabel(subtitle + "        x (mm) ->", fontsize=8)
        ax.set_ylabel("y (mm) ->", fontsize=8)
        ax.tick_params(labelsize=7)
        ax.grid(self.show_grid, linestyle=":", linewidth=0.4, color="#cccccc", zorder=0.1)

        used = {i.spec.category for i in result.items}
        handles = [
            Patch(facecolor=CATEGORY_COLORS[c][0], edgecolor=CATEGORY_COLORS[c][1], label=c)
            for c in sorted(used)
        ]
        handles += [
            Patch(facecolor="#c0392b", alpha=0.3, label="door + swing + clearance"),
            Patch(facecolor="#5dade2", alpha=0.3, label="window + access band"),
            Patch(facecolor="#cfe9d4", label="walkable (reachable)"),
            Patch(facecolor="#f0dede", label="walkable (cut off)"),
        ]
        ax.legend(handles=handles, loc="upper left", bbox_to_anchor=(1.01, 1.0),
                  fontsize=7, frameon=False)


def _rect(ax, x, y, w, h, **kwargs):
    from matplotlib.patches import Rectangle
    return Rectangle((x, y), w, h, **kwargs)


def _poly(points, **kwargs):
    from matplotlib.patches import Polygon as MplPolygon
    return MplPolygon(list(points), closed=True, **kwargs)


def render_layout(result, path: str, show: bool = False) -> str:
    """Convenience wrapper used by main.py."""
    return LayoutVisualizer(result).render(path=path, show=show)


def render_ascii(result, width: int = 78) -> str:
    """Terminal fallback: a coarse ASCII plan of the room."""
    room = result.scenario.room
    height = max(10, int(width * room.length / room.width / 2.1))
    cell_w = room.width / width
    cell_h = room.length / height
    canvas = [[" " for _ in range(width)] for _ in range(height)]

    def stamp(rect, ch):
        x0 = max(0, int(rect.x0 / cell_w))
        x1 = min(width - 1, int((rect.x1 - 1) / cell_w))
        y0 = max(0, int(rect.y0 / cell_h))
        y1 = min(height - 1, int((rect.y1 - 1) / cell_h))
        for iy in range(y0, y1 + 1):
            for ix in range(x0, x1 + 1):
                canvas[iy][ix] = ch

    legend: List[str] = []
    for index, item in enumerate(result.result.items):
        ch = (item.role or item.type)[0].upper()
        if any(ch == entry[0] for entry in legend):
            ch = str(index)
        for rect in item.part_rects():
            stamp(rect, ch)
        legend.append("{} = {}".format(ch, item.role or item.type))
    for door in result.scenario.doors:
        stamp(door.opening_rect(room, depth=cell_h), "D")
    for window in result.scenario.windows:
        stamp(window.access_zone(room, cell_h), "W")

    lines = ["+" + "-" * width + "+"]
    for row in reversed(canvas):          # y grows upwards
        lines.append("|" + "".join(row) + "|")
    lines.append("+" + "-" * width + "+")
    lines.append("D = door, W = window;  " + ";  ".join(legend))
    return "\n".join(lines)
