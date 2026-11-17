#!/usr/bin/env bash
#
# Bring the machine-local Claude scheduled tasks under version control.
#
# THE PROBLEM THIS SOLVES
#   Scheduled tasks live in ~/.claude/scheduled-tasks/<name>/SKILL.md. That tree is
#   NOT a git repo, so a task file is invisible to review, invisible to CI, and
#   exists on exactly one machine. On 2026-08-18 that cost a day of wrong reports:
#   the daily loop's report format was corrected in the repo's skill, but a SECOND
#   copy of the superseded format sat in the scheduled-task file, unversioned, and
#   kept winning. Fixing one copy could never have held.
#
# WHAT IT DOES
#   Keeps each Qariah task file in the repo at .claude/scheduled-tasks/<name>/ and
#   SYNCS A REAL FILE COPY out to the live path. Git is the source of truth; the
#   live path is a materialised copy of it.
#
# WHY A COPY AND NOT A SYMLINK (changed 2026-09-06)
#   It used to symlink, which made drift structurally impossible. That is the
#   nicer property and it had to be given up: the Claude desktop app does not
#   read a routine through a symlink. It reported
#       "Routine file not found or has an unexpected format"
#   and greyed out "Run now", so the task could not be triggered by hand at all.
#   The tell was that both symlinked tasks showed an EMPTY description in the
#   scheduler while every regular-file task parsed its frontmatter correctly.
#   Automatic runs were unaffected — the scheduler fires from its own registry —
#   which is why this went unnoticed: only the manual trigger was broken, and
#   only when someone tried to debug a run.
#
#   The cost is that a copy CAN drift. --check is what buys the guarantee back,
#   so keep running it from the daily loop.
#
# THE SYNC AT THE START OF EACH MAC RUN (2026-11-15)
#   From 2026-11-06 to 2026-11-15 all five live copies were stale: --check reported
#   the drift, and nothing repaired it, so the merged fixes never reached a run (the
#   held-tree prune among them). Now scripts/run-start.sh calls --run-start at the
#   start of each Mac scheduled run. It moves the task tree to origin/qariah-main
#   (only when the tree is clean), copies each changed task file, and writes the
#   result for the run-health line (`tasks=` in scripts/run-end.sh).
#   The desktop app reads SKILL.md when a task fires: "Changes take effect on the
#   next run" (https://code.claude.com/docs/en/desktop-scheduled-tasks). So a sync
#   in a run does not change the prompt of that run; the new file starts with the
#   next run. Each copy is a rename of a complete file, so the app never reads a
#   half-written or a missing file.
#
# USAGE
#   scripts/link-scheduled-tasks.sh            # migrate + sync (idempotent), for a person
#   scripts/link-scheduled-tasks.sh --check    # verify only; exit 1 if drifted
#   scripts/link-scheduled-tasks.sh --run-start <task> [--state-file=<path>]
#       # scripts/run-start.sh on the Mac. The last line is `tasks=<state>`:
#       #   synced   it copied one or more task files; no drift is left
#       #   current  each live copy already matched; nothing to copy
#       #   stale    the task tree did not reach origin/qariah-main (a failed fetch,
#       #            local changes, a local commit, a failed checkout). It synced from the
#       #            commit it has when that commit is on origin/qariah-main; else it
#       #            copied nothing
#       #   drift    a live copy still differs after the sync (the lines say which)
#       #   no-tree  the task tree is missing; nothing was synced
#       # It exits 0 on each of these (2 on a usage error): a sync problem never stops
#       # the run. --state-file writes `tasks=<state> at=<epoch ms>` for run-end.sh, and
#       # a live copy that differed is saved in <its folder>/task-backups/<time>/ (the
#       # newest 5 stay).
#
#   --check and --run-start compare with the task file at the COMMIT of the task tree
#   (`git show HEAD:<path>`), so an uncommitted edit in the tree never reaches a live
#   copy. The default mode reads the files in the tree, as before.
#
# PATHS (the environment variable first, then the documented default)
#   QARIAH_TASKS_TREE       the detached task tree   ($HOME/claude/.qariah-tasks)
#   QARIAH_LIVE_TASKS_DIR   the live task folder     ($CLAUDE_CONFIG_DIR/scheduled-tasks,
#                                                     else $HOME/.claude/scheduled-tasks)
#
# Re-run --check any time (e.g. from the daily loop) to prove the live copy still
# matches the repo, and that nothing has turned back into a symlink.

set -uo pipefail

usage() {
  echo "usage: scripts/link-scheduled-tasks.sh [--check | --run-start <task> [--state-file=<path>]]" >&2
  exit 2
}

MODE=sync
RUN_TASK=""
STATE_FILE=""
case "${1:-}" in
  '') ;;
  --check) MODE=check; [ $# -eq 1 ] || usage ;;
  --run-start)
    MODE=run
    RUN_TASK="${2:-}"
    [ -n "$RUN_TASK" ] && [ "${RUN_TASK#-}" = "$RUN_TASK" ] || usage
    shift 2
    for a in "$@"; do
      case "$a" in
        --state-file=?*) STATE_FILE="${a#--state-file=}" ;;
        *) usage ;;
      esac
    done
    ;;
  *) usage ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$here" rev-parse --show-toplevel 2>/dev/null || (cd "$here/.." && pwd))"

if [ -n "${QARIAH_LIVE_TASKS_DIR:-}" ]; then
  LIVE_ROOT="$QARIAH_LIVE_TASKS_DIR"
elif [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
  LIVE_ROOT="$CLAUDE_CONFIG_DIR/scheduled-tasks"
else
  LIVE_ROOT="$HOME/.claude/scheduled-tasks"
fi

# WHERE THE TRACKED COPIES LIVE - and why it is NOT the main checkout.
#
#   Linking the live task files into ~/claude/qariah-v2 broke the daily loop on
#   2026-09-04. That checkout does not stay on qariah-main: it is routinely parked
#   on release/3.2.0-pre-sdk56, which carries no .claude/scheduled-tasks/ at all.
#   The symlinks went dangling, the scheduler could not read SKILL.md, and the run
#   was skipped with no error anyone saw. A scheduled task must not depend on which
#   branch a working tree happens to hold.
#
#   So the tracked copies live in a DETACHED worktree pinned to origin/qariah-main.
#   Detached on purpose: if it held the branch, the loop's own `git checkout
#   qariah-main` in the main checkout would fail.
#
#   Resolution order: environment override, then the documented default.
TASKS_TREE="${QARIAH_TASKS_TREE:-$HOME/claude/.qariah-tasks}"
TRACKED_REL=".claude/scheduled-tasks"
REPO_ROOT="$TASKS_TREE/$TRACKED_REL"
STAMP="$(date +%Y%m%d-%H%M%S)"
# Where a live copy that differed is saved before the repo copy replaces it. A person's
# run: ~/.claude/scheduled-tasks-backup-<time>/, as before. --run-start: the run's state
# folder (<dirname of --state-file>/task-backups/<time>/), and only the newest
# BACKUPS_KEPT of them stay, so a daily run does not add a folder to ~/.claude each day.
# With no --state-file, a run saves nothing (the repo copy is in git; an edit made in the
# app is then lost, and the line says so).
BACKUPS_KEPT=5
if [ "$MODE" = run ]; then
  BACKUP_ROOT=""
  [ -n "$STATE_FILE" ] && BACKUP_ROOT="$(dirname "$STATE_FILE")/task-backups"
  BACKUP="${BACKUP_ROOT:+$BACKUP_ROOT/$STAMP}"
else
  BACKUP="$(dirname "$LIVE_ROOT")/scheduled-tasks-backup-$STAMP"
fi

# Delete all but the newest $2 backup folders in $1 (the names sort by time).
prune_backups() {
  local root="$1" keep="$2" d i n
  local all=()
  for d in "$root"/[0-9]*; do
    [ -d "$d" ] && all+=("$d")
  done
  n=${#all[@]}
  [ "$n" -le "$keep" ] && return 0
  for ((i = 0; i < n - keep; i++)); do
    rm -rf "${all[$i]}"
  done
}

# Only tasks belonging to THIS project. Other tasks (backups, self-improvement)
# are not this repo's business and are deliberately left alone.
TASKS=(qariah-daily-triage-fix-loop qariah-daily-auto-sprint qariah-biweekly-hygiene-sweep qariah-release-auditor qariah-promoter)

# The scheduled task that starts each run-start.sh task on the Mac.
own_task_of() {
  case "$1" in
    drafts) echo qariah-daily-triage-fix-loop ;;
    autoSprint) echo qariah-daily-auto-sprint ;;
    auditor) echo qariah-release-auditor ;;
    promoter) echo qariah-promoter ;;
    *) echo "" ;;
  esac
}
OWN_TASK="$(own_task_of "$RUN_TASK")"

# Colour only on a terminal: run-start.sh copies these lines into a report.
if [ -t 1 ]; then
  green() { printf '\033[32m%s\033[0m\n' "$1"; }
  red() { printf '\033[31m%s\033[0m\n' "$1"; }
  warn() { printf '\033[33m%s\033[0m\n' "$1"; }
else
  green() { printf '%s\n' "$1"; }
  red() { printf '%s\n' "$1"; }
  warn() { printf '%s\n' "$1"; }
fi
# The lines of --run-start start with "tasks: ".
say() { if [ "$MODE" = run ]; then printf 'tasks: %s\n' "$1"; else "${2:-green}" "  $1"; fi; }

# Print the result line, write the state file, and end. --run-start only.
finish_run() {
  echo "tasks=$1"
  if [ -n "$STATE_FILE" ]; then
    if mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null &&
      printf 'tasks=%s at=%s\n' "$1" "$(($(date +%s) * 1000))" >"$STATE_FILE" 2>/dev/null; then
      :
    else
      echo "tasks: WARN could not write $STATE_FILE"
    fi
  fi
  exit 0
}

if [[ ! -d "$TASKS_TREE/.git" && ! -f "$TASKS_TREE/.git" ]]; then
  if [ "$MODE" = run ]; then
    say "FAIL the task tree is missing: $TASKS_TREE. Nothing was synced. Create it: git -C \"$REPO\" worktree add --detach \"$TASKS_TREE\" origin/qariah-main"
    finish_run no-tree
  fi
  red "  x  tasks worktree missing: $TASKS_TREE"
  echo "     Create it, then re-run:"
  echo "       git -C \"$REPO\" fetch origin"
  echo "       git -C \"$REPO\" worktree add --detach \"$TASKS_TREE\" origin/qariah-main"
  echo "     Do NOT fall back to the main checkout - that is what broke 2026-09-04."
  exit 1
fi

scratch="$(mktemp -d "${TMPDIR:-/tmp}/qariah-task-sync.XXXXXX")" || {
  echo "link-scheduled-tasks: cannot make a temporary folder" >&2
  [ "$MODE" = run ] && finish_run drift
  exit 1
}
trap 'rm -rf "$scratch"' EXIT

# --- move the task tree to origin/qariah-main ---------------------------------------
# Fetch first: a fetch changes no file in the tree. Then check out origin/qariah-main
# only when `git status` shows nothing, so a person's edit in the tree is never lost.
# A failed fetch or a dirty tree does not stop anything: the tree stays where it is,
# the lines say why, and the sync uses the commit that the tree has.
tree_ok=1
first_line() { head -1 "$1" 2>/dev/null | cut -c1-160; }
update_tree() {
  local before after url slug fetched=0
  before="$(git -C "$TASKS_TREE" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  local env_args=(GIT_TERMINAL_PROMPT=0)
  if [ -z "${GIT_SSH_COMMAND:-}" ] && [ -z "$(git -C "$TASKS_TREE" config --get core.sshCommand 2>/dev/null)" ]; then
    # BatchMode: an unattended run must never wait at a passphrase prompt.
    env_args+=("GIT_SSH_COMMAND=ssh -o BatchMode=yes -o ConnectTimeout=20")
  fi
  if env "${env_args[@]}" bash "$here/bounded.sh" 2 -- git -C "$TASKS_TREE" fetch --quiet origin qariah-main 2>"$scratch/fetch.err"; then
    fetched=1
  else
    # No SSH key in the agent: fetch over HTTPS with the gh login
    # (docs/operations/standing-rules/process-agents.md, 2026-11-04).
    url="$(git -C "$TASKS_TREE" remote get-url origin 2>/dev/null || true)"
    slug=""
    case "$url" in
      *github.com[:/]*/*)
        slug="${url#*github.com[:/]}"
        slug="${slug%.git}"
        ;;
    esac
    if [ -n "$slug" ] && command -v gh >/dev/null 2>&1 &&
      env GIT_TERMINAL_PROMPT=0 bash "$here/bounded.sh" 2 -- git -C "$TASKS_TREE" \
        -c credential.helper= -c 'credential.helper=!gh auth git-credential' \
        fetch --quiet "https://github.com/$slug.git" qariah-main:refs/remotes/origin/qariah-main 2>>"$scratch/fetch.err"; then
      fetched=1
      say "the fetch over SSH failed; the fetch over HTTPS (gh login) worked" warn
    fi
  fi
  if [ "$fetched" -eq 0 ]; then
    tree_ok=0
    say "WARN the fetch of origin/qariah-main failed ($(first_line "$scratch/fetch.err")). The sync uses the last fetched origin/qariah-main." warn
  fi

  local dirty
  if ! dirty="$(git -C "$TASKS_TREE" status --porcelain 2>"$scratch/status.err")"; then
    tree_ok=0
    say "WARN git cannot read the task tree ($(first_line "$scratch/status.err")). It stays at $before." warn
    return
  fi
  if [ -n "$dirty" ]; then
    tree_ok=0
    say "WARN the task tree has local changes ($(printf '%s\n' "$dirty" | head -1 | cut -c1-120)), so it stays at $before. Nothing in it was changed." warn
    return
  fi
  # A commit made in the tree is not on origin/qariah-main: a checkout would leave it.
  if ! git -C "$TASKS_TREE" merge-base --is-ancestor HEAD origin/qariah-main 2>/dev/null; then
    tree_ok=0
    say "WARN the task tree is at $before, which is not on origin/qariah-main (a local commit, or no origin/qariah-main), so it stays there." warn
    return
  fi
  if ! git -C "$TASKS_TREE" checkout --detach --quiet origin/qariah-main 2>"$scratch/checkout.err"; then
    tree_ok=0
    say "WARN the checkout of origin/qariah-main failed ($(first_line "$scratch/checkout.err")). The tree stays at $before." warn
    return
  fi
  after="$(git -C "$TASKS_TREE" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  if [ "$before" = "$after" ]; then
    say "the task tree is at origin/qariah-main ($after)"
  else
    say "moved the task tree from $before to origin/qariah-main ($after)"
  fi
}
update_tree

# --run-start with a stale tree: copy from the tree's commit only when that commit is on
# origin/qariah-main (reviewed text, only older). Else copy nothing.
if [[ $MODE == run && $tree_ok -eq 0 ]] &&
  ! git -C "$TASKS_TREE" merge-base --is-ancestor HEAD origin/qariah-main 2>/dev/null; then
  say "WARN nothing was copied: the commit of the task tree is not on origin/qariah-main. The live files stay as they are." warn
  finish_run stale
fi

# The tracked copy of a task. --check and --run-start: the file at the tree's commit,
# in a temporary file. The default mode: the file in the tree. Prints the path; fails
# when there is none.
tracked_of() {
  local task="$1"
  if [ "$MODE" = sync ]; then
    [ -e "$REPO_ROOT/$task/SKILL.md" ] || return 1
    printf '%s\n' "$REPO_ROOT/$task/SKILL.md"
    return 0
  fi
  git -C "$TASKS_TREE" show "HEAD:$TRACKED_REL/$task/SKILL.md" >"$scratch/$task.md" 2>/dev/null || return 1
  printf '%s\n' "$scratch/$task.md"
}

# Replace the live file in one rename: the app never reads a half-written or a
# missing file, and a symlink at the path is replaced by a real file.
install_copy() {
  local from="$1" live="$2" tmp
  tmp="$(dirname "$live")/.SKILL.md.sync.$$"
  cp "$from" "$tmp" 2>/dev/null && mv -f "$tmp" "$live" 2>/dev/null && return 0
  rm -f "$tmp" 2>/dev/null
  return 1
}

drift=0
drifted=()
copied=0

for task in "${TASKS[@]}"; do
  live="$LIVE_ROOT/$task/SKILL.md"
  tracked="$(tracked_of "$task")" || tracked=""

  if [[ $MODE == check ]]; then
    if [[ ! -e "$live" && ! -L "$live" ]]; then
      warn "  ?  $task — no live task installed on this machine"
    elif [[ -L "$live" ]]; then
      # A symlink is now the BROKEN state, not the correct one: the desktop app
      # cannot read a routine through one, which greys out "Run now".
      red "  ✗  $task — SYMLINK: the app cannot read routines through a link"
      drift=1
      drifted+=("$task")
    elif [[ -z "$tracked" ]]; then
      red "  ✗  $task — no tracked copy in the repo"
      drift=1
      drifted+=("$task")
    elif cmp -s "$live" "$tracked"; then
      green "  ✓  $task — live copy matches the repo"
    else
      red "  ✗  $task — DRIFTED: live copy differs from the repo"
      drift=1
      drifted+=("$task")
      diff -u "$tracked" "$live" | head -20 || true
    fi
    continue
  fi

  if [[ ! -e "$live" && ! -L "$live" ]]; then
    say "skip $task — not installed on this machine" warn
    continue
  fi

  # FIRST MIGRATION ONLY (a person runs it): no repo copy yet, so seed it from the
  # live file, which is by definition the one the runner has been using. A run
  # never writes into the task tree.
  if [[ $MODE == sync && -z "$tracked" && ! -L "$live" ]]; then
    mkdir -p "$BACKUP/$task" "$REPO_ROOT/$task"
    cp -p "$live" "$BACKUP/$task/SKILL.md"
    cp -p "$live" "$REPO_ROOT/$task/SKILL.md"
    green "  ✓  $task — seeded the repo copy from the live file"
    continue
  fi

  if [[ -z "$tracked" ]]; then
    say "x  $task — there is no tracked copy to sync from (the live file stays)" red
    drift=1
    drifted+=("$task")
    continue
  fi

  # Already a real file with matching content? Nothing to do.
  if [[ ! -L "$live" ]] && cmp -s "$live" "$tracked"; then
    [ "$MODE" = run ] || green "  ✓  $task — already in sync"
    continue
  fi

  if [[ -L "$live" ]]; then
    say "~  $task — replacing symlink with a real copy (the app cannot read links)" warn
  else
    # A real file that differs. The REPO wins now — it is the reviewed copy —
    # but never discard the live one silently: it is what actually ran.
    say "!  $task — live copy DIFFERED from the repo; repo wins" warn
    if [ -n "$BACKUP" ] && mkdir -p "$BACKUP/$task" 2>/dev/null && cp -p "$live" "$BACKUP/$task/SKILL.md" 2>/dev/null; then
      say "   the live copy that ran is saved at $BACKUP/$task/SKILL.md — diff it" warn
    else
      say "   the live copy that ran was NOT saved (no backup folder); the repo copy is in git" warn
    fi
  fi

  if install_copy "$tracked" "$live" && [[ ! -L "$live" ]] && cmp -s "$live" "$tracked"; then
    copied=$((copied + 1))
    if [[ $MODE == run && $task == "$OWN_TASK" ]]; then
      say "✓  $task — synced from the repo. This run keeps the prompt that it started with; the new file starts with the next run."
    else
      say "✓  $task — synced from the repo"
    fi
  else
    say "x  $task — the copy to $live failed" red
    drift=1
    drifted+=("$task")
  fi
done

at="$(git -C "$TASKS_TREE" rev-parse --short HEAD 2>/dev/null || echo unknown)"

if [[ $MODE == run ]]; then
  [ -n "$BACKUP_ROOT" ] && [ -d "$BACKUP_ROOT" ] && prune_backups "$BACKUP_ROOT" "$BACKUPS_KEPT"
  if [ "$drift" -ne 0 ]; then
    say "drift is left in: ${drifted[*]}"
    finish_run drift
  fi
  [ "$tree_ok" -eq 0 ] && finish_run stale
  [ "$copied" -gt 0 ] && finish_run synced
  finish_run current
fi

if [[ $MODE == check ]]; then
  stale_note=""
  [ "$tree_ok" -eq 0 ] && stale_note=", STALE: the task tree did not reach origin/qariah-main (see the WARN line)"
  if [ "$drift" -eq 0 ]; then
    green "tasks-check: ok (each live copy matches the task tree at $at$stale_note)"
    exit 0
  fi
  red "tasks-check: DRIFT in $(
    IFS=,
    echo "${drifted[*]}"
  ) (task tree at $at$stale_note). The next run-start.sh syncs it; by hand: bash scripts/link-scheduled-tasks.sh"
  exit 1
fi

echo
green "Done. The live paths are real files synced from the repo:"
for task in "${TASKS[@]}"; do
  live="$LIVE_ROOT/$task/SKILL.md"
  [[ -f "$live" && ! -L "$live" ]] && printf '  %s  (%s bytes)\n' "$live" "$(wc -c <"$live" | tr -d ' ')"
done
[[ -d "$BACKUP" ]] && echo && echo "Originals backed up to: $BACKUP"
echo
echo "Next: review and commit any seeded copy —"
echo "  git -C $TASKS_TREE status --short -- $TRACKED_REL"
[ "$drift" -eq 0 ]
