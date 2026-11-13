#!/usr/bin/env bash
# @ai Qariah: the ANR probe (catalog case STB-09). It runs one cold start on a
# phone while a key press goes in each second, and it reports two things:
#   1. each system ANR of the app (the real "Input dispatching timed out"),
#   2. the longest main-thread frames (how near the app came to an ANR).
#
# Usage:
#   scripts/lab/anr-probe.sh <serial> <out-dir> [--arm=default|control|treatment]
#       [--load=N] [--seconds=N] [--clear] [--keys=off] [--back-at=N]
#       [--link=URL --link-at=N]
#
#   --arm      default = a launcher start (the build decides the splash mode).
#              control / treatment = the lab extra (a --lab build only).
#   --load     N busy loops on the phone for the whole run (a slower phone).
#   --seconds  the length of the run (default 30).
#   --clear    `pm clear` first: the first launch after an install (onboarding).
#   --keys     off = no key presses (frames only).
#   --back-at  also press BACK N seconds after the start (the field pattern of
#              the "No focused window" ANR: the user leaves a slow splash).
#   --link=URL --link-at=N   open an app link N seconds after the start, for
#              the cost of a screen (example: qariah://mushaf?surah=2). The
#              result line "after link" has the longest frames after the link.
#
# The key is SHIFT_LEFT: the app ignores it, but InputDispatcher must deliver
# it. With no focused window it waits; a wait of 5 s is the ANR.
# Install a release build first. Run it inside scripts/with-device-lock.sh.
# Exit 0 = no ANR, 3 = an ANR of the app, 9 = INVALID run.
# Planning record: planning/android-anr-floor-rca-2026-11-11.md
set -u
REPO=$(git rev-parse --show-toplevel)
ADB="${ADB:-${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb}"
PKG=com.qariah.app
[ $# -ge 2 ] || { sed -n '2,24p' "$0"; exit 2; }
D=$1; O=$2; shift 2
ARM=default; LOAD=0; SECS=30; CLEAR=0; KEYS=on; BACK_AT=0; LINK=; LINK_AT=0
for arg in "$@"; do
  case "$arg" in
    --arm=*) ARM="${arg#*=}" ;;
    --load=*) LOAD="${arg#*=}" ;;
    --seconds=*) SECS="${arg#*=}" ;;
    --clear) CLEAR=1 ;;
    --keys=*) KEYS="${arg#*=}" ;;
    --back-at=*) BACK_AT="${arg#*=}" ;;
    --link=*) LINK="${arg#*=}" ;;
    --link-at=*) LINK_AT="${arg#*=}" ;;
    *) echo "anr-probe: unknown option $arg" >&2; exit 2 ;;
  esac
done
mkdir -p "$O"; : > "$O/result.txt"
a() { "$ADB" -s "$D" "$@"; }
say() { echo "$*" | tee -a "$O/result.txt"; }
bad() { say "INVALID: $1"; a exec-out screencap -p > "$O/invalid.png"; exit 9; }

a get-state > /dev/null 2>&1 || bad "the device $D is not attached"
a shell pm path "$PKG" > /dev/null 2>&1 || bad "$PKG is not installed"
a shell input keyevent KEYCODE_WAKEUP
a shell svc power stayon true
a shell wm dismiss-keyguard
a shell am force-stop "$PKG"
[ "$CLEAR" = 1 ] && a shell pm clear "$PKG" > /dev/null
a shell input keyevent KEYCODE_HOME
sleep 2
a logcat -c
a logcat -b events -c

say "run: serial=$D arm=$ARM load=$LOAD seconds=$SECS clear=$CLEAR keys=$KEYS back_at=$BACK_AT link=${LINK:-none}@$LINK_AT"
say "build: $(a shell dumpsys package "$PKG" | grep -m1 versionCode | tr -s ' ' | cut -c1-60)"

# The load: N busy loops that end by themselves.
if [ "$LOAD" -gt 0 ]; then
  a shell "for i in \$(seq $LOAD); do (end=\$((\$(date +%s)+$SECS+6)); while [ \$(date +%s) -lt \$end ]; do :; done) & done; wait" > /dev/null 2>&1 &
fi

# 8000 kB a CPU: the A10s (1.8 GB) refuses a larger trace buffer.
a shell rm -f /data/local/tmp/anr-probe.trace
a shell "atrace -b 8000 -t $SECS view gfx am wm input -o /data/local/tmp/anr-probe.trace" > "$O/atrace.log" 2>&1 &
TP=$!
sleep 1
T0=$(date +%s)

case "$ARM" in
  default) a shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n "$PKG/.MainActivity" > /dev/null 2>&1 ;;
  control) a shell am start -n "$PKG/.MainActivity" --ez qariah_lab_nonblocking_splash false > /dev/null 2>&1 ;;
  treatment) a shell am start -n "$PKG/.MainActivity" --ez qariah_lab_nonblocking_splash true > /dev/null 2>&1 ;;
  *) bad "unknown arm $ARM" ;;
esac

if [ "$BACK_AT" -gt 0 ]; then
  (sleep "$BACK_AT"; a shell input keyevent KEYCODE_BACK) &
fi
if [ -n "$LINK" ] && [ "$LINK_AT" -gt 0 ]; then
  (sleep "$LINK_AT"; a shell am start -a android.intent.action.VIEW -d "'$LINK'" "$PKG" > /dev/null 2>&1) &
fi
if [ "$KEYS" = on ]; then
  a shell "i=0; while [ \$i -lt $((SECS - 3)) ]; do input keyevent 59; sleep 1; i=\$((i+1)); done" > /dev/null 2>&1 &
fi
wait "$TP"
grep -q "unable to start tracing" "$O/atrace.log" && say "trace: FAILED ($(head -1 "$O/atrace.log" | cut -c1-80))"
# The run has its full length also when atrace stopped early.
LEFT=$((SECS - ($(date +%s) - T0)))
[ "$LEFT" -gt 0 ] && sleep "$LEFT"
sleep 6 # an ANR that began in the last seconds needs 5 s to fire

PID=$(a shell pidof "$PKG" | tr -d '\r')
a exec-out screencap -p > "$O/end.png"
a logcat -d > "$O/logcat.txt" 2>&1
a logcat -b events -d > "$O/events.txt" 2>&1
a pull /data/local/tmp/anr-probe.trace "$O/probe.trace" > /dev/null 2>&1

say "splash: $(grep -E 'QariahBootSplash: boot splash (mode|dismissed)' "$O/logcat.txt" | sed -E 's/.*QariahBootSplash: //' | tr '\n' ';')"
say "displayed: $(grep -m1 -E "Displayed $PKG" "$O/logcat.txt" | sed -E 's/.*Displayed //')"
ANRS=$(grep -c -E "ANR in $PKG" "$O/logcat.txt")
say "anr_count: $ANRS"
grep -E -A3 "ANR in $PKG" "$O/logcat.txt" | grep -E "ANR in|Reason:" | sed -E 's/^.*(ANR in|Reason:)/  \1/' | tee -a "$O/result.txt"
grep -E "am_anr" "$O/events.txt" | sed -E 's/^.*am_anr/  am_anr/' | cut -c1-220 | tee -a "$O/result.txt"
if [ -n "$PID" ] && [ -s "$O/probe.trace" ]; then
  node "$REPO/scripts/lab/frame-trace.mjs" "$O/probe.trace" "$PID" | tee -a "$O/result.txt"
  if [ -n "$LINK" ] && [ "$LINK_AT" -gt 0 ]; then
    # The trace starts 1 s before the launch.
    say "after link ($LINK at ${LINK_AT}s): $(node "$REPO/scripts/lab/frame-trace.mjs" "$O/probe.trace" "$PID" --after="$((LINK_AT + 1))" | sed -n 2p)"
  fi
else
  say "frames: no process or no trace (pid='$PID')"
fi

# Leave the phone clean: the ANR dialog goes with the process.
a shell am force-stop "$PKG"
a shell svc power stayon false
[ "$ANRS" -gt 0 ] && exit 3
exit 0
