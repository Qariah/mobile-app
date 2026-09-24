#!/usr/bin/env bash
#
# eas-cloud.sh — run eas-cli from a Mac-less cloud environment.
#
# WHY THIS EXISTS: eas-cli's bundled config loader (this version) cannot read a
# TypeScript app.config.ts. The same workaround is proven in CI
# (.github/workflows/eas-update-preview.yml): compile app.config.ts → app.config.js
# with tsc, move the .ts aside so eas-cli falls back to the .js, run the command,
# then restore. This wrapper does that around any eas subcommand.
#
# USAGE:
#   # JS-only change → publish an OTA bundle to your branch (instant, no native build):
#   scripts/eas-cloud.sh update --branch "$(git branch --show-current)" --message "wip" --platform android
#
#   # Generate your own installable Android build (release-class = preview; dev-client = development):
#   scripts/eas-cloud.sh build --profile preview     --platform android
#   scripts/eas-cloud.sh build --profile development  --platform android
#
# REQUIRES (set as environment secrets in your Claude Cloud env):
#   EXPO_TOKEN                  scoped robot token (build + update on this project)
#   EXPO_PUBLIC_EAS_PROJECT_ID  9da1070a-0852-40df-ac56-6f97a1dce359  (also gates OTA on in app.config.ts)
#
# DO NOT use this to run: `submit`, `--profile production`, `--platform ios`, or
# `--platform all` (owner-only, or Web-broken). Android is the contributor target;
# the guards below block all four. See CONTRIBUTING-CLAUDE-CLOUD.md.

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/eas-cloud.sh <eas-subcommand> [args...]" >&2
  echo "  e.g. scripts/eas-cloud.sh update --branch \"\$(git branch --show-current)\" --message wip --platform android" >&2
  exit 2
fi

# Guard rails — refuse the owner-only operations even if asked.
case "${1:-}" in
  submit)
    echo "eas-cloud: 'eas submit' is owner-only (store credentials). Open a PR and ask the owner." >&2
    exit 3
    ;;
esac
for arg in "$@"; do
  case "$arg" in
    production|--profile=production)
      echo "eas-cloud: the 'production' profile is owner-only. Use --profile preview or development." >&2
      exit 3
      ;;
    all|--platform=all)
      echo "eas-cloud: use --platform android, not 'all' — 'all' also bundles Web, which this app can't export (expo-sqlite has no web worker)." >&2
      exit 3
      ;;
  esac
done

restore() { [ -f app.config.ts.bak ] && mv -f app.config.ts.bak app.config.ts; rm -f app.config.js; }
trap restore EXIT

echo "eas-cloud: compiling app.config.ts → app.config.js for eas-cli…"
npx tsc app.config.ts \
  --module CommonJS \
  --moduleResolution Node \
  --target ES2020 \
  --esModuleInterop \
  --skipLibCheck \
  --resolveJsonModule \
  --ignoreConfig \
  || true   # tsc may emit type errors; the .js emit is still produced.
# --ignoreConfig: TS 6 hard-errors (TS5112, no emit) when files are passed on
# the CLI while tsconfig.json exists; without it app.config.js never appears.
test -f app.config.js || { echo "eas-cloud: app.config.js was not produced — aborting." >&2; exit 1; }
mv app.config.ts app.config.ts.bak

echo "eas-cloud: running → eas $*"
eas "$@"
