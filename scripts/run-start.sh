#!/usr/bin/env bash
# run-start.sh — the FIRST action of every scheduled run.
#
# Usage:
#   bash scripts/run-start.sh <triage|drafts|autoSprint> [--shadow]
#
#   --shadow (triage only): the shadow week of the cloud routine. Writes the marker
#   <root>/.claude/.shadow-run. While it exists, the REST write helpers in
#   scripts/lib/triage-common.mjs refuse every GitHub write except the card on the issue
#   "Daily card (shadow)", prod-close.mjs and review-reply.mjs run as a dry run, and
#   run-end.sh posts the run-health line on "Daily card (shadow)" and removes the marker.
#
# What it does:
#   1. Prints the limits this run works under (docs/operations/auto-sprint-policy.json →
#      runLimits, read from origin/qariah-main like the hook reads it).
#   2. Removes run-state files and the .claude/.autonomous-run marker that are older than
#      runLimits.staleMarkerHours, and says which ones. An old file means a run that died.
#   3. Runs ~/.claude/skills/machine-preflight/preflight.sh and stops on a GAP that this
#      task needs.
#   4. Checks free disk on $HOME against runLimits.diskFloorGB.other. A skip day needs
#      no build space. The auto-sprint checks the build floor later, only when its
#      scope is not empty: `bash scripts/disk-floor.sh build`.
#   Steps 3 and 4 are skipped when CLAUDE_CODE_REMOTE=true (a cloud session).
#
# Exit 0 = start the run. Exit 1 = do not start; write the report, and run
# `bash scripts/run-end.sh <task> FAILED` first.
#
# The PreToolUse hook .claude/hooks/qariah-run-limits.sh sees THIS command before it
# runs and starts the limits for the session (see the handshake in qariah-run-limits.cjs).
# This script checks that the hook did that. If not, it warns and continues: a missing
# hook must not stop the daily work, and run-end.sh then records toolCalls=unknown.
set -uo pipefail

task="${1:-}"
shadow="${2:-}"
case "$task" in
  triage | drafts | autoSprint) ;;
  *)
    echo "usage: bash scripts/run-start.sh <triage|drafts|autoSprint> [--shadow]" >&2
    exit 2
    ;;
esac
case "$shadow" in
  '') ;;
  --shadow)
    [ "$task" = triage ] || {
      echo "run-start: --shadow is for the triage task only" >&2
      exit 2
    }
    ;;
  *)
    echo "usage: bash scripts/run-start.sh <triage|drafts|autoSprint> [--shadow]" >&2
    exit 2
    ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tree="$(cd "$here/.." && pwd)"
hook="$tree/.claude/hooks/qariah-run-limits.cjs"
common="$(git -C "$tree" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || {
  echo "run-start: $tree is not in a git repository" >&2
  exit 1
}
root="$(dirname "$common")"
state_dir="${QARIAH_RUN_STATE_DIR:-$root/.claude/.run-state}"
marker="$root/.claude/.autonomous-run"
shadow_marker="$root/.claude/.shadow-run"
fail=0

# --- 1. limits -----------------------------------------------------------------------
limits_json="$(cd "$tree" && node "$hook" --limits "$task")" || {
  echo "run-start: FAIL cannot read runLimits.$task ($limits_json)" >&2
  exit 1
}
get() { printf '%s' "$limits_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=process.argv[1].split(".").reduce((o,k)=>o&&o[k],JSON.parse(s));console.log(v===undefined||v===null?"":v)})' "$1"; }
floor_key=other
floor_gb="$(get "limits.diskFloorGB.$floor_key")"
stale_h="$(get limits.staleMarkerHours)"
echo "run-start: task=$task maxToolCalls=$(get limits.maxToolCalls) maxWallMinutes=$(get limits.maxWallMinutes)" \
  "commandMinutes=default:$(get limits.commandMinutes.default)/build:$(get limits.commandMinutes.build)/upload:$(get limits.commandMinutes.upload)" \
  "repeatStop=$(get limits.sameCallInARow) diskFloorGB=${floor_gb:-none} (source: $(get source))"
echo "run-start: wrap each long command as: bash scripts/bounded.sh <minutes> -- <command>"

# --- 2. stale markers ----------------------------------------------------------------
stale_min=$(( ${stale_h:-8} * 60 ))
if [ -d "$state_dir" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    rm -f "$f" && echo "run-start: removed a stale run-state file (older than ${stale_h} h): $f"
  done < <(find "$state_dir" -maxdepth 1 -name '*.json' -mmin +"$stale_min" 2>/dev/null)
fi
if [ -f "$marker" ] && [ -n "$(find "$marker" -mmin +"$stale_min" 2>/dev/null)" ]; then
  rm -f "$marker" && echo "run-start: removed a stale .claude/.autonomous-run marker (older than ${stale_h} h). A previous auto-sprint did not end cleanly."
fi
if [ -f "$shadow_marker" ] && [ -n "$(find "$shadow_marker" -mmin +"$stale_min" 2>/dev/null)" ]; then
  rm -f "$shadow_marker" && echo "run-start: removed a stale .claude/.shadow-run marker (older than ${stale_h} h). A previous shadow run did not end cleanly."
fi
if [ "$shadow" = --shadow ]; then
  mkdir -p "$(dirname "$shadow_marker")" && date -u +%FT%TZ >"$shadow_marker" &&
    echo "run-start: SHADOW mode — no GitHub write except the card on \"Daily card (shadow)\"; scripts run as a dry run"
fi

# Did the hook start the limits for this session? (a state file for this task, < 2 min old)
if [ -n "$(find "$state_dir" -maxdepth 1 -name '*.json' ! -name '*.last.json' -mmin -2 2>/dev/null |
  xargs grep -l "\"task\": \"$task\"" 2>/dev/null | head -1)" ]; then
  echo "run-start: limits ACTIVE (the run-limits hook started them for this session)"
else
  echo "run-start: WARN limits NOT ACTIVE — the run-limits hook did not start them. Check .claude/settings.json. The run continues."
fi

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  echo "run-start: cloud session — preflight and disk checks skipped"
  exit 0
fi

# --- 3. preflight --------------------------------------------------------------------
# The GAP names each task needs. Other GAPs (rclone, pnpm, another repo) are reported, not fatal.
# disk:home is left out on purpose: step 4 checks disk against the policy floor.
need="tool:git tool:gh tool:node tool:npm tool:python3 auth:gh repo:qariah-v2 secret:qariah-v2/.env.local"
case "$task" in
  autoSprint) need="$need tool:adb xcode jdk:17 jdk:21 gradle:java-paths" ;;
esac
pf="$HOME/.claude/skills/machine-preflight/preflight.sh"
if [ ! -f "$pf" ]; then
  echo "run-start: FAIL preflight not found at $pf" >&2
  fail=1
else
  pf_out="$(bash "$pf" 2>&1)"
  while IFS= read -r line; do
    name="$(printf '%s' "$line" | awk '{print $2}')"
    case " $need " in
      *" $name "*)
        echo "run-start: FAIL needed $line" >&2
        fail=1
        ;;
      *) echo "run-start: note (not needed by $task) $line" ;;
    esac
  done < <(printf '%s\n' "$pf_out" | grep '^GAP ')
  [ "$fail" -eq 0 ] && echo "run-start: preflight OK (no GAP that $task needs)"
fi

# --- 4. disk floor -------------------------------------------------------------------
free_gb() { df -k "$HOME" 2>/dev/null | awk 'NR==2 {print int($4 / 1024 / 1024)}'; }
if [ -n "$floor_gb" ]; then
  gb="$(free_gb)"
  if [ -z "$gb" ]; then
    echo "run-start: FAIL df could not read $HOME" >&2
    fail=1
  fi
  if [ -n "$gb" ] && [ "$gb" -lt "$floor_gb" ]; then
    echo "run-start: FAIL only ${gb} GB free on \$HOME. This task needs ${floor_gb} GB. Free disk space, then run again (~/.claude/bin/qariah-disk-report.sh shows what is large)." >&2
    fail=1
  elif [ -n "$gb" ]; then
    echo "run-start: disk OK (${gb} GB free, floor ${floor_gb} GB)"
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "run-start: STOP. Do not start the run. Run: bash scripts/run-end.sh $task FAILED, then write the report." >&2
  exit 1
fi
echo "run-start: OK"
