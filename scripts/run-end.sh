#!/usr/bin/env bash
# run-end.sh — the LAST action of every scheduled run, before the report. On every path:
# a skip, a finished run, a hard stop, a limit, a failure.
#
# Usage:
#   bash scripts/run-end.sh <triage|drafts|autoSprint> <DONE|SKIPPED|STOPPED-LIMIT|FAILED> [build]
#
# What it does:
#   1. Reads the final counts of this run. The run-limits hook saw THIS command before it
#      ran: it wrote <state dir>/<session_id>.last.json and removed <session_id>.json, so
#      the limits end here (the handshake is in .claude/hooks/qariah-run-limits.cjs).
#      This script cannot know the session_id, so it reads the newest .last.json for this
#      task that ended in the last 15 minutes. With none, the counts are "unknown".
#   2. autoSprint only: removes the .claude/.autonomous-run marker that the sprint armed.
#   3. Posts one line as a comment on the pinned GitHub issue "Daily card" (label `ops`),
#      and creates and pins that issue if it is missing:
#        run-health task=<t> date=<YYYY-MM-DD> status=<s> build=<n|none> toolCalls=<n> minutes=<n>
#      date is the date in the owner's time zone (QARIAH_TZ, default America/Los_Angeles)
#      when the run started. On the Mac that is the local date; a cloud VM runs on UTC.
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
case "$task" in triage | drafts | autoSprint) ;; *) task="" ;; esac
case "$status" in DONE | SKIPPED | STOPPED-LIMIT | FAILED) ;; *) status="" ;; esac
if [ -z "$task" ] || [ -z "$status" ]; then
  echo "usage: bash scripts/run-end.sh <triage|drafts|autoSprint> <DONE|SKIPPED|STOPPED-LIMIT|FAILED> [build]" >&2
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
read -r tool_calls minutes run_date < <(
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
    console.log(best ? `${best.toolCalls} ${best.minutes} ${date}` : `unknown unknown ${date}`);
  ' 2>/dev/null || echo "unknown unknown $(date +%F)"
)

line="run-health task=$task date=$run_date status=$status build=$build toolCalls=$tool_calls minutes=$minutes"
echo "$line"

# --- 2. marker -----------------------------------------------------------------------
if [ "$task" = autoSprint ] && [ -f "$root/.claude/.autonomous-run" ]; then
  rm -f "$root/.claude/.autonomous-run" && echo "run-end: removed .claude/.autonomous-run"
fi

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
