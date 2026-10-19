#!/usr/bin/env bash
# Copies the detector code and model next to the Dockerfile so this folder is a complete Space repo.
set -e
cd "$(dirname "$0")"
SRC=../../wall_detector
cp "$SRC/main.py" "$SRC/room_shapes.py" "$SRC/requirements.txt" .
mkdir -p models && cp "$SRC/models/best.pt" models/
echo "ready: $(pwd)"
