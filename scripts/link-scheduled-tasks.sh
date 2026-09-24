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
# USAGE
#   scripts/link-scheduled-tasks.sh            # migrate + sync (idempotent)
#   scripts/link-scheduled-tasks.sh --check    # verify only; non-zero if drifted
#
# Re-run --check any time (e.g. from the daily loop) to prove the live copy still
# matches the repo, and that nothing has turned back into a symlink.

set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
LIVE_ROOT="$HOME/.claude/scheduled-tasks"

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
REPO_ROOT="$TASKS_TREE/.claude/scheduled-tasks"

if [[ ! -d "$TASKS_TREE/.git" && ! -f "$TASKS_TREE/.git" ]]; then
  printf '\033[31m%s\033[0m\n' "  x  tasks worktree missing: $TASKS_TREE"
  echo "     Create it, then re-run:"
  echo "       git -C \"$REPO\" fetch origin"
  echo "       git -C \"$REPO\" worktree add --detach \"$TASKS_TREE\" origin/qariah-main"
  echo "     Do NOT fall back to the main checkout - that is what broke 2026-09-04."
  exit 1
fi
BACKUP="$HOME/.claude/scheduled-tasks-backup-$(date +%Y%m%d-%H%M%S)"

# Only tasks belonging to THIS project. Other tasks (backups, self-improvement)
# are not this repo's business and are deliberately left alone.
TASKS=(qariah-daily-triage-fix-loop qariah-daily-auto-sprint qariah-biweekly-hygiene-sweep)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
warn()  { printf '\033[33m%s\033[0m\n' "$1"; }

drift=0

# Pull the pinned worktree up to origin/qariah-main first. Without this, --check
# compares against a stale tree and can report drift that does not exist.
git -C "$TASKS_TREE" fetch origin --quiet 2>/dev/null || true
git -C "$TASKS_TREE" checkout --detach --quiet origin/qariah-main 2>/dev/null || true

for task in "${TASKS[@]}"; do
  live="$LIVE_ROOT/$task/SKILL.md"
  tracked="$REPO_ROOT/$task/SKILL.md"

  if [[ $CHECK_ONLY -eq 1 ]]; then
    if [[ ! -e "$live" ]]; then
      warn "  ?  $task — no live task installed on this machine"
    elif [[ -L "$live" ]]; then
      # A symlink is now the BROKEN state, not the correct one: the desktop app
      # cannot read a routine through one, which greys out "Run now".
      red   "  ✗  $task — SYMLINK: the app cannot read routines through a link"; drift=1
    elif [[ ! -e "$tracked" ]]; then
      red   "  ✗  $task — no tracked copy in the repo"; drift=1
    elif cmp -s "$live" "$tracked"; then
      green "  ✓  $task — live copy matches the repo"
    else
      red   "  ✗  $task — DRIFTED: live copy differs from the repo"; drift=1
      diff -u "$tracked" "$live" | head -20 || true
    fi
    continue
  fi

  [[ -e "$live" ]] || { warn "  skip $task — not installed on this machine"; continue; }

  mkdir -p "$(dirname "$tracked")"

  # FIRST MIGRATION ONLY: no repo copy yet, so seed it from the live file, which
  # is by definition the one the runner has been using.
  if [[ ! -e "$tracked" && ! -L "$live" ]]; then
    mkdir -p "$BACKUP/$task"
    cp -p "$live" "$BACKUP/$task/SKILL.md"
    cp -p "$live" "$tracked"
    green "  ✓  $task — seeded the repo copy from the live file"
    continue
  fi

  if [[ ! -e "$tracked" ]]; then
    red "  x  $task — live path is a symlink and there is no repo copy to sync from"
    red "     Restore the file by hand before re-running; nothing was changed."
    drift=1; continue
  fi

  # Already a real file with matching content? Nothing to do.
  if [[ ! -L "$live" ]] && cmp -s "$live" "$tracked"; then
    green "  ✓  $task — already in sync"; continue
  fi

  if [[ -L "$live" ]]; then
    warn "  ~  $task — replacing symlink with a real copy (the app cannot read links)"
  else
    # A real file that differs. The REPO wins now — it is the reviewed copy —
    # but never discard the live one silently: it is what actually ran.
    mkdir -p "$BACKUP/$task"
    cp -p "$live" "$BACKUP/$task/SKILL.md"
    warn "  !  $task — live copy DIFFERED from the repo; repo wins"
    warn "     the live copy that ran is saved at $BACKUP/$task/SKILL.md — diff it"
  fi

  rm -f "$live"
  cp -p "$tracked" "$live"
  green "  ✓  $task — synced from the repo"
done

if [[ $CHECK_ONLY -eq 1 ]]; then
  [[ $drift -eq 0 ]] && { green "scheduled tasks: no drift"; exit 0; }
  red "scheduled tasks: DRIFT DETECTED — re-run without --check to repair"; exit 1
fi

echo
green "Done. The live paths are real files synced from the repo:"
for task in "${TASKS[@]}"; do
  live="$LIVE_ROOT/$task/SKILL.md"
  [[ -f "$live" && ! -L "$live" ]] && printf '  %s  (%s bytes)\n' "$live" "$(wc -c < "$live" | tr -d ' ')"
done
[[ -d "$BACKUP" ]] && echo && echo "Originals backed up to: $BACKUP"
echo
echo "Next: review and commit —"
echo "  git -C $REPO add .claude/scheduled-tasks && git -C $REPO status --short"
