#!/usr/bin/env bash
# @ai
#
# scripts/apply-patches.sh — apply every file in patches/ to node_modules
# before a release build, and stop the build when one does not apply
# (TECH_DEBT #401).
#
# Why: patch-package runs only at install (the `postinstall` script). A
# worktree that moves to a newer qariah-main keeps the node_modules of the
# older install, so a new or changed patch is not in it. The internal beta
# 3.2.4 (3942) shipped without the #773 (worklets) and #779 (expo-audio)
# patches this way (2026-11-07).
#
# patch-package skips a patch that is already applied and applies a patch
# that is not. With --error-on-fail it exits 1 when a patch does not apply
# (for example, node_modules holds an older version of a changed patch).
#
# Usage:  bash scripts/apply-patches.sh [<repo root>]
#         The default root is the checkout of this script.
# Callers: scripts/android-archive.sh, scripts/qariah-ios-archive.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"

if [ ! -d "$ROOT/patches" ]; then
    echo "✓ No patches/ folder in $ROOT; nothing to apply."
    exit 0
fi

PATCH_PACKAGE="$ROOT/node_modules/patch-package/index.js"
if [ ! -f "$PATCH_PACKAGE" ]; then
    echo "❌ patch-package is not in $ROOT/node_modules." >&2
    echo "   Run 'npm ci' in $ROOT, then run the build again." >&2
    exit 1
fi

echo "🩹 Applying patches/ to node_modules (patch-package --error-on-fail)..."
if ! (cd "$ROOT" && node "$PATCH_PACKAGE" --error-on-fail); then
    echo "❌ A file in patches/ does not apply to node_modules. The build stops here." >&2
    echo "   A build from this node_modules would ship the old native code (TECH_DEBT #401)." >&2
    echo "   Fix: run 'npm ci' in $ROOT. Or reverse the old patch:" >&2
    echo "     git show <install commit>:patches/<file> > old.patch && git apply -R old.patch" >&2
    echo "   Then run 'npx patch-package' and check that it prints ✔ for each package." >&2
    exit 1
fi
echo "✓ Each patch in patches/ is applied."
