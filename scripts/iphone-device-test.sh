#!/usr/bin/env bash
# iphone-device-test.sh — run `.maestro` flows or catalog cases on the test iPhone (TECH_DEBT #299).
#
# Maestro does not support a physical iPhone. This script locks the phone, starts WebDriverAgent
# (scripts/iphone/wda.sh), and runs the flows with the iPhone flow runner
# (scripts/iphone/lib/flow-runner.mjs). It writes PASS or FAIL, screenshots and summary.json to
# ~/claude/.scratch/iphone-device-test/<time>/ (or --out).
#
# Usage:
#   scripts/iphone-device-test.sh [--app <Qariah.app>] [--out <dir>] <flow.yaml | dir | CASE-ID>...
#
# Examples:
#   scripts/iphone-device-test.sh --app "$OUT/dd/Build/Products/Release-iphoneos/Qariah.app" .maestro/flows/smoke/
#   scripts/iphone-device-test.sh QP-04 QP-09
#
# --app installs that build first and records it: `launchApp: { clearState: true }` uninstalls
# and installs it again. Build it as in qariah-boot-gate-verify ("iOS — physical test iPhone"):
# com.qariah.app, Release, with no Sentry DSN and no PostHog key.
# Exit code: 0 all PASS, 1 a flow failed, 2 a setup error.

set -euo pipefail

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
UDID="${QARIAH_IPHONE_UDID:-$(node --input-type=module -e "
  import { resolveUdid } from '$ROOT/scripts/iphone/lib/device.mjs';
  process.stdout.write(resolveUdid());
")}"
export QARIAH_IPHONE_UDID="$UDID"

exec "$ROOT/scripts/with-device-lock.sh" --serial="$UDID" --label="iphone-device-test" -- bash -c '
  set -euo pipefail
  "$0/scripts/iphone/wda.sh" start >/dev/null
  exec node "$0/scripts/iphone/run.mjs" "$@"
' "$ROOT" "$@"
