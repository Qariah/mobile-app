#!/usr/bin/env bash
# scripts/forward-port-debt.sh — name every production fix that lives on ONE
# branch only. (Moved into the repository on 2026-11-06 so that the weekly retro
# can run it in a cloud session. ~/.claude/bin/qariah-forward-port-debt.sh on the
# Mac now runs this file.)
#
# WHY THIS EXISTS
# Qariah v2 ships from release/* and hotfix/* branches, not from qariah-main.
# The branches sit on different Expo majors, so a fix does not travel by itself.
# Omar gave the same instruction three times in two days — 2026-09-01 (twice)
# and 2026-09-02: "merge to both release and main". On 2026-09-03 this script's
# own query found 21 release-only commits, including 9 `fix(audio…` and
# `fix(stall…` commits that never reached qariah-main.
# On 2026-10-03 production Android (vc2027) shipped from hotfix/3.2.0-anr-splash.
# The script then scanned release/* only, so it could not see that line.
# It now compares EVERY release/* and hotfix/* branch with main.
#
# The check is read-only. It fetches, compares, and prints. It changes nothing.
#
# Usage:
#   scripts/forward-port-debt.sh [-C <repo>] [--since <date>] [--all] [--release <ref>]
#     --all      list every divergent commit, not only fix/feat/perf commits
#     --release  compare only this ref (for example origin/hotfix/3.2.0-anr-splash)
#
# Default window: the last 14 days. The branches sit on different Expo majors
# and have diverged for months on purpose, so a full-history run reports mostly
# deliberate divergence. Use --since 2026-08-01 for that view.
#
# Exit codes: 0 = no debt, 1 = debt found, 2 = the check could not run.
set -euo pipefail

REPO="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null)"
# 14 days by default: the question is "what diverged since the last look",
# not "how far apart are an SDK-55 and an SDK-56 line" — that answer is large
# and mostly deliberate. Widen it with --since when you want the full picture.
SINCE="14 days ago"
ONLY_FIXES=1
REL_OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    -C) REPO="$2"; shift 2 ;;
    --since) SINCE="$2"; shift 2 ;;
    --all) ONLY_FIXES=0; shift ;;
    --release) REL_OVERRIDE="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || { echo "FAIL: not a git repository: ${REPO:-<none>}" >&2; exit 2; }

# Name the refs: a cloud clone can carry a narrow refspec, and then a plain fetch
# brings no release/* or hotfix/* branch, and the check would say OK. A shallow
# clone is deepened to cover the window (a 30-day margin).
refspecs="+refs/heads/qariah-main:refs/remotes/origin/qariah-main +refs/heads/release/*:refs/remotes/origin/release/* +refs/heads/hotfix/*:refs/remotes/origin/hotfix/*"
deepen=""
if [ "$(git -C "$REPO" rev-parse --is-shallow-repository 2>/dev/null)" = true ]; then
  deepen="--shallow-since=$(date -u -v-30d +%F 2>/dev/null || date -u -d '30 days ago' +%F)"
fi
# shellcheck disable=SC2086 # refspecs and deepen are word lists on purpose
git -C "$REPO" fetch --quiet $deepen origin $refspecs || { echo "FAIL: git fetch origin failed — check the network and gh auth." >&2; exit 2; }

MAIN="origin/qariah-main"
git -C "$REPO" rev-parse --verify --quiet "$MAIN" >/dev/null \
  || { echo "FAIL: $MAIN does not exist." >&2; exit 2; }

# Every production line is a release/* or hotfix/* ref on origin.
# macOS ships bash 3.2, which has no `mapfile`. Use a plain newline list.
if [ -n "$REL_OVERRIDE" ]; then
  LINES="$REL_OVERRIDE"
else
  LINES="$(git -C "$REPO" for-each-ref --format='%(refname:short)' \
    'refs/remotes/origin/release/*' 'refs/remotes/origin/hotfix/*')"
fi
if [ -z "$LINES" ]; then
  echo "OK: origin carries no release/* or hotfix/* branch. Nothing to forward-port."
  exit 0
fi

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

filter() {
  if [ "$ONLY_FIXES" -eq 1 ]; then
    grep -E '^[0-9a-f]+ (fix|feat|perf)\(' || true
  else
    cat
  fi
}

drop_shared() {
  local other="$1" line subj
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    subj="${line#* }"
    grep -qxF "$subj" "$other" || printf '%s\n' "$line"
  done
}

# Compare one production line with main. Returns 1 when debt is found.
compare_line() {
  local rel="$1" rel_raw main_raw rel_only main_only rc=0

  echo "main:    $MAIN"
  echo "line:    $rel"
  echo "since:   $SINCE"
  echo

  # --cherry-pick drops commits that already travelled under a different SHA,
  # so a cherry-picked fix does not show up as debt.
  rel_raw="$(git -C "$REPO" log --oneline --no-merges --cherry-pick --right-only \
    "$MAIN...$rel" --since="$SINCE" | filter)"
  main_raw="$(git -C "$REPO" log --oneline --no-merges --cherry-pick --left-only \
    "$MAIN...$rel" --since="$SINCE" | filter)"

  # `--cherry-pick` matches on patch-id. A fix that was ADAPTED for the other
  # Expo major gets a new patch-id, so it looks like debt while it is not.
  # Second pass: drop any commit whose subject line also appears on the other
  # side. This is a heuristic on the subject text, not proof.
  printf '%s\n' "$rel_raw"  | cut -d' ' -f2- | sort -u > "$TMPD/rel.subj"
  printf '%s\n' "$main_raw" | cut -d' ' -f2- | sort -u > "$TMPD/main.subj"
  rel_only="$(printf '%s\n' "$rel_raw"  | drop_shared "$TMPD/main.subj")"
  main_only="$(printf '%s\n' "$main_raw" | drop_shared "$TMPD/rel.subj")"

  # Hard rule #16: a fix on a production line MUST reach qariah-main.
  if [ -n "$rel_only" ]; then
    echo "DEBT (hard rule #16): on $rel, NOT on $MAIN"
    printf '%s\n' "$rel_only" | sed 's/^/  /'
    echo
    rc=1
  fi
  # The reverse is informational: main is the trunk.
  if [ -n "$main_only" ]; then
    echo "INFO: on $MAIN, NOT on $rel (allowed — main is the trunk)"
    printf '%s\n' "$main_only" | sed 's/^/  /'
    echo
  fi
  if [ "$rc" -eq 0 ]; then
    echo "PASS: no fix/feat/perf commit sits on $rel only since $SINCE."
  fi
  return "$rc"
}

echo "=== Qariah forward-port debt ==="
echo "note: a commit whose subject appears on both branches is treated as"
echo "      already travelled. That is a heuristic. Confirm before you act."
echo

overall=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  echo "--- $line"
  compare_line "$line" || overall=1
  echo
done <<EOF_LINES
$LINES
EOF_LINES

if [ "$overall" -ne 0 ]; then
  echo "FAIL: a production line carries fixes that qariah-main lacks. For each commit:"
  echo "  - forward-port it, or"
  echo "  - record in DIVERGENCE_LEDGER.md why it stays on one branch."
  echo "Do NOT cherry-pick in bulk. The branches sit on different Expo majors."
fi
exit "$overall"
