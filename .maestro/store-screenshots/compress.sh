#!/bin/bash
# Compress store screenshots the Sprint 26 way (pngquant + oxipng), but keep a
# 24-bit RGB PNG with no alpha: Google Play asks for "JPEG or 24-bit PNG (no alpha)".
# Usage: compress.sh <in.png> <out.png>
set -euo pipefail
in="$1"; out="$2"
work="$(mktemp -d "${TMPDIR:-/tmp}/shot.XXXXXX")"
trap 'rm -rf "$work"' EXIT
magick "$in" -alpha off -colorspace sRGB -strip "$work/flat.png"
pngquant --quality=80-95 --speed 1 --strip --output "$work/q.png" -- "$work/flat.png"
# Expand the palette back to 24-bit RGB; the reduced colour count still deflates well.
magick "$work/q.png" -alpha off -define png:color-type=2 -define png:bit-depth=8 "$work/rgb.png"
oxipng -q -o 4 --strip safe --nc --nb --out "$out" "$work/rgb.png"
