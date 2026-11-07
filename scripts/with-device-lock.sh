#!/usr/bin/env bash
# with-device-lock.sh — serialize access to the single attached Android device.
#
# Qariah drives ONE Pixel across several device-touching workflows: qariah-boot-gate-verify,
# the daily qariah-triage-loop's Pixel-3 release smoke, the Maestro smoke/regression suites,
# and ad-hoc adb. With a single device, any two running at once collide — the worst case is
# the Maestro gRPC instrumentation wedge (.maestro/README.md gotcha #7), which leaves the app
# hung on the spinner and needs a manual pm-clear to recover.
#
# This is a tiny cross-process mutex: exactly one holder at a time, auto-released on exit.
# No daemon, no dependency (atomic `mkdir` — there is no `flock` on macOS), works on
# macOS + Linux + CI alike. A blocked caller sees WHO holds the device and for how long.
#
# Usage:
#   scripts/with-device-lock.sh [--serial=SERIAL] [--label=TEXT] [--timeout=SEC] -- CMD [ARGS...]
#
# Examples:
#   scripts/with-device-lock.sh --label="sprint-39 boot-gate" -- maestro test .maestro/flows/smoke/
#   scripts/with-device-lock.sh --label="triage-loop smoke"   -- scripts/android-device-smoke.sh --apk=…
#   scripts/with-device-lock.sh -- "$ADB" shell am force-stop com.qariah.app
#
# Behaviour:
#   * Atomic acquire via `mkdir` (POSIX-atomic — exactly one winner).
#   * Auto-release on any exit (EXIT/INT/TERM trap) — normal runs never leave a stale lock.
#   * Stale-steal: if the recorded holder PID is dead, the lock is reclaimed automatically.
#   * Blocks up to --timeout (default 1800s) for a LIVE holder, reporting the holder each poll.
#   * Exports ANDROID_SERIAL for the wrapped command so adb/maestro target the locked device.
#   * Exit code is the wrapped command's exit code (or 1 on lock timeout / usage error).

set -u

SERIAL=""
LABEL="${USER:-unknown}"
TIMEOUT=1800

while [ $# -gt 0 ]; do
  case "$1" in
    --serial=*)  SERIAL="${1#*=}"; shift ;;
    --label=*)   LABEL="${1#*=}"; shift ;;
    --timeout=*) TIMEOUT="${1#*=}"; shift ;;
    --) shift; break ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "with-device-lock: unknown arg '$1' (did you forget the '--' before the command?)" >&2; exit 1 ;;
  esac
done

if [ $# -eq 0 ]; then
  echo "with-device-lock: no command given — expected '... -- CMD [ARGS]'" >&2
  exit 1
fi

# Resolve adb, then default SERIAL to the single attached device (if exactly one).
ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
[ -x "$ADB" ] || ADB="$(command -v adb 2>/dev/null || true)"
if [ -z "$SERIAL" ] && [ -n "$ADB" ]; then
  count=$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device"{n++} END{print n+0}')
  if [ "$count" = "1" ]; then
    SERIAL=$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device"{print $1; exit}')
  fi
fi
SERIAL="${SERIAL:-default}"

# Re-entrant: if this process tree already holds the lock for this serial (a parent
# with-device-lock is wrapping us, or a self-locking script re-exec'd under us), just
# run — don't self-deadlock on mkdir. Makes the wrapper safe to nest.
if [ "${QARIAH_DEVICE_LOCK_HELD:-}" = "$SERIAL" ]; then
  exec "$@"
fi

LOCKDIR="${TMPDIR:-/tmp}/qariah-device-${SERIAL}.lock"
LOCKDIR="${LOCKDIR%/}"        # normalize any trailing slash from TMPDIR
HOLDER="$LOCKDIR/holder"
OWNED=0

release() { [ "$OWNED" = "1" ] && rm -rf "$LOCKDIR" 2>/dev/null; }
trap release EXIT INT TERM

start=$(date +%s)
while :; do
  if mkdir "$LOCKDIR" 2>/dev/null; then
    OWNED=1
    printf 'pid=%s\nlabel=%s\nhost=%s\nsince=%s\n' \
      "$$" "$LABEL" "$(hostname -s 2>/dev/null)" "$(date '+%Y-%m-%d %H:%M:%S')" > "$HOLDER"
    break
  fi
  # Held — is the holder still alive?
  hpid=$(sed -n 's/^pid=//p' "$HOLDER" 2>/dev/null)
  if [ -n "$hpid" ] && ! kill -0 "$hpid" 2>/dev/null; then
    echo "with-device-lock: stale lock (holder pid $hpid is dead) — reclaiming ${SERIAL}" >&2
    rm -rf "$LOCKDIR" 2>/dev/null
    continue
  fi
  elapsed=$(( $(date +%s) - start ))
  if [ "$elapsed" -ge "$TIMEOUT" ]; then
    echo "with-device-lock: timed out after ${TIMEOUT}s waiting for device ${SERIAL}." >&2
    [ -f "$HOLDER" ] && { echo "  held by:" >&2; sed 's/^/    /' "$HOLDER" >&2; }
    exit 1
  fi
  hlabel=$(sed -n 's/^label=//p' "$HOLDER" 2>/dev/null)
  echo "with-device-lock: device ${SERIAL} busy [${hlabel:-?}]; waiting ${elapsed}/${TIMEOUT}s…" >&2
  sleep 5
done

export ANDROID_SERIAL="$SERIAL"
export QARIAH_DEVICE_LOCK_HELD="$SERIAL"   # lets nested/self-locking children skip re-locking
"$@"
exit $?
