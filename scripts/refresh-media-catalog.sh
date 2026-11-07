#!/usr/bin/env bash
# Sprint 28 — daily refresh of the media-native catalog mirror (catalog/media/*).
#
# Keeps the asset-proxy beta soak representative: re-derives the media mirror
# from the live shared catalog so it can't drift if a reciter is added/edited in
# the ops console. Idempotent — a no-op when the shared catalog is unchanged.
#
# Safe to run unattended: writes ONLY the additive catalog/media/* namespace,
# never the shared catalog. The mirror tracks (never leads) the shared catalog's
# version.
#
# Usage:  ./scripts/refresh-media-catalog.sh
# Cron:   install it with ./scripts/install-media-catalog-cron.sh, which derives the
#         repo path and writes the log under ~/claude/.scratch/qariah-logs/.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env.local ]]; then
  echo "[refresh-media-catalog] ERROR: .env.local not found in $(pwd)" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env.local
set +a
echo "[refresh-media-catalog] $(date -u +%Y-%m-%dT%H:%M:%SZ) — refreshing media-native mirror"
node scripts/publish-media-catalog.mjs
