#!/usr/bin/env bash
# One-shot: install the daily media-native catalog refresh cron for the current user.
# Run this once (it appends to your crontab; won't clobber existing entries).
#   ./scripts/install-media-catalog-cron.sh
# Note: on macOS your Terminal/iTerm may need Full Disk Access (System Settings →
# Privacy & Security → Full Disk Access) for `crontab` to write. If it errors,
# grant that and re-run. Remove later with: crontab -l | grep -v refresh-media-catalog | crontab -
set -euo pipefail

# The cron log must survive a reboot, so it is NOT a temp file: temp dirs are
# cleared periodically and /tmp is denied under the agent sandbox.
LOG_DIR="${QARIAH_LOG_DIR:-$HOME/claude/.scratch/qariah-logs}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/media-catalog-refresh.log"
NODE_BIN="$(dirname "$(command -v node)")"
# Derive the repo root from this script, not a hardcoded home directory: the old
# path named a sprint-28 worktree that no longer exists on any machine.
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINE="0 9 * * * cd \"$REPO_DIR\" && ./scripts/refresh-media-catalog.sh >> \"$LOG_FILE\" 2>&1"
PATHLINE="PATH=${NODE_BIN}:/usr/local/bin:/usr/bin:/bin"
existing="$(crontab -l 2>/dev/null || true)"
if grep -q refresh-media-catalog <<<"$existing"; then
  echo "Already installed:"; crontab -l | grep refresh-media-catalog; exit 0
fi
{ printf '%s\n' "$existing"; grep -q '^PATH=' <<<"$existing" || printf '%s\n' "$PATHLINE"; printf '%s\n' "$LINE"; } | crontab -
echo "Installed. Current crontab:"; crontab -l
