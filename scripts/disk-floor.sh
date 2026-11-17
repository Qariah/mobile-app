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
# For `build`: when free space is below the floor, it first removes the trees of held or
# dead runs that hold nothing to lose (scripts/prune-held-trees.mjs: an earlier day's
# `qariah-v2-auto-<date>`, a leftover `qariah-v2-audit-<sha>`; pushed, only version-file
# changes, no process inside). A held sprint kept its 17 GB tree, so each later run failed
# this floor too (2026-11-10 and 11-11). Then, if still below, it deletes the regenerable
# output of idle trees (scripts/disk-purge.mjs: node_modules, ios/Pods and the build
# folders of an earlier auto-sprint tree, of a worktree with no change in 3 days, and of a
# scratch checkout with no change in 24 hours; old lab APKs; old DerivedData/Bayaan-* and
# DerivedData/WebDriverAgent-*, but the newest WebDriverAgent-*; and, with --releases, by
# its retention rule, the store builds in ~/qariah-releases older than 14 days that
# docs/operations/active-rollout.json does not name). It never deletes a
# simulator. The run held at this
# floor on 11-10, 11-11, 11-13 and 11-14 while that output used most of the disk.
# Then, if still below, it purges what a build makes
# again by itself, once: DerivedData/Qariah-*, the Gradle transforms, the npm and CocoaPods
# caches, and the `expo-sqlite-*` folders that a full Jest run leaves in $TMPDIR (older than
# one hour, TECH_DEBT #317). The next build is slower. Nothing is lost.
# When a purge ran, it adds one line to <state dir>/disk-freed.ndjson (the GB before, after
# and freed). scripts/run-end.sh puts the sum in the run's run-health line (purgedGB=).
# The Gradle transforms stay while a Gradle daemon runs, and DerivedData stays while an
# xcodebuild runs: on 2026-11-11 the purge deleted the transforms under an idle daemon, and
# the next build of another session failed with NoSuchFileException.
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
free_kb() { df -k "$HOME" 2>/dev/null | awk 'NR==2 {print $4}'; }
gb="$(free_gb)"
if [ -z "$gb" ]; then
  echo "disk-floor: FAIL df could not read $HOME" >&2
  exit 1
fi
kb_before="$(free_kb)"
purged=0
if [ "$gb" -lt "$floor_gb" ] && [ "$kind" = build ]; then
  purged=1
  echo "disk-floor: ${gb} GB free on \$HOME, below the ${floor_gb} GB build floor. Removing the held run trees that hold nothing to lose."
  (cd "$tree" && node "$tree/scripts/prune-held-trees.mjs")
  gb="$(free_gb)"
fi
if [ "$gb" -lt "$floor_gb" ] && [ "$kind" = build ]; then
  echo "disk-floor: ${gb} GB free on \$HOME, below the ${floor_gb} GB build floor. Deleting the regenerable output of idle trees."
  # --releases: the retention rule for ~/qariah-releases runs only here, below the floor.
  (cd "$tree" && node "$tree/scripts/disk-purge.mjs" --releases)
  gb="$(free_gb)"
fi
if [ "$gb" -lt "$floor_gb" ] && [ "$kind" = build ]; then
  echo "disk-floor: ${gb} GB free on \$HOME, below the ${floor_gb} GB build floor. Purging the build caches once."
  if pgrep -x xcodebuild >/dev/null 2>&1; then
    echo "disk-floor: kept DerivedData: an xcodebuild runs."
  else
    rm -rf "$HOME"/Library/Developer/Xcode/DerivedData/Qariah-*
  fi
  if pgrep -f GradleDaemon >/dev/null 2>&1; then
    echo "disk-floor: kept the Gradle transforms: a Gradle daemon runs."
  else
    rm -rf "$HOME"/.gradle/caches/*/transforms
  fi
  rm -rf "$HOME"/.npm/_cacache "$HOME"/Library/Caches/CocoaPods
  find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'expo-sqlite-*' -mmin +60 -exec rm -rf {} + 2>/dev/null
  gb="$(free_gb)"
fi
if [ "$purged" -eq 1 ]; then
  kb_after="$(free_kb)"
  freed="$(awk -v a="${kb_after:-0}" -v b="${kb_before:-0}" 'BEGIN { d = (a - b) / 1024 / 1024; if (d < 0) d = 0; printf "%.1f", d }')"
  echo "disk-floor: the purge freed ${freed} GB (df)"
  common="$(git -C "$tree" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
  if [ -n "$common" ]; then
    state_dir="${QARIAH_RUN_STATE_DIR:-$(dirname "$common")/.claude/.run-state}"
    mkdir -p "$state_dir" 2>/dev/null &&
      printf '{"at":%s,"kind":"%s","beforeGB":%s,"afterGB":%s,"freedGB":%s}\n' \
        "$(node -e 'console.log(Date.now())')" "$kind" \
        "$(awk -v k="${kb_before:-0}" 'BEGIN { printf "%.1f", k / 1024 / 1024 }')" \
        "$(awk -v k="${kb_after:-0}" 'BEGIN { printf "%.1f", k / 1024 / 1024 }')" \
        "$freed" >>"$state_dir/disk-freed.ndjson"
  fi
fi
if [ "$gb" -lt "$floor_gb" ]; then
  echo "disk-floor: FAIL only ${gb} GB free on \$HOME. A $kind step needs ${floor_gb} GB. Do not delete anything to continue: a scheduled run never removes a worktree or a cache by hand. Stop, and report this line and the prune-held-trees lines above (they name each tree that was kept, and why)." >&2
  exit 1
fi
echo "disk-floor: OK (${gb} GB free, $kind floor ${floor_gb} GB)"
