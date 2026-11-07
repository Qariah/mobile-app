#!/bin/bash
# @ai
# Run `node scripts/play-rollout-mirror.mjs mirror --apply` on this Mac every
# 6 hours, so the Android production rollout follows the iOS phased release
# (owner, 2026-11-01). The rules are in scripts/lib/play-rollout-mirror.mjs.
#
# Why on the Mac: the mirror changes the Play rollout, and only the Mac's Play
# key has the "Release manager" role. The cloud's Play key is view-only by design.
#
#   bash scripts/play-rollout-mirror-local.sh --install    # install the launch agent
#   bash scripts/play-rollout-mirror-local.sh --uninstall  # remove it
#   bash "$QARIAH_ANDROID_RAMP_DIR/run.sh"                 # one run now
#
# --install copies this script to $QARIAH_ANDROID_RAMP_DIR/run.sh (default
# ~/claude/.scratch/android-ramp), and the launch agent runs that copy at
# 00:20, 06:20, 12:20 and 18:20 local time (launchd runs a missed time at the
# next wake). Each run moves its own detached worktree ($DIR/tree) to
# origin/qariah-main and runs the mirror there, never in the main checkout. So
# a change to docs/operations/active-rollout.json `androidMirror` takes effect
# when it merges.
#
# Secrets: the main checkout's .env.local (untracked).
# Output: $DIR/logs/<date>.log; a macOS notification for each rollout change
# and for each failure.
# End: when the mirror exits 3 (the Android release is completed, or
# androidMirror.enabled is false), the run removes the launch agent.
set -euo pipefail

LABEL=com.qariah.play-rollout-mirror
DIR="${QARIAH_ANDROID_RAMP_DIR:-$HOME/claude/.scratch/android-ramp}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"Android rollout mirror\"" >/dev/null 2>&1 || true
}
uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
}

if [[ "${1:-}" == "--uninstall" ]]; then
  uninstall
  echo "removed $PLIST"
  exit 0
fi

if [[ "${1:-}" == "--install" ]]; then
  # The main checkout: the parent of the shared git directory of this worktree.
  repo="$(dirname "$(git -C "$(dirname "$0")" rev-parse --path-format=absolute --git-common-dir)")"
  # launchd has a short PATH: give it the directories of node and git.
  path_dirs="$(dirname "$(command -v node)"):$(dirname "$(command -v git)"):/usr/bin:/bin:/usr/sbin:/sbin"
  mkdir -p "$DIR/logs" "$(dirname "$PLIST")"
  cp "$0" "$DIR/run.sh"
  times=""
  for h in 0 6 12 18; do
    times+="<dict><key>Hour</key><integer>$h</integer><key>Minute</key><integer>20</integer></dict>"
  done
  cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$DIR/run.sh</string></array>
  <key>StartCalendarInterval</key>
  <array>$times</array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$path_dirs</string>
    <key>HOME</key><string>$HOME</string>
    <key>QARIAH_REPO</key><string>$repo</string>
    <key>QARIAH_ANDROID_RAMP_DIR</key><string>$DIR</string>
  </dict>
  <key>StandardOutPath</key><string>$DIR/logs/launchd.out</string>
  <key>StandardErrorPath</key><string>$DIR/logs/launchd.err</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "installed $PLIST (00:20, 06:20, 12:20 and 18:20 local time; repo $repo)"
  exit 0
fi

REPO="${QARIAH_REPO:?QARIAH_REPO is not set (install with --install)}"
TREE="$DIR/tree"
LOG="$DIR/logs/$(date +%F).log"
mkdir -p "$DIR/logs"
exec > >(tee -a "$LOG") 2>&1
echo "== $(date -u +%FT%TZ) start"
trap 'echo "== FAILED at line $LINENO"; notify "Failed. See $LOG"' ERR

git -C "$REPO" fetch -q origin
if [[ ! -e "$TREE/.git" ]]; then
  git -C "$REPO" worktree add -q --detach "$TREE" origin/qariah-main
fi
git -C "$TREE" checkout -q --detach origin/qariah-main
echo "tree at $(git -C "$TREE" log --oneline -1)"

set -a
# shellcheck disable=SC1091
. "$REPO/.env.local"
set +a

cd "$TREE"
set +e
out="$(node --dns-result-order=ipv4first scripts/play-rollout-mirror.mjs mirror --apply 2>&1)"
rc=$?
set -e
echo "$out"
case "$rc" in
  0)
    if grep -q '✓ committed' <<<"$out"; then
      notify "$(grep '✓ committed' <<<"$out" | sed 's/^✓ committed edit [0-9]*: //')"
    fi
    ;;
  3)
    echo "nothing more to do: removing the launch agent"
    notify "The Android rollout mirror is finished; its launch agent is removed."
    uninstall
    ;;
  *)
    echo "== the mirror failed (exit $rc)"
    notify "The mirror failed (exit $rc). See $LOG"
    exit "$rc"
    ;;
esac
echo "== $(date -u +%FT%TZ) done"
