#!/usr/bin/env bash
# disk-floor.sh — check free disk on $HOME against runLimits.diskFloorGB.<kind>.
#
# Usage: bash scripts/disk-floor.sh <build|other>
#
# The auto-sprint runs `disk-floor.sh build` once its scope is not empty, before the
# first build. A both-platform gate uses 25–28 GB, and ENOSPC stopped the runs of
# 09-10, 09-14 and 09-24. A skip day builds nothing, so run-start.sh checks only the
# small `other` floor.
#
# For `build`: when free space is below the floor, it purges
# ~/Library/Developer/Xcode/DerivedData/Qariah-* once, then checks again.
# Exit 0 = enough space. Exit 1 = stop the run with FAILED. Exit 2 = usage error.
set -uo pipefail

kind="${1:-}"
case "$kind" in
  build | other) ;;
  *)
    echo "usage: bash scripts/disk-floor.sh <build|other>" >&2
    exit 2
    ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tree="$(cd "$here/.." && pwd)"
limits_json="$(cd "$tree" && node "$tree/.claude/hooks/qariah-run-limits.cjs" --limits autoSprint)" || {
  echo "disk-floor: FAIL cannot read runLimits ($limits_json)" >&2
  exit 1
}
floor_gb="$(printf '%s' "$limits_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=((JSON.parse(s).limits||{}).diskFloorGB||{})[process.argv[1]];console.log(v==null?"":v)})' "$kind")"
if [ -z "$floor_gb" ]; then
  echo "disk-floor: FAIL runLimits.diskFloorGB.$kind is not set" >&2
  exit 1
fi

free_gb() { df -k "$HOME" 2>/dev/null | awk 'NR==2 {print int($4 / 1024 / 1024)}'; }
gb="$(free_gb)"
if [ -z "$gb" ]; then
  echo "disk-floor: FAIL df could not read $HOME" >&2
  exit 1
fi
if [ "$gb" -lt "$floor_gb" ] && [ "$kind" = build ]; then
  echo "disk-floor: ${gb} GB free on \$HOME, below the ${floor_gb} GB build floor. Purging ~/Library/Developer/Xcode/DerivedData/Qariah-* once."
  rm -rf "$HOME"/Library/Developer/Xcode/DerivedData/Qariah-*
  gb="$(free_gb)"
fi
if [ "$gb" -lt "$floor_gb" ]; then
  echo "disk-floor: FAIL only ${gb} GB free on \$HOME. A $kind step needs ${floor_gb} GB. Free disk space, then run again (~/.claude/bin/qariah-disk-report.sh shows what is large)." >&2
  exit 1
fi
echo "disk-floor: OK (${gb} GB free, $kind floor ${floor_gb} GB)"
