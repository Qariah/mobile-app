#!/usr/bin/env bash
# notify-owner-queue.sh — the Notification, StopFailure and SessionEnd hook of a scheduled run.
#
# WHY. A question (AskUserQuestion), a permission prompt or a crash in an unattended run
# stalls the run, and nobody is told (owner, 2026-11-04). This hook files one `owner-queue`
# `info` issue (scripts/owner-queue.mjs) so that the Steward sees it within 4 hours:
#   Notification   → "a run waits: <task>"   (the run waits on a prompt nobody answers)
#   StopFailure    → "a run failed: <task>"  (the run died: an API error, a crash)
#   SessionEnd     → "a run ended with no run-end: <task>"  (the session ended, and
#                    scripts/run-end.sh never ran: the run-state file still exists)
#
# It does NOTHING in an interactive session. A scheduled run is one of:
#   - a session that ran scripts/run-start.sh: <root>/.claude/.run-state/<session_id>.json
#     exists (the run-limits hook wrote it; <root> is the main checkout);
#   - a session that holds <root>/.claude/.autonomous-run (the auto-sprint, the Auditor,
#     the Promoter); the marker names the task, or it is empty (the auto-sprint).
# With neither, exit 0 at once.
#
# Wired in the committed .claude/settings.json. Input: the hook JSON on stdin. Output: one
# line to <state dir>/owner-queue-notify.log, and nothing on stdout. Exit 0 always: a hook
# failure must never stop a run.
#
# Test overrides (the hook's own environment only):
#   QARIAH_RUN_STATE_DIR          the state directory (as the run-limits hook)
#   QARIAH_OWNER_QUEUE_EXTRA_ARGS extra arguments for owner-queue.mjs ask (the tests pass --dry-run)
set -uo pipefail

raw="$(cat 2>/dev/null || true)"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tree="$(cd "$here/.." && pwd)"

common="$(git -C "${CLAUDE_PROJECT_DIR:-$tree}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
[ -n "$common" ] || exit 0
root="$(dirname "$common")"
state_dir="${QARIAH_RUN_STATE_DIR:-$root/.claude/.run-state}"
marker="$root/.claude/.autonomous-run"

command -v node >/dev/null 2>&1 || exit 0

# One node call reads the input and the state, and prints: <event> <sid> <task> <message>
read -r event sid task message < <(
  RAW="$raw" STATE_DIR="$state_dir" MARKER="$marker" node -e '
    const fs = require("fs"), path = require("path");
    let i = {};
    try { i = JSON.parse(process.env.RAW || "{}"); } catch {}
    const sid = String(i.session_id || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 128);
    const event = String(i.hook_event_name || "");
    let task = "";
    const file = sid && path.join(process.env.STATE_DIR, sid + ".json");
    if (file && fs.existsSync(file)) {
      try { task = JSON.parse(fs.readFileSync(file, "utf8")).task || ""; } catch { task = "unknown"; }
    } else if (fs.existsSync(process.env.MARKER)) {
      try { task = fs.readFileSync(process.env.MARKER, "utf8").trim() || "autoSprint"; } catch { task = "autoSprint"; }
      if (event === "SessionEnd") task = ""; // run-end.sh removes the marker; a held marker is another run
    }
    const msg = String(i.message || i.error || i.reason || i.notification_type || "")
      .replace(/\s+/g, " ").trim().slice(0, 400);
    console.log([event, sid || "-", task || "-", msg].join(" "));
  ' 2>/dev/null || echo "- - - -"
)
[ "$task" != "-" ] && [ -n "$task" ] || exit 0

case "$event" in
  Notification)
    title="a run waits: $task"
    key="run-waits-$task"
    what="The scheduled run \`$task\` (session \`$sid\`) stopped on a prompt that nobody answers: \`${message:-a notification}\`. A scheduled run never asks. The run is stalled until its wall clock ends it. Check the session, end it, and move the question to this queue."
    ;;
  StopFailure)
    title="a run failed: $task"
    key="run-failed-$task"
    what="The scheduled run \`$task\` (session \`$sid\`) stopped with an error: \`${message:-unknown}\`. Its run-health line may be missing on the Daily card. Check the session log, and file what it left undone."
    ;;
  SessionEnd)
    title="a run ended with no run-end: $task"
    key="run-no-end-$task"
    what="The session \`$sid\` of the scheduled run \`$task\` ended, and \`scripts/run-end.sh\` never ran: its run-state file still exists. The run posted no run-health line. Read the session log for what it left undone."
    ;;
  *) exit 0 ;;
esac
key="$(printf '%s' "$key" | tr '[:upper:]' '[:lower:]')"

mkdir -p "$state_dir" 2>/dev/null || true
log="$state_dir/owner-queue-notify.log"
body="$(mktemp "${TMPDIR:-/tmp}/owner-queue-notify.XXXXXX")" || exit 0
printf '%s\n\n- event: %s\n- session: %s\n- at: %s\n' "$what" "$event" "$sid" "$(date -u +%FT%TZ)" >"$body"

# shellcheck disable=SC2086 # the extra args are the test's --dry-run
out="$(cd "$tree" && node scripts/owner-queue.mjs ask --kind=info --title="$title" --key="$key" --run=hook --body-file="$body" ${QARIAH_OWNER_QUEUE_EXTRA_ARGS:-} 2>&1)"
rc=$?
rm -f "$body"
printf '%s %s %s task=%s rc=%s %s\n' "$(date -u +%FT%TZ)" "$event" "$sid" "$task" "$rc" "$(printf '%s' "$out" | head -1)" >>"$log" 2>/dev/null
exit 0
