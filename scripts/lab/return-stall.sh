#!/usr/bin/env bash
# @ai Qariah: PERF-09, the longest frame when the app returns from the background.
#
# Usage: scripts/lab/return-stall.sh <serial> <seconds> <full|fullpause|mini|mushaf|profile> <out-dir>
#
# Install the release build first. The script plays Al-Mulk, opens the full
# player (full, fullpause), keeps the mini player (mini) or opens Al-Mulk in
# the Mushaf reader while the audio plays (mushaf, TECH_DEBT #398), pauses
# (fullpause), goes home for <seconds>, then traces 14 s around the return.
# profile = the mini player on a reciter profile, from Ad-Duhaa (a track change
# about each minute; return-stall-profile.yaml). TRIM=COMPLETE in the
# environment sends a memory trim before the return. It writes
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
PLAY="$REPO/scripts/lab/return-stall-play.yaml"
[ "$M" = profile ] && PLAY="$REPO/scripts/lab/return-stall-profile.yaml"
ok=0
for _ in 1 2 3; do
  "$MAESTRO" --device "$D" test "$PLAY" > "$O/maestro.txt" 2>&1 && { ok=1; break; }
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
  if [ "$M" = mini ] || [ "$M" = profile ]; then
    printf -- "- waitForAnimationToEnd:\n    timeout: 500\n"
  elif [ "$M" = mushaf ]; then
    # A link, not a tap on the surah row: the mini player also shows "Al-Mulk",
    # and a tap on that text opens the full player.
    printf -- "- openLink: 'qariah://mushaf?surah=67'\n- extendedWaitUntil:\n    visible:\n      id: 'mushaf-settings-button'\n    timeout: 30000\n"
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
# TRIM=<level> (COMPLETE, RUNNING_CRITICAL, ...): tell the app to free memory
# before the return, as Android does on a phone with little RAM. The app then
# makes its GPU resources again in the return frame.
if [ -n "${TRIM:-}" ]; then
  echo "trim: $TRIM $(a shell am send-trim-memory com.qariah.app "$TRIM" 2>&1 | tr -d '\r')" | tee -a "$O/result.txt"
  sleep 3
fi
# -a: the app's own trace sections too (React Native names its mount work
# "MountItemDispatcher::mountViews ..."), so the trace shows what the return frame holds.
a shell "atrace -a com.qariah.app -b 8000 -t 14 view gfx am wm -o /data/local/tmp/return-stall.trace" > "$O/atrace.log" 2>&1 &
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
