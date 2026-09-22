"""
Quick offline check that the model loads and runs — no web server needed.

    venv\\Scripts\\activate
    python smoke_test.py [path/to/image.png]

Falls back to the sample image shipped with the training repo if no path given.
"""

import json
import sys

from main import get_model, _pct_box  # noqa: F401  (reuse helpers)


def main() -> None:
    img = sys.argv[1] if len(sys.argv) > 1 else "../../../WallDetectoor/test.png"
    model = get_model()
    results = model.predict(source=img, conf=0.25, verbose=False)
    r = results[0]
    names = r.names
    counts: dict[str, int] = {}
    for i in range(len(r.boxes)):
        label = names[int(r.boxes.cls[i].item())]
        counts[label] = counts.get(label, 0) + 1
    print(json.dumps({"image": img, "detections": len(r.boxes), "counts": counts}, indent=2))


if __name__ == "__main__":
    main()
