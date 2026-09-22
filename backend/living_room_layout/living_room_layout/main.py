"""
Command line entry point.

    python -m living_room_layout.main input/room_medium.json
    python -m living_room_layout.main --all
    python -m living_room_layout.main --all --all-layouts
    python -m living_room_layout.main input/room_small.json --layout l_shaped --ascii

Run from the directory that contains the `living_room_layout` package, or use
`python main.py ...` from inside it - both are handled.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import sys
import traceback
from typing import Dict, List

if __package__ in (None, ""):  # allow "python main.py"
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "living_room_layout"

from living_room_layout.engine.pipeline import LayoutGenerator  # noqa: E402
from living_room_layout.io_json import InputError, load_scenario, write_json  # noqa: E402
from living_room_layout.layouts import ALL_LAYOUTS  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_INPUT_DIR = os.path.join(HERE, "input")
DEFAULT_OUTPUT_DIR = os.path.join(HERE, "output")


def _render(result, image_path: str, args) -> str:
    """Draw the plan; returns None when matplotlib is missing or rendering is off."""
    if args.no_render:
        return None
    try:
        from living_room_layout.visualization.renderer import render_layout
        return render_layout(result, image_path)
    except RuntimeError as error:
        print("  (visualisation skipped: {})".format(error))
        return None


def _summary_row(name: str, result, json_path: str, image_path: str) -> Dict:
    return {
        "scenario": name,
        "layout": result.result.layout.name,
        "suitability": round(result.suitability().score, 1),
        "score": round(result.result.score.total, 1),
        "valid": result.result.valid,
        "placed": len(result.result.items),
        "unplaced": [f.role for f in result.result.failures],
        "missing_required": [f.role for f in result.result.failures if f.required],
        "json": json_path,
        "png": image_path,
        "seconds": round(result.elapsed, 2),
    }


def run_all_layouts(path: str, args) -> List[Dict]:
    """Generate every one of the six layouts for one room, side by side.

    Each layout is forced, so a layout the selector would have skipped still
    produces its own JSON and PNG - that is the whole point of the comparison.
    The scenario is parsed once and copied per run so the six are independent.
    """
    name = os.path.splitext(os.path.basename(path))[0]
    os.makedirs(args.out, exist_ok=True)
    base = load_scenario(path)

    rows: List[Dict] = []
    for layout in ALL_LAYOUTS:
        scenario = copy.deepcopy(base)
        scenario.requirements.preferred_layout = layout.name
        result = LayoutGenerator(scenario, force_layout=layout.name).run()

        stem = os.path.join(args.out, "{}_{}_layout".format(name, layout.name))
        json_path = write_json(result.to_dict(), stem + ".json")
        image_path = _render(result, stem + ".png", args)
        rows.append(_summary_row(name, result, json_path, image_path))

    best = max(rows, key=lambda r: (r["valid"], -len(r["missing_required"]), r["score"]))
    index_path = write_json(
        {
            "scenario": name,
            "source": path,
            "room": base.room.to_dict(),
            "doors": list(base.input_doors),
            "windows": list(base.input_windows),
            "layouts": rows,
            "best_layout": best["layout"],
        },
        os.path.join(args.out, "{}_all_layouts.json".format(name)),
    )

    if not args.quiet:
        room = base.room
        print("=" * 78)
        print("{}   {:.0f} x {:.0f} mm   {:.1f} m2   - all {} layouts".format(
            name, room.width, room.length, room.area_m2, len(ALL_LAYOUTS)))
        print("-" * 78)
        print("{:<16} {:>5} {:>8} {:>6} {:>7}  {}".format(
            "LAYOUT", "SUIT", "SCORE", "VALID", "PLACED", "MISSING REQUIRED"))
        for row in rows:
            print("{:<16} {:>5.0f} {:>8.1f} {:>6} {:>7}  {}".format(
                row["layout"], row["suitability"], row["score"], str(row["valid"]),
                row["placed"], ", ".join(row["missing_required"]) or "-"))
        print("-" * 78)
        print("Best for this room: {}".format(best["layout"]))
        print("Index : {}".format(index_path))
        print()
    return rows


def run_one(path: str, args) -> dict:
    scenario = load_scenario(path)
    if args.layout:
        scenario.requirements.preferred_layout = args.layout

    result = LayoutGenerator(scenario).run()
    data = result.to_dict()

    name = os.path.splitext(os.path.basename(path))[0]
    os.makedirs(args.out, exist_ok=True)
    json_path = os.path.join(args.out, "{}_layout.json".format(name))
    write_json(data, json_path)

    image_path = _render(result, os.path.join(args.out, "{}_layout.png".format(name)), args)

    if not args.quiet:
        _print_summary(result, json_path, image_path, args)
    return _summary_row(name, result, json_path, image_path)


def _print_summary(result, json_path: str, image_path: str, args) -> None:
    room = result.scenario.room
    circ = result.result.circulation
    print("=" * 78)
    print("{}   {:.0f} x {:.0f} mm   {:.1f} m2   ({} room)".format(
        result.scenario.name, room.width, room.length, room.area_m2, result.analysis.size_class))
    print("-" * 78)
    print("Layout selected : {} ({:.0f} suitability points)".format(
        result.result.layout.name, result.suitability().score))
    for line in result.decision.reasons[:4]:
        print("                  - {}".format(line))
    print("Layout score    : {:.1f}".format(result.result.score.total))
    print("Components      : " + ", ".join(
        "{} {:+.0f}".format(k, v) for k, v in result.result.score.components.items()))
    print("Valid           : {}".format(result.result.valid))
    if circ:
        print("Circulation     : {} ({:.0f} mm path)".format(
            "OK" if circ.valid else "FAILED", circ.width_achieved))
    print()
    print("Furniture:")
    for item in result.result.items:
        print("  {:<14} {:<14} x={:>6.0f} y={:>6.0f} {:>4}x{:<4.0f} rot={:>3}  [{}]".format(
            item.id, (item.role or item.type), item.x, item.y,
            int(item.spec.width), item.spec.depth, item.rotation, item.strategy))
    if result.result.failures:
        print("\nCould not place:")
        for failure in result.result.failures:
            print("  {:<14} ({}) - {}".format(
                failure.role, "required" if failure.required else "optional",
                (failure.reasons or ["no legal position"])[0]))
    rejected = result.checker.report(limit=6)
    if rejected:
        print("\nRejected placements (top rules):")
        for group in rejected:
            print("  {:<14} x{:<5} {:<26} {}".format(
                group["furniture"], group["rejected_positions"], group["rule"], group["reason"][:70]))
    stats = result.checker.statistics()
    print("\nSearch: {} candidates tested, {} accepted, {:.2f}s".format(
        stats["candidates_tested"], stats["candidates_accepted"], result.elapsed))
    print("Output: {}".format(json_path))
    if image_path:
        print("Image : {}".format(image_path))
    if args.ascii:
        from living_room_layout.visualization.renderer import render_ascii
        print()
        print(render_ascii(result))
    if args.explain:
        print("\nExplanation:")
        for line in result.explanation:
            print("  - {}".format(line))


def main(argv: List[str] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Rule-based living room furniture layout generator")
    parser.add_argument("input", nargs="*", help="input JSON file(s)")
    parser.add_argument("--all", action="store_true", help="run every JSON in the input folder")
    parser.add_argument("--out", default=DEFAULT_OUTPUT_DIR, help="output directory")
    parser.add_argument("--layout", help="force a layout (overrides automatic selection)")
    parser.add_argument("--all-layouts", action="store_true",
                        help="generate all six layouts for every input, not just the selected one")
    parser.add_argument("--no-render", action="store_true", help="skip the PNG")
    parser.add_argument("--ascii", action="store_true", help="print an ASCII plan")
    parser.add_argument("--explain", action="store_true", help="print the full explanation")
    parser.add_argument("--quiet", action="store_true", help="only print the summary table")
    args = parser.parse_args(argv)

    paths = list(args.input)
    if args.all or not paths:
        paths = sorted(
            os.path.join(DEFAULT_INPUT_DIR, f)
            for f in os.listdir(DEFAULT_INPUT_DIR)
            if f.endswith(".json")
        )

    summaries = []
    failed = 0
    for path in paths:
        try:
            if args.all_layouts:
                summaries.extend(run_all_layouts(path, args))
            else:
                summaries.append(run_one(path, args))
        except InputError as error:
            failed += 1
            print("INPUT ERROR in {}: {}".format(os.path.basename(path), error))
        except Exception as error:  # pragma: no cover - defensive
            failed += 1
            print("FAILED {}: {}".format(os.path.basename(path), error))
            traceback.print_exc()

    if len(summaries) > 1 or args.quiet:
        print("\n" + "=" * 78)
        print("{:<26} {:<15} {:>5} {:>7} {:>6} {:>7} {:>6}".format(
            "SCENARIO", "LAYOUT", "SUIT", "SCORE", "VALID", "PLACED", "TIME"))
        print("-" * 78)
        for s in summaries:
            print("{:<26} {:<15} {:>5.0f} {:>7.1f} {:>6} {:>7} {:>5.1f}s".format(
                s["scenario"], s["layout"], s["suitability"], s["score"],
                str(s["valid"]), s["placed"], s["seconds"]))
        print("=" * 78)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
