"""
Run the engine on a request file, without the web server.

    python -m living_room_layout request.json            # full JSON result
    python -m living_room_layout request.json --summary  # one line per layout
"""

from __future__ import annotations

import json
import sys

from . import InputError, generate_living_room_layouts


def main(argv) -> int:
    paths = [a for a in argv if not a.startswith("--")]
    if len(paths) != 1:
        print(__doc__.strip())
        return 2
    with open(paths[0], "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    try:
        result = generate_living_room_layouts(payload)
    except InputError as error:
        print("input error: {}".format(error))
        return 1

    if "--summary" not in argv:
        print(json.dumps(result, indent=2))
        return 0
    print("{} ({}): {}".format(", ".join(result["activities"]), result["activitiesSource"],
                               result["programme"]["summary"]))
    for entry in result["layouts"]:
        if "error" in entry:
            print("  {}".format(entry["error"]))
            continue
        print("  {:5.1f}  {:<11}  {}  -  {}".format(
            entry["layout"]["score"], "valid" if entry["validation"]["valid"] else "compromised",
            entry["layout"]["title"], entry["reason"][0]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
