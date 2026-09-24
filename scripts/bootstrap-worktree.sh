#!/usr/bin/env bash
# scripts/bootstrap-worktree.sh
# -----------------------------
# Idempotent per-sprint-worktree environment bootstrap. Fresh git worktrees are
# missing the gitignored files a full build/publish needs, and re-hit the same
# setup papercuts every sprint (Sprints 17, 28, 36, 39, 40). This copies the
# gitignored bits from the main checkout and surfaces the PATH/pod caveats so a
# kickoff boot-gate never fails on a missing file.
#
# Papercuts this closes (each was its own CLAUDE.md standing rule):
#   - ios/ExportOptions.beta.plist is gitignored (carries the team id) → absent
#     in fresh worktrees → scripts/ios-archive.sh --upload hard-aborts pre-flight
#     (Sprint 39, re-stated 2026-06-30).
#   - .env.local must be copied into each worktree (Sprint 17/28).
#   - adb is not on PATH in worktrees — it lives at
#     ~/Library/Android/sdk/platform-tools/adb; a bare `adb`-not-found once got
#     misread as "no device" (Sprint 36).
#   - iOS boot-gate needs `pod install` with SENTRY_DISABLE_AUTO_UPLOAD=true, and
#     Metro started FROM the worktree (Sprint 28 rule #2).
#
# Usage:
#   scripts/bootstrap-worktree.sh            # copy gitignored files + report
#   scripts/bootstrap-worktree.sh --ios      # also run `pod install` for iOS builds
#
# Safe to re-run: only copies a file when the worktree copy is absent.
# Called by qariah-sprint-kickoff Step 6 (before qariah-boot-gate-verify).

set -euo pipefail

# --- Resolve the main checkout (first entry of `git worktree list`) -----------
# git lists the main working tree first in --porcelain output.
MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
HERE="$(git rev-parse --show-toplevel)"

if [[ "$MAIN" == "$HERE" ]]; then
  echo "→ Running in the main checkout ($HERE) — nothing to copy."
else
  echo "→ Worktree:      $HERE"
  echo "→ Main checkout: $MAIN"
fi

copy_if_missing() {
  local rel="$1"
  if [[ -e "$HERE/$rel" ]]; then
    echo "  ✓ $rel already present"
  elif [[ -e "$MAIN/$rel" ]]; then
    mkdir -p "$HERE/$(dirname "$rel")"
    cp "$MAIN/$rel" "$HERE/$rel"
    echo "  + copied $rel from main checkout"
  else
    echo "  ! $rel absent in BOTH worktree and main checkout — resolve manually"
  fi
}

# --- Gitignored files a worktree needs ---------------------------------------
# .env.local                   — app endpoints + secrets (Sprint 17/28).
# ios/ExportOptions.beta.plist — carries the team id; ios-archive.sh --upload
#                                aborts pre-flight without it (Sprint 39).
if [[ "$MAIN" != "$HERE" ]]; then
  copy_if_missing ".env.local"
  copy_if_missing "ios/ExportOptions.beta.plist"
fi

# --- adb PATH caveat (Sprint 36 — a bare `adb` not-found was misread as
#     "no device"). Can't mutate the caller's shell; verify + advise. ----------
ADB_SDK="$HOME/Library/Android/sdk/platform-tools/adb"
if command -v adb >/dev/null 2>&1; then
  echo "  ✓ adb on PATH ($(command -v adb))"
elif [[ -x "$ADB_SDK" ]]; then
  echo "  ! adb NOT on PATH — use the SDK path or run:"
  echo "      export PATH=\"\$HOME/Library/Android/sdk/platform-tools:\$PATH\""
else
  echo "  ! adb not found on PATH or at $ADB_SDK"
fi

# --- iOS: pod install with Sentry source-map upload disabled (Sprint 28 rule
#     #2 — Debug fails on the Sentry upload step without sentry.properties). ----
if [[ "${1:-}" == "--ios" ]]; then
  echo "→ Running pod install (SENTRY_DISABLE_AUTO_UPLOAD=true) ..."
  ( cd "$HERE/ios" && SENTRY_DISABLE_AUTO_UPLOAD=true pod install )
  echo "  ✓ pods installed"
  echo "  ↳ Reminder: start Metro FROM THIS WORKTREE, or the device loads the"
  echo "    wrong bundle (Sprint 28 rule #2)."
fi

echo "✓ Worktree bootstrap complete."
