#!/bin/bash
# Make one contact sheet (JPEG) of every store screenshot: one row for each
# device and language folder under assets/screenshots, in file-name order.
# Usage: contact-sheet.sh <out.jpg>
set -euo pipefail
OUT="$1"
ROOT="$(git rev-parse --show-toplevel)/assets/screenshots"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/sheet.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

ROWS=()
for dir in ios/en ios/ar ipad/en ipad/ar android/en android/ar; do
  [ -d "$ROOT/$dir" ] || continue
  files=("$ROOT/$dir"/*.png)
  [ -e "${files[0]}" ] || continue
  row="$WORK/$(echo "$dir" | tr / -).png"
  # Each frame 640 px high, with its file name under it.
  montage "${files[@]}" -resize x640 -tile "${#files[@]}x1" -geometry +12+12 \
    -pointsize 18 -set label '%t' -background '#f4f2ec' "$row"
  magick "$row" -gravity north -background '#f4f2ec' -splice 0x56 \
    -pointsize 30 -annotate +0+12 "$dir" "$row"
  ROWS+=("$row")
done
magick "${ROWS[@]}" -background '#f4f2ec' -gravity west -append -quality 82 "$OUT"
echo "$OUT"
