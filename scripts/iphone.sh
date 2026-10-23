#!/usr/bin/env bash
# iphone.sh — drive the test iPhone by hand: tap, type, swipe, read the screen (TECH_DEBT #299).
# The iPhone peer of `adb shell input …`, `screencap` and `uiautomator dump`.
# The verbs are in the header of scripts/iphone/cli.mjs. Start WebDriverAgent first:
#   scripts/iphone/wda.sh start
# For a multi-command session, hold the device lock:
#   scripts/with-device-lock.sh --serial=<udid> --label="<what>" -- bash
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
exec node "$ROOT/scripts/iphone/cli.mjs" "$@"
