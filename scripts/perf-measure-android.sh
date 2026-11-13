#!/usr/bin/env bash
# scripts/perf-measure-android.sh
# ---------------------------------------------------------------------------
# Repeatable Android performance regression harness for Qariah.
#
# Captures the Sprint-30 perf protocol (cold start, time-to-interactive,
# PSS, scroll jank, APK composition) into one labelled report so you can
# diff a baseline run against a branch run.
#
# HARD RULE #15: responsiveness numbers are ONLY valid from a RELEASE build
# (standalone APK, no Metro). A debug-over-Metro build runs JS 5-10x slower
# and balloons memory. This script HARD-ABORTS on a debuggable build.
#
# Usage:
#   ./scripts/perf-measure-android.sh --label baseline
#   ./scripts/perf-measure-android.sh --label branch --mushaf
#   ./scripts/perf-measure-android.sh --label beta --pkg com.qariah.app.beta
#
# Then compare:  diff "$OUTDIR"/baseline-*.txt "$OUTDIR"/branch-*.txt
#
# Flags:
#   --label NAME   report label (default: run)
#   --pkg ID       app package      (default: com.qariah.app)
#   --serial S     adb device serial (default: first connected device)
#   --runs N       cold-start iterations (default: 5)
#   --mushaf       pause to capture Mushaf reading-page PSS (interactive only)
#   --out DIR      report directory (default: $TMPDIR/qariah-perf)
#
# bash 3.2 compatible (macOS default shell) — no mapfile/readarray.
# ---------------------------------------------------------------------------
set -euo pipefail

# Temporary files honour TMPDIR. macOS gives each user a private temp dir;
# a hardcoded /tmp is world-writable and is denied under the agent sandbox.
TMP_BASE="${TMPDIR:-/tmp}"; TMP_BASE="${TMP_BASE%/}"

LABEL="run"; PKG="com.qariah.app"; SERIAL=""; RUNS=5; MUSHAF=0; OUTDIR="$TMP_BASE/qariah-perf"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --label)  LABEL="$2"; shift 2;;
    --pkg)    PKG="$2"; shift 2;;
    --serial) SERIAL="$2"; shift 2;;
    --runs)   RUNS="$2"; shift 2;;
    --mushaf) MUSHAF=1; shift;;
    --out)    OUTDIR="$2"; shift 2;;
    *) echo "Unknown flag: $1" >&2; exit 2;;
  esac
done

# Resolve adb target ---------------------------------------------------------
# --serial, else ANDROID_SERIAL, else the only attached device. With several
# attached, a guess would measure the wrong phone: stop instead.
SERIAL="${SERIAL:-${ANDROID_SERIAL:-}}"
if [[ -z "$SERIAL" ]]; then
  if (( $(adb devices | awk 'NR>1 && $2=="device"{n++} END{print n+0}') > 1 )); then
    echo "Several adb devices attached — pass --serial SERIAL." >&2; exit 1
  fi
  SERIAL="$(adb devices | awk 'NR>1 && $2=="device"{print $1; exit}')"
fi
[[ -z "$SERIAL" ]] && { echo "No connected adb device found." >&2; exit 1; }
ADB="adb -s $SERIAL"

# Swipe points from the real screen size (Pixel 3 1080x2160, A10s 720x1520),
# so a fixed coordinate never lands off-screen.
WM_SIZE="$($ADB shell wm size | awk -F': ' '/Override size/{o=$2} /Physical size/{p=$2} END{print (o?o:p)}' | tr -d '\r')"
SCREEN_W="${WM_SIZE%x*}"; SCREEN_H="${WM_SIZE#*x}"
SWIPE_X=$(( SCREEN_W / 2 )); SWIPE_LOW=$(( SCREEN_H * 79 / 100 )); SWIPE_HIGH=$(( SCREEN_H * 23 / 100 ))

# Confirm the app is installed + resolve its LAUNCHER activity ----------------
$ADB shell pm path "$PKG" >/dev/null 2>&1 || { echo "$PKG not installed on $SERIAL." >&2; exit 1; }
ACT="$($ADB shell cmd package resolve-activity --brief "$PKG" 2>/dev/null | tail -1 | tr -d '\r')"
[[ "$ACT" == */* ]] || ACT="$PKG/.MainActivity"

mkdir -p "$OUTDIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="$OUTDIR/${LABEL}-${STAMP}.txt"
SHOTS="$OUTDIR/${LABEL}-${STAMP}-shots"; mkdir -p "$SHOTS"

# Everything below is teed to the report -------------------------------------
exec > >(tee "$REPORT") 2>&1

DEBUGGABLE="$($ADB shell run-as "$PKG" id >/dev/null 2>&1 && echo yes || echo no)"
echo "=========================================================="
echo " Qariah Android perf run"
echo " label=$LABEL  pkg=$PKG  device=$SERIAL  runs=$RUNS  $(date)"
echo " activity=$ACT"
echo " debuggable=$DEBUGGABLE   (MUST be 'no' — rule #15)"
echo " app versionName=$($ADB shell dumpsys package "$PKG" | awk -F= '/versionName/{print $2; exit}' | tr -d '\r')"
echo "=========================================================="

# --- Hard gate: rule #15 ----------------------------------------------------
if [[ "$DEBUGGABLE" == "yes" ]]; then
  echo "ABORT: build is DEBUGGABLE — perf numbers are invalid on a debug/Metro build (rule #15)." >&2
  exit 3
fi

# --- Preflight: wake the device + dismiss keyguard --------------------------
# A locked screen silently invalidates the entire run (empty cold-start times,
# bogus PSS, zero captured frames) while still 'succeeding'. Guard against it.
$ADB shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
$ADB shell wm dismiss-keyguard >/dev/null 2>&1 || true
sleep 1
$ADB shell am start "$ACT" >/dev/null 2>&1 || true; sleep 3
RESUMED="$($ADB shell dumpsys activity activities 2>/dev/null | grep -m1 -E 'ResumedActivity|mResumedActivity' | grep -c "$PKG" || true)"
if [[ "$RESUMED" == "0" ]]; then
  echo "WARNING: $PKG is NOT the resumed activity after launch — screen may be locked, a system dialog is up,"
  echo "         or the launcher activity is wrong. Numbers below may be INVALID. Unlock the device and re-run." >&2
fi

# Wait up to $1 s for this launch's logcat line "Displayed <pkg>/...: +14s699ms" and
# print it in ms. Clear logcat before the launch. A slow phone needs it: on the
# Samsung A10s `am start -W` gives up after 10 s, before the first frame, and
# prints no TotalTime.
wait_displayed_ms() {
  local limit="$1" waited=0 line
  while (( waited < limit )); do
    line="$($ADB logcat -d 2>/dev/null | grep -m1 "Displayed $PKG" | grep -oE '\+[0-9smh]+' | head -1 || true)"
    if [[ -n "$line" ]]; then
      echo "$line" | awk '{t=$0; sub(/^\+/,"",t); ms=0
        if (match(t,/[0-9]+m[^s]/)) { ms+=substr(t,RSTART,RLENGTH-2)*60000; t=substr(t,RSTART+RLENGTH-1) }
        if (match(t,/[0-9]+s/)) { ms+=substr(t,RSTART,RLENGTH-1)*1000; t=substr(t,RSTART+RLENGTH) }
        if (match(t,/[0-9]+ms/)) { ms+=substr(t,RSTART,RLENGTH-2) }
        print ms}'
      return 0
    fi
    sleep 1; waited=$((waited+1))
  done
  return 1
}

echo; echo "## 1. COLD START x$RUNS  (am start -W -S; TotalTime/WaitTime ms; logcat 'Displayed' when -W gives up)"
COLD=""
NCOLD=0
for i in $(seq 1 "$RUNS"); do
  $ADB shell am force-stop "$PKG"; sleep 2
  $ADB logcat -c || true
  OUT="$($ADB shell am start -W -S "$ACT" | tr -d '\r')"
  TT="$(echo "$OUT" | awk -F: '/TotalTime/{gsub(/ /,"",$2); print $2}')"
  WT="$(echo "$OUT" | awk -F: '/WaitTime/{gsub(/ /,"",$2); print $2}')"
  SRC="am"
  if [[ -z "${TT:-}" ]]; then TT="$(wait_displayed_ms 40 || true)"; SRC="logcat"; fi
  echo "  run $i: TotalTime=${TT:-?}ms ($SRC)  WaitTime=${WT:-?}ms"
  if [[ -n "${TT:-}" ]]; then COLD="$COLD $TT"; NCOLD=$((NCOLD+1)); fi
  sleep 3
done
if [[ "$NCOLD" -gt 0 ]]; then
  MED="$(echo $COLD | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -n | awk '{a[NR]=$1} END{print (NR%2)? a[(NR+1)/2] : int((a[NR/2]+a[NR/2+1])/2)}')"
  echo "  --> median TotalTime: ${MED}ms  (over $NCOLD/$RUNS parsed runs)"
  [[ "$NCOLD" -lt "$RUNS" ]] && echo "  WARN: only $NCOLD/$RUNS runs parsed a TotalTime — median is over fewer samples."
fi

echo; echo "## 2. TIME-TO-INTERACTIVE"
$ADB shell am force-stop "$PKG"; sleep 1
$ADB logcat -c || true
$ADB shell am start "$ACT" >/dev/null
# OS-reported first-frame time (note: the first frame is often a blank splash; this is NOT time-to-content)
DISP="$(wait_displayed_ms 40 || true)"
echo "  OS 'Displayed' (time-to-FIRST-frame, may be blank splash): $([[ -n "$DISP" ]] && echo "${DISP}ms" || echo not-captured)"
# Screenshot bracket for time-to-CONTENT — eyeball the first frame with real UI.
# TTI_SHOTS sets the seconds; a slow phone needs later ones (A10s: "4 8 12 16 20").
$ADB shell am force-stop "$PKG"; sleep 1; $ADB logcat -c || true; $ADB shell am start "$ACT" >/dev/null
PREV=0
for t in ${TTI_SHOTS:-2 4 6 8}; do
  sleep $(( t - PREV )); PREV=$t
  $ADB shell screencap -p /sdcard/tti_$t.png 2>/dev/null || true
  $ADB pull /sdcard/tti_$t.png "$SHOTS/tti_${t}s.png" >/dev/null 2>&1 || true
  $ADB shell rm -f /sdcard/tti_$t.png 2>/dev/null || true
  if [[ -s "$SHOTS/tti_${t}s.png" ]]; then echo "  captured tti_${t}s.png"; else echo "  WARN: tti_${t}s.png empty (screencap failed)"; fi
done
echo "  --> 'Displayed' = first frame. Open $SHOTS; the first frame with real content is the true TTI."

echo; echo "## 3. MEMORY — Listen tab  (settle ~3s after the first frame)"
wait_displayed_ms 40 >/dev/null || echo "  WARN: no 'Displayed' line in 40 s — the app may still be on the splash."
sleep 3
# Android 10 prints the sum as "TOTAL: <pss>"; later versions print "TOTAL PSS:".
$ADB shell dumpsys meminfo "$PKG" | grep -E "TOTAL PSS|TOTAL RSS|TOTAL:|Native Heap:|Java Heap:|Graphics:|GL mtrack:" || true

if [[ "$MUSHAF" -eq 1 ]]; then
  echo; echo "## 3b. MEMORY — Mushaf reading page  (INTERACTIVE)"
  if [[ -t 0 ]]; then
    read -r -p "  Open a Mushaf reading page (e.g. Al-Baqarah), turn ~10 pages, then press Enter... " _
    $ADB shell dumpsys meminfo "$PKG" | grep -E "TOTAL PSS|Native Heap:|Java Heap:|Graphics:|GL mtrack:" || true
  else
    echo "  (skipped — not an interactive shell. Capture Mushaf PSS manually:"
    echo "   navigate to a reading page, then: $ADB shell dumpsys meminfo $PKG | grep 'TOTAL PSS')"
  fi
fi

echo; echo "## 4. SCROLL JANK — Listen tab (reset gfx, 4 swipe cycles, read)"
$ADB shell dumpsys gfxinfo "$PKG" reset >/dev/null; $ADB logcat -c || true
sleep 1
for i in 1 2 3 4; do
  $ADB shell input swipe "$SWIPE_X" "$SWIPE_LOW" "$SWIPE_X" "$SWIPE_HIGH" 250
  $ADB shell input swipe "$SWIPE_X" "$SWIPE_HIGH" "$SWIPE_X" "$SWIPE_LOW" 250
done
$ADB shell dumpsys gfxinfo "$PKG" | grep -E "Total frames|Janky frames|50th|90th|95th|99th|Number Missed|HISTOGRAM" || true
echo "  -- GC / large-object churn during the swipes --"
$ADB logcat -d | grep -iE "Choreographer.*Skipped|freed.*LOS|Background concurrent|explicit" | tail -5 || true

echo; echo "## 5. APK COMPOSITION (all installed APKs incl. splits)"
PATHS=""
while IFS= read -r p; do [[ -n "$p" ]] && PATHS="$PATHS $p"; done < <($ADB shell pm path "$PKG" | sed 's/package://' | tr -d '\r')
NPATH="$(echo $PATHS | wc -w | tr -d ' ')"
[[ "$NPATH" -gt 1 ]] && echo "  NOTE: split install ($NPATH APKs) — summing native/dex/etc across ALL splits"
APKDIR="$OUTDIR/${LABEL}-${SERIAL}-apks"; mkdir -p "$APKDIR"
LOCAL=""; idx=0
for p in $PATHS; do
  f="$APKDIR/part_$idx.apk"
  if $ADB pull "$p" "$f" >/dev/null 2>&1; then LOCAL="$LOCAL $f"; fi
  idx=$((idx+1))
done
if [[ -n "$LOCAL" ]]; then
  echo "  total install size: $(du -ch $LOCAL | tail -1 | cut -f1)  ($NPATH apk file(s))"
  for f in $LOCAL; do unzip -l "$f"; done | awk '
    $4 ~ /\.mp3$/   {mp3+=$1}
    $4 ~ /\.dex$/   {dex+=$1}
    $4 ~ /\.so$/    {so+=$1}
    $4 ~ /\.(ttf|otf)$/ {font+=$1}
    $4 ~ /index\.android\.bundle/ {bundle=$1}
    END{printf "  mp3=%.1fMB  dex=%.1fMB(R8 %s)  native=%.1fMB  fonts=%.1fMB  jsbundle=%.1fMB\n", \
        mp3/1e6, dex/1e6, (dex/1e6>30?"OFF":"on"), so/1e6, font/1e6, bundle/1e6}'
  echo "  ABIs present: $(for f in $LOCAL; do unzip -l "$f"; done | grep -oE 'lib/[^/]+' | sort -u | sed 's#lib/##' | tr '\n' ' ')"
fi

echo; echo "=========================================================="
echo " Report written to: $REPORT"
echo " Screenshots:       $SHOTS"
echo " Diff two runs:     diff <baseline-report> <branch-report>"
echo "=========================================================="
