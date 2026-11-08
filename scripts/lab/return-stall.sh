#!/usr/bin/env bash
# @ai Qariah: PERF-09, the longest frame when the app returns from the background.
#
# Usage: scripts/lab/return-stall.sh <serial> <seconds> <full|fullpause|mini> <out-dir>
#
# Install the release build first. The script plays Al-Mulk, opens the full
# player (full, fullpause) or keeps the mini player (mini), pauses (fullpause),
# goes home for <seconds>, then traces 14 s around the return. It writes
# result.txt in <out-dir>. Exit 9 = INVALID run (the app was not on top, the
# playback state was wrong, or the process died); read invalid.png.
# Run it inside scripts/with-device-lock.sh. Planning record:
# planning/android-anr-background-return-rca-2026-11-03.md
set -u
REPO=$(git rev-parse --show-toplevel)
ADB="${ADB:-${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb}"
MAESTRO="${MAESTRO:-$(command -v maestro || echo "$HOME/.maestro/bin/maestro")}"
D=$1; T=$2; M=$3; O=$4
mkdir -p "$O"; : > "$O/result.txt"
a() { "$ADB" -s "$D" "$@"; }
bad() { echo "INVALID: $1" | tee -a "$O/result.txt"; a exec-out screencap -p > "$O/invalid.png"; a shell svc power stayon false; exit 9; }
wake() { a shell input keyevent KEYCODE_WAKEUP; a shell svc power stayon true; a shell wm dismiss-keyguard; sleep 2; }
state() { a shell dumpsys media_session | grep -m1 -E 'state=PlaybackState' | cut -c1-70; }

wake
ok=0
for _ in 1 2 3; do
  "$MAESTRO" --device "$D" test "$REPO/scripts/lab/return-stall-play.yaml" > "$O/maestro.txt" 2>&1 && { ok=1; break; }
  wake
done
[ "$ok" = 1 ] || bad "play flow failed"
# Wait until the audio plays, so a pause cannot land on a loading track.
for _ in $(seq 1 60); do state | grep -q 'state=PlaybackState {state=3,' && break; sleep 1; done
sleep 5
WANT=3
{
  printf 'appId: com.qariah.app\n---\n'
  if [ "$M" = fullpause ]; then WANT=2; printf -- "- tapOn:\n    id: 'mini-player-play-pause'\n"; fi
  if [ "$M" = mini ]; then
    printf -- "- waitForAnimationToEnd:\n    timeout: 500\n"
  else
    printf -- "- tapOn:\n    id: 'mini-player-expand'\n- waitForAnimationToEnd:\n    timeout: 3000\n"
  fi
} > "$O/step.yaml"
"$MAESTRO" --device "$D" test "$O/step.yaml" >> "$O/maestro.txt" 2>&1 || bad "player flow failed"
sleep 2
echo "before: $(state)" | tee -a "$O/result.txt"
state | grep -q "state=PlaybackState {state=$WANT," || bad "playback state is not $WANT"
a shell dumpsys window | grep -m1 mCurrentFocus | grep -q com.qariah.app || bad "the app is not on top"
a shell input keyevent KEYCODE_HOME
sleep "$T"
PID=$(a shell pidof com.qariah.app | tr -d '\r')
[ -n "$PID" ] || bad "the process died in the background"
a shell "atrace -b 8000 -t 14 view gfx am wm -o /data/local/tmp/return-stall.trace" > "$O/atrace.log" 2>&1 &
TP=$!
sleep 2
a shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n com.qariah.app/.MainActivity > /dev/null 2>&1
sleep 3; a exec-out screencap -p > "$O/after.png"
wait "$TP"
a pull /data/local/tmp/return-stall.trace "$O/return.trace" > /dev/null 2>&1
echo "pid after return $(a shell pidof com.qariah.app | tr -d '\r') (before $PID)" | tee -a "$O/result.txt"
node "$REPO/scripts/lab/frame-trace.mjs" "$O/return.trace" "$PID" | tee -a "$O/result.txt"
a shell input keyevent KEYCODE_MEDIA_PAUSE
a shell svc power stayon false
