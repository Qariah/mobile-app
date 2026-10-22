#!/usr/bin/env bash
# One-shot: install the daily media-native catalog refresh cron for the current user.
# Run this once (it appends to your crontab; won't clobber existing entries).
#   ./scripts/install-media-catalog-cron.sh
# Note: on macOS your Terminal/iTerm may need Full Disk Access (System Settings →
# Privacy & Security → Full Disk Access) for `crontab` to write. If it errors,
# grant that and re-run. Remove later with: crontab -l | grep -v refresh-media-catalog | crontab -
set -euo pipefail
NODE_BIN="$(dirname "$(command -v node)")"
LINE="0 9 * * * cd /Users/omarzarka/claude/qariah-v2-sprint-28 && ./scripts/refresh-media-catalog.sh >> /tmp/qariah-media-catalog-refresh.log 2>&1"
PATHLINE="PATH=${NODE_BIN}:/usr/local/bin:/usr/bin:/bin"
existing="$(crontab -l 2>/dev/null || true)"
if grep -q refresh-media-catalog <<<"$existing"; then
  echo "Already installed:"; crontab -l | grep refresh-media-catalog; exit 0
fi
{ printf '%s\n' "$existing"; grep -q '^PATH=' <<<"$existing" || printf '%s\n' "$PATHLINE"; printf '%s\n' "$LINE"; } | crontab -
echo "Installed. Current crontab:"; crontab -l
