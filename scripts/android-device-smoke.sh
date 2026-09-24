#!/usr/bin/env bash
# scripts/android-device-smoke.sh
# --------------------------------
# Release-build smoke test on a physically-connected Android device. This is
# the verification a GitHub Action / CI runner CANNOT do — it launches the real
# app on real hardware and checks it does not crash on boot, then (optionally)
# exercises one affected surface.
#
# It is the device gate for the local remediation routine
# (.claude/skills/qariah-triage-remediate). A draft fix PR is only "device-
# smoked" once this passes on a RELEASE build (hard-rule #15: debug-over-Metro
# is NOT a valid signal for behaviour; a standalone release APK is).
#
# IMPORTANT SCOPE: one device proves one device. A Pixel 3 pass does NOT verify
# OEM-specific bugs (Samsung audio-survival #54, iOS-only issues). The routine
# must still list those as "device verification still needed" in the PR.
#
# Usage:
#   scripts/android-device-smoke.sh [--apk=PATH] [--serial=SERIAL]
#       [--duration=SEC] [--signature=REGEX] [--launch-url=DEEPLINK]
#
#   --apk=PATH        install this release APK first (adb install -r). Omit to
#                     smoke whatever is already installed.
#   --serial=SERIAL   adb serial. Default: $ANDROID_SERIAL, else the first
#                     connected device. (This repo's device is 8BNX1CU9Z.)
#   --duration=SEC    seconds to observe after launch (default 15).
#   --signature=REGEX extra crash signature to fail on (e.g. the Sentry culprit
#                     string for the bug being fixed). Case-insensitive.
#   --launch-url=URL  after the cold launch, also open this deeplink to exercise
#                     a specific surface (e.g. a reciter profile).
#
# Exit 0 = PASS (process alive, no FATAL/native-abort/signature in logcat).
# Exit 1 = FAIL. Exit 2 = setup error (no device, bad APK).

set -uo pipefail

# Temporary files honour TMPDIR. macOS gives each user a private temp dir;
# a hardcoded /tmp is world-writable and is denied under the agent sandbox.
TMP_BASE="${TMPDIR:-/tmp}"; TMP_BASE="${TMP_BASE%/}"

# Serialize the single shared device (scripts/with-device-lock.sh). Re-exec under the
# lock unless a parent already holds it (QARIAH_DEVICE_LOCK_HELD set) — so a parallel
# boot-gate / triage-loop smoke / Maestro run can't collide on the one Pixel. Degrades
# to running unlocked if the lock helper is somehow absent, and skips locking for --help.
case " $* " in *" -h "*|*" --help "*) _SKIP_LOCK=1 ;; *) _SKIP_LOCK="" ;; esac
if [ -z "${QARIAH_DEVICE_LOCK_HELD:-}" ] && [ -z "$_SKIP_LOCK" ] && [ -x "$(dirname "$0")/with-device-lock.sh" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" --label="android-device-smoke" -- "$0" "$@"
fi

PKG="com.qariah.app"
APK=""
SERIAL="${ANDROID_SERIAL:-}"
DURATION=15
SIGNATURE=""
LAUNCH_URL=""

for arg in "$@"; do
  case "$arg" in
    --apk=*)        APK="${arg#*=}" ;;
    --serial=*)     SERIAL="${arg#*=}" ;;
    --duration=*)   DURATION="${arg#*=}" ;;
    --signature=*)  SIGNATURE="${arg#*=}" ;;
    --launch-url=*) LAUNCH_URL="${arg#*=}" ;;
    -h|--help)      sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# Resolve serial.
if [ -z "$SERIAL" ]; then
  SERIAL="$(adb devices | awk 'NR>1 && $2=="device"{print $1; exit}')"
fi
if [ -z "$SERIAL" ]; then
  echo "❌ no connected adb device (and no --serial / ANDROID_SERIAL)." >&2
  exit 2
fi
ADB=(adb -s "$SERIAL")
echo "▶ device-smoke  serial=$SERIAL pkg=$PKG duration=${DURATION}s${APK:+ apk=$APK}"

if ! "${ADB[@]}" get-state >/dev/null 2>&1; then
  echo "❌ device $SERIAL not reachable." >&2
  exit 2
fi

# 1. Install (release APK) if provided.
if [ -n "$APK" ]; then
  [ -f "$APK" ] || { echo "❌ APK not found: $APK" >&2; exit 2; }
  echo "  installing $APK ..."
  if ! "${ADB[@]}" install -r -d "$APK" >"$TMP_BASE/smoke-install.log" 2>&1; then
    echo "❌ install failed:"; tail -5 "$TMP_BASE/smoke-install.log" >&2; exit 2
  fi
fi

# 2. Clear ALL logcat buffers (incl. the crash buffer — a plain `logcat -c`
#    leaves -b crash populated with stale tombstones from earlier in the day),
#    force-stop, cold launch.
"${ADB[@]}" logcat -b all -c >/dev/null 2>&1 || "${ADB[@]}" logcat -c >/dev/null 2>&1 || true
"${ADB[@]}" shell am force-stop "$PKG" >/dev/null 2>&1 || true
echo "  launching ..."
"${ADB[@]}" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || {
  echo "❌ could not launch $PKG (is it installed?)" >&2; exit 2;
}

# 3. Observe.
sleep "$DURATION"

# Optional: exercise a surface via deeplink, then observe a little longer.
if [ -n "$LAUNCH_URL" ]; then
  echo "  opening deeplink: $LAUNCH_URL"
  "${ADB[@]}" shell am start -a android.intent.action.VIEW -d "$LAUNCH_URL" >/dev/null 2>&1 || true
  sleep 6
fi

# 4. Collect signals.
#
# Match REAL crash markers only — anchored to logcat's fatal-line shapes, not
# bare substrings (e.g. Sentry's "TombstoneIntegration" must NOT trip the
# tombstone check). The strongest signal is simply: did the process survive.
FATAL_RE='AndroidRuntime: *FATAL EXCEPTION|F/?libc|libc: *Fatal signal|signal [0-9]+ \(SIG(SEGV|ABRT|BUS|ILL|FPE)\)|F DEBUG +:|>>> '"$PKG"' <<<|ANR in '"$PKG"

ALIVE="$("${ADB[@]}" shell pidof "$PKG" 2>/dev/null | tr -d '\r')"
# Fresh crash buffer (cleared at step 2): any tombstone/native abort that names
# the package or carries a signal line is a real crash from THIS launch.
CRASH_BUF="$("${ADB[@]}" logcat -d -b crash 2>/dev/null | grep -iE "$FATAL_RE")"
ERR_BUF="$("${ADB[@]}" logcat -d 2>/dev/null | grep -iE "$FATAL_RE")"

FAIL=0
NOTES=()

if [ -z "$ALIVE" ]; then
  FAIL=1; NOTES+=("process is NOT running after ${DURATION}s — crashed or never started")
else
  NOTES+=("process alive (pid $ALIVE)")
fi

if [ -n "$CRASH_BUF" ]; then
  FAIL=1; NOTES+=("fresh crash-buffer entries:")
  NOTES+=("$(echo "$CRASH_BUF" | head -6)")
fi

if [ -n "$ERR_BUF" ]; then
  FAIL=1; NOTES+=("fatal/native markers in main log:")
  NOTES+=("$(echo "$ERR_BUF" | head -6)")
fi

if [ -n "$SIGNATURE" ]; then
  HITS="$("${ADB[@]}" logcat -d 2>/dev/null | grep -iE "$SIGNATURE" | head -6)"
  if [ -n "$HITS" ]; then
    FAIL=1; NOTES+=("regression signature '$SIGNATURE' present:")
    NOTES+=("$HITS")
  else
    NOTES+=("regression signature '$SIGNATURE' NOT present ✓")
  fi
fi

echo ""
for n in "${NOTES[@]}"; do echo "  - $n"; done
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "✅ device-smoke PASS on $SERIAL"
  exit 0
else
  echo "❌ device-smoke FAIL on $SERIAL"
  exit 1
fi
