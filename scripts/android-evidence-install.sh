#!/usr/bin/env bash
# @ai
# scripts/android-evidence-install.sh
# -----------------------------------
# Record the Qariah build that is installed on an Android device, in the
# evidence directory of a run. Run it after you install the APK and before
# the flows run. Without this file, a stale install can look like a PASS
# (issue #832): the Maestro XML and the dumpsys logs carry no build number.
#
# Usage:
#   scripts/android-evidence-install.sh --serial=<serial> --device=<slug> --dir=<evidence dir>
#
#   --serial  the adb serial (Pixel 3: 8BNX1CU9Z, Galaxy A10s: R9AR20A7FPJ).
#   --device  the slug in the evidence file names: pixel3, a10s.
#   --dir     the evidence directory, for example
#             "${QARIAH_RELEASES_DIR:-$HOME/qariah-releases}/evidence/auto-<date>".
#
# It writes <dir>/android-<device>-install.txt:
#   the serial, the model, the UTC time, and the versionCode/versionName lines
#   of `dumpsys package com.qariah.app`.
# `node scripts/release-audit.mjs sample --kind=artifacts` prints this file for
# each Android claim.
#
# Exit 0 = written. Exit 1 = the app is not installed, or adb failed.
# Exit 2 = usage error.

set -uo pipefail

PKG=com.qariah.app
SERIAL="" DEVICE="" DIR=""
for a in "$@"; do
  case "$a" in
    --serial=*) SERIAL="${a#--serial=}" ;;
    --device=*) DEVICE="${a#--device=}" ;;
    --dir=*) DIR="${a#--dir=}" ;;
    *) echo "❌ unknown argument: $a" >&2; exit 2 ;;
  esac
done
if [ -z "$SERIAL" ] || [ -z "$DEVICE" ] || [ -z "$DIR" ]; then
  echo "usage: $0 --serial=<serial> --device=<slug> --dir=<evidence dir>" >&2
  exit 2
fi
if ! printf %s "$DEVICE" | grep -Eq '^[a-z0-9]+$'; then
  echo "❌ --device must be a lower-case slug such as pixel3 or a10s" >&2
  exit 2
fi

mkdir -p "$DIR" || exit 1
OUT="$DIR/android-$DEVICE-install.txt"

VERSIONS="$(adb -s "$SERIAL" shell dumpsys package "$PKG" | grep -E 'versionCode|versionName')"
if [ -z "$VERSIONS" ]; then
  echo "❌ $PKG is not installed on $SERIAL, or adb failed. Nothing written." >&2
  exit 1
fi
MODEL="$(adb -s "$SERIAL" shell getprop ro.product.model | tr -d '\r')"

{
  echo "package: $PKG"
  echo "serial: $SERIAL"
  echo "model: $MODEL"
  echo "recorded: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\n' "$VERSIONS" | tr -d '\r'
} > "$OUT" || exit 1

echo "✓ $OUT"
cat "$OUT"
