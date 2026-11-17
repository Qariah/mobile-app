#!/usr/bin/env bash
# run-end.sh — the LAST action of every scheduled run, before the report. On every path:
# a skip, a finished run, a hard stop, a limit, a failure.
#
# Usage:
#   bash scripts/run-end.sh <triage|drafts|autoSprint|auditor|promoter|steward|upstreamSteward|retro> <DONE|SKIPPED|STOPPED-LIMIT|FAILED> [build]
#
# What it does:
#   1. Reads the final counts of this run. The run-limits hook saw THIS command before it
#      ran: it wrote <state dir>/<session_id>.last.json and removed <session_id>.json, so
#      the limits end here (the handshake is in .claude/hooks/qariah-run-limits.cjs).
#      This script cannot know the session_id, so it reads the newest .last.json for this
#      task that ended in the last 15 minutes. With none, the counts are "unknown".
#   2. autoSprint, auditor, promoter: removes the .claude/.autonomous-run marker that the run
#      armed. The auditor and the promoter write their name in it. A run does not remove the
#      marker of another run (an empty marker is the auto-sprint's).
#   2b. autoSprint on the Mac: deletes android/app/build and ios/build of the run's own tree
#      (`../qariah-v2-auto-<date>`), held or not (scripts/disk-purge.mjs --own-build-output).
#      The APK is in ~/qariah-releases (android-archive.sh copies it), the IPA too
#      (qariah-ios-archive.sh), and the evidence is in ~/qariah-releases/evidence/. A store
#      build, the R8 mapping or the native debug symbols with no copy there move to
#      ~/qariah-releases/saved-builds/ first.
#   3. Posts one line as a comment on the pinned GitHub issue "Daily card" (label `ops`),
#      and creates and pins that issue if it is missing:
#        run-health task=<t> date=<YYYY-MM-DD> status=<s> build=<n|none> toolCalls=<n> minutes=<n> freeGB=<n> purgedGB=<n> tasks=<state>
#      date is the date in the owner's time zone (QARIAH_TZ, default America/Los_Angeles)
#      when the run started. On the Mac that is the local date; a cloud VM runs on UTC.
#      freeGB is the free disk on $HOME now. purgedGB is the GB that this run's purges
#      freed: the disk-floor.sh lines in <state dir>/disk-freed.ndjson since the run
#      started (the last 8 h when the start is unknown), and step 2b. tasks is what the
#      sync of the live task files did at run-start.sh: synced, current, stale, drift or
#      no-tree (scripts/link-scheduled-tasks.sh --run-start); unknown when this run has no
#      record of it, and cloud in a cloud session.
#   4. Shadow mode: when `run-start.sh triage --shadow` wrote <root>/.claude/.shadow-run,
#      the line goes to the issue "Daily card (shadow)" instead, and this script removes
#      the marker.
#
# GitHub calls use REST only (`gh api repos/...`). The Claude Cloud GitHub proxy refuses
# the GraphQL that `gh issue list|create|comment` and `gh repo view` use. Pinning has no
# REST call; it is best effort.
#
# RUN_END_DRY_RUN=1 prints the line and the target issue, and does not post.
# Exit 0 = posted. Exit 1 = the line did not post (the script prints it; put it in the report).
set -uo pipefail

task="${1:-}"
status="${2:-}"
build="${3:-none}"
case "$task" in triage | drafts | autoSprint | auditor | promoter | steward | upstreamSteward | retro) ;; *) task="" ;; esac
case "$status" in DONE | SKIPPED | STOPPED-LIMIT | FAILED) ;; *) status="" ;; esac
if [ -z "$task" ] || [ -z "$status" ]; then
  echo "usage: bash scripts/run-end.sh <triage|drafts|autoSprint|auditor|promoter|steward|upstreamSteward|retro> <DONE|SKIPPED|STOPPED-LIMIT|FAILED> [build]" >&2
  exit 2
fi
case "$build" in
  '' | *[!0-9]*) [ "$build" = none ] || build=none ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
common="$(git -C "$here" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
root="$(dirname "${common:-$here/../.git}")"
state_dir="${QARIAH_RUN_STATE_DIR:-$root/.claude/.run-state}"

# --- 1. counts -----------------------------------------------------------------------
read -r tool_calls minutes run_date started_ms < <(
  STATE_DIR="$state_dir" TASK="$task" node -e '
    const fs = require("fs"), path = require("path");
    const dir = process.env.STATE_DIR, task = process.env.TASK;
    let best = null;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".last.json")) continue;
        try {
          const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
          if (j.task !== task || Date.now() - j.endedAt > 15 * 60000) continue;
          if (!best || j.endedAt > best.endedAt) best = j;
        } catch {}
      }
    } catch {}
    const d = new Date(best ? best.startedAt : Date.now());
    const date = d.toLocaleDateString("en-CA", { timeZone: process.env.QARIAH_TZ || "America/Los_Angeles" });
    const started = best && Number.isFinite(best.startedAt) ? best.startedAt : "unknown";
    console.log(best ? `${best.toolCalls} ${best.minutes} ${date} ${started}` : `unknown unknown ${date} unknown`);
  ' 2>/dev/null || echo "unknown unknown $(date +%F) unknown"
)

# --- 1b. the auto-sprint's own build output ---------------------------------------------
free_kb() { df -k "$HOME" 2>/dev/null | awk 'NR==2 {print $4}'; }
own_freed_kb=0
if [ "$task" = autoSprint ] && [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  own_tree="$(dirname "$root")/qariah-v2-auto-$run_date"
  if [ -d "$own_tree" ]; then
    kb0="$(free_kb)"
    if [ "${RUN_END_DRY_RUN:-}" = "1" ]; then
      node "$here/disk-purge.mjs" --own-build-output="$own_tree" --dry-run 2>&1 | sed 's/^/run-end: /'
    else
      node "$here/disk-purge.mjs" --own-build-output="$own_tree" 2>&1 | sed 's/^/run-end: /'
    fi
    kb1="$(free_kb)"
    if [ -n "$kb0" ] && [ -n "$kb1" ] && [ "$kb1" -gt "$kb0" ]; then own_freed_kb=$((kb1 - kb0)); fi
  fi
fi

# --- 1c. disk: free now, and what this run's purges freed -------------------------------
free_gb="$(df -k "$HOME" 2>/dev/null | awk 'NR==2 {print int($4 / 1024 / 1024)}')"
purged_gb="$(
  STATE_DIR="$state_dir" STARTED="$started_ms" OWN_KB="$own_freed_kb" node -e '
    const fs = require("fs"), path = require("path");
    const since = /^[0-9]+$/.test(process.env.STARTED || "") ? Number(process.env.STARTED) : Date.now() - 8 * 3600e3;
    let gb = Number(process.env.OWN_KB || 0) / 1024 / 1024;
    try {
      for (const l of fs.readFileSync(path.join(process.env.STATE_DIR, "disk-freed.ndjson"), "utf8").split("\n")) {
        try {
          const j = JSON.parse(l);
          if (j.at >= since && Number.isFinite(j.freedGB)) gb += j.freedGB;
        } catch {}
      }
    } catch {}
    console.log(gb.toFixed(1));
  ' 2>/dev/null || echo unknown
)"

# --- 1d. the live task files: what run-start.sh's sync did in this run ------------------
# run-start.sh wrote <state dir>/task-sync.<task>.txt (`tasks=<state> at=<epoch ms>`).
# A file from before this run started (or, with no start time, older than 12 h) is from
# another run: then the state is `unknown`. A cloud session has no live task files.
tasks_state=unknown
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  tasks_state=cloud
elif [ -f "$state_dir/task-sync.$task.txt" ]; then
  tasks_state="$(
    STARTED="$started_ms" node -e '
      const t = require("fs").readFileSync(process.argv[1], "utf8");
      const s = (t.match(/\btasks=([a-z-]+)/) || [])[1];
      const at = Number((t.match(/\bat=(\d+)/) || [])[1]);
      const started = /^[0-9]+$/.test(process.env.STARTED || "") ? Number(process.env.STARTED) : null;
      const fresh = Number.isFinite(at) && (started !== null ? at >= started - 120e3 : Date.now() - at < 12 * 3600e3);
      console.log(s && fresh ? s : "unknown");
    ' "$state_dir/task-sync.$task.txt" 2>/dev/null || echo unknown
  )"
fi

line="run-health task=$task date=$run_date status=$status build=$build toolCalls=$tool_calls minutes=$minutes freeGB=${free_gb:-unknown} purgedGB=${purged_gb:-unknown} tasks=${tasks_state:-unknown}"
echo "$line"

# --- 2. marker -----------------------------------------------------------------------
case "$task" in
  autoSprint | auditor | promoter)
    if [ -f "$root/.claude/.autonomous-run" ]; then
      owner="$(cat "$root/.claude/.autonomous-run" 2>/dev/null || true)"
      if [ -z "$owner" ] && [ "$task" = autoSprint ] || [ "$owner" = "$task" ]; then
        rm -f "$root/.claude/.autonomous-run" && echo "run-end: removed .claude/.autonomous-run"
      else
        echo "run-end: left .claude/.autonomous-run in place (it is held by ${owner:-the auto-sprint})"
      fi
    fi
    ;;
esac

# --- 4. the run is over ----------------------------------------------------------------
# The limits ended with this command (the hook wrote <sid>.last.json). From here the
# session writes its report and ends. It does no follow-up work: the run-limits hook
# denies a write in this session for 24 h (RUN OVER). A question or a finding goes to
# the owner queue, where the Steward answers it within 4 hours.
run_over() {
  if [ "$tool_calls" = unknown ]; then
    echo "run-end: WARN the run-limits hook did not see this run (no .last.json for $task). The RUN OVER rule is not armed for this session."
  fi
  cat <<EOT
run-end: THE RUN IS OVER. Write the report, then end the session. Do no follow-up work here.
run-end: A question, a finding or an owner item goes to the queue, never to the report as prose:
run-end:   node scripts/owner-queue.mjs ask --kind=decision|action|info --title=<text> --body-file=<path> --run=$task
run-end: The report's "What Omar must do" lists owner-queue issue numbers only.
EOT
}

# --- 3. post -------------------------------------------------------------------------
title="Daily card"
shadow_marker="$root/.claude/.shadow-run"
if [ -f "$shadow_marker" ]; then
  title="Daily card (shadow)"
  if [ "${RUN_END_DRY_RUN:-}" != "1" ]; then
    rm -f "$shadow_marker" && echo "run-end: shadow run ended (removed .claude/.shadow-run)"
  fi
fi

post_fail() {
  echo "run-end: FAIL could not post the run-health line ($1). Put the line above in the report." >&2
  exit 1
}
command -v gh >/dev/null 2>&1 || post_fail "gh is not on PATH"

# owner/name, with no GraphQL: QARIAH_REPO, GH_REPO, the origin URL, the default.
REPO="${QARIAH_REPO:-${GH_REPO:-}}"
if [ -z "$REPO" ]; then
  origin="$(git -C "$here" remote get-url origin 2>/dev/null)"
  origin="${origin%.git}"
  case "$origin" in
    *github.com[:/]*/* | */git/*/*) REPO="$(printf '%s' "$origin" | awk -F'[/:]' '{print $(NF-1)"/"$NF}')" ;;
  esac
fi
REPO="${REPO:-omar-zarka/qariah-v2}"

# Page by hand, never `--paginate`: `--paginate` follows GitHub's Link headers, which use
# `repositories/{id}/...` URLs, and the Claude Cloud GitHub proxy refuses those (HTTP 403).
# Each page prints "<item count> <first matching number or nothing>". Stop at a match or at
# a short page. More than 50 full pages is an error, not a silent partial list.
issue=""
page=1
while :; do
  row="$(gh api -X GET "repos/$REPO/issues" -f state=open -f labels=ops -f per_page=100 -f page="$page" \
    --jq "\"\(length) \([.[] | select(.pull_request | not) | select(.title == \"$title\") | .number][0] // \"\")\"" 2>/dev/null)" ||
    post_fail "the REST issue list failed"
  count="${row%% *}"
  issue="${row#* }"
  [ -n "$issue" ] && break
  [ "${count:-0}" -lt 100 ] && break
  page=$((page + 1))
  [ "$page" -gt 50 ] && post_fail "the REST issue list has more than 50 pages"
done

if [ "${RUN_END_DRY_RUN:-}" = "1" ]; then
  if [ -n "$issue" ]; then
    echo "run-end: dry run, not posted (target: https://github.com/$REPO/issues/$issue \"$title\")"
  else
    echo "run-end: dry run, not posted (target: a new issue \"$title\")"
  fi
  run_over
  exit 0
fi

if [ -z "$issue" ]; then
  gh api -X POST "repos/$REPO/labels" -f name=ops -f color=5319E7 \
    -f description="Operations: run health, the daily card" >/dev/null 2>&1 || true
  issue="$(gh api -X POST "repos/$REPO/issues" -f title="$title" -f 'labels[]=ops' -f body="One comment for each scheduled run: \`run-health task=... status=...\`. Written by \`scripts/run-end.sh\`. See planning/claude-cloud-migration-plan.md §11." \
    --jq .number 2>/dev/null)" || post_fail "the REST issue create failed"
  [ -n "$issue" ] || post_fail "the REST issue create returned no number"
  gh issue pin "$issue" --repo "$REPO" >/dev/null 2>&1 || echo "run-end: WARN could not pin issue #$issue (pinning needs GraphQL; pin it by hand)"
  echo "run-end: created the \"$title\" issue #$issue"
fi
gh api -X POST "repos/$REPO/issues/$issue/comments" -f body="$line" >/dev/null 2>&1 || post_fail "the REST comment failed"
echo "run-end: posted on https://github.com/$REPO/issues/$issue"
run_over
