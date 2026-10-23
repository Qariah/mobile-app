#!/usr/bin/env bash
# wda.sh — build, start and stop WebDriverAgent on the test iPhone (TECH_DEBT #299).
#
# WebDriverAgent (the XCUITest runner of Appium) runs on the phone as a UI test and serves an
# HTTP API on port 8100. The iPhone driver (`scripts/iphone.sh`, `scripts/iphone-device-test.sh`)
# talks to it through the CoreDevice USB tunnel. See planning/sprint-50-iphone-driver-probe.md.
#
# Usage:
#   scripts/iphone/wda.sh start     # build once (cached), then start it on the phone; idempotent
#   scripts/iphone/wda.sh status    # print the /status answer, exit 1 when it does not answer
#   scripts/iphone/wda.sh stop      # stop the runner that `start` started
#   scripts/iphone/wda.sh build     # build (or rebuild with --force) without a start
#
# Environment (all optional):
#   QARIAH_IPHONE_UDID           the test iPhone; default: the only paired physical iPhone
#   QARIAH_IPHONE_DRIVER_HOME    the cache; default: ~/Library/Caches/qariah-iphone-driver
#   QARIAH_WDA_VERSION           the npm version of appium-webdriveragent; default below
#   QARIAH_WDA_BUNDLE_ID         the runner bundle id; default com.qariah.WebDriverAgentRunner
#   APPLE_TEAM_ID                the signing team; default: APPLE_TEAM_ID in .env.local
#
# Signing uses Xcode automatic signing with the Apple account in Xcode → Settings → Accounts.
# The App Store Connect API key cannot register the runner's App ID, so the build does not
# pass it. Never point this at the owner's own iPhone: it gets TestFlight builds only.

set -euo pipefail

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
CACHE="${QARIAH_IPHONE_DRIVER_HOME:-$HOME/Library/Caches/qariah-iphone-driver}"
# 16.14.0 was published 2026-10-04. Raise it only after a probe on the test iPhone.
WDA_VERSION="${QARIAH_WDA_VERSION:-16.14.0}"
BUNDLE_ID="${QARIAH_WDA_BUNDLE_ID:-com.qariah.WebDriverAgentRunner}"
SRC="$CACHE/wda-$WDA_VERSION"
PROJECT="$SRC/package/WebDriverAgent.xcodeproj"
DERIVED="$CACHE/dd-$WDA_VERSION"
RUN_LOG="$CACHE/wda-run.log"
PID_FILE="$CACHE/wda-run.pid"

log() { printf 'wda: %s\n' "$*" >&2; }

udid() {
  if [ -n "${QARIAH_IPHONE_UDID:-}" ]; then
    printf '%s' "$QARIAH_IPHONE_UDID"
    return
  fi
  node --input-type=module -e "
    import { resolveUdid } from '$ROOT/scripts/iphone/lib/device.mjs';
    process.stdout.write(resolveUdid());
  "
}

team_id() {
  if [ -n "${APPLE_TEAM_ID:-}" ]; then
    printf '%s' "$APPLE_TEAM_ID"
    return
  fi
  [ -f "$ROOT/.env.local" ] || { log "no APPLE_TEAM_ID and no $ROOT/.env.local"; exit 1; }
  grep '^APPLE_TEAM_ID=' "$ROOT/.env.local" | head -1 | cut -d= -f2- | tr -d '"'"'"
}

fetch_source() {
  [ -d "$PROJECT" ] && return
  log "download appium-webdriveragent@$WDA_VERSION into $SRC"
  mkdir -p "$SRC"
  npm pack "appium-webdriveragent@$WDA_VERSION" --pack-destination "$SRC" --silent >/dev/null
  tar -xzf "$SRC/appium-webdriveragent-$WDA_VERSION.tgz" -C "$SRC"
  # Give the runner an id of this team, the way Appium's updatedWDABundleId does.
  sed -i '' "s/com\.facebook\.WebDriverAgentRunner/$BUNDLE_ID/g" "$PROJECT/project.pbxproj"
}

xctestrun() {
  find "$DERIVED/Build/Products" -maxdepth 1 -name 'WebDriverAgentRunner_iphoneos*.xctestrun' 2>/dev/null | head -1
}

build() {
  local force="${1:-}"
  fetch_source
  if [ -n "$(xctestrun)" ] && [ "$force" != "--force" ]; then
    return
  fi
  local u t
  u="$(udid)"
  t="$(team_id)"
  log "build WebDriverAgent $WDA_VERSION for $u (team ${t:0:3}…)"
  mkdir -p "$CACHE"
  if ! xcodebuild build-for-testing \
    -project "$PROJECT" -scheme WebDriverAgentRunner \
    -destination "id=$u" -derivedDataPath "$DERIVED" \
    -allowProvisioningUpdates DEVELOPMENT_TEAM="$t" CODE_SIGN_STYLE=Automatic \
    >"$CACHE/wda-build.log" 2>&1; then
    log "build failed; the last lines of $CACHE/wda-build.log:"
    grep -E 'error:|No Accounts|No profiles' "$CACHE/wda-build.log" | tail -5 >&2 || true
    log "a 'No Accounts' error means: sign in to Xcode → Settings → Accounts with the team's Apple ID"
    exit 1
  fi
}

status() {
  node --input-type=module -e "
    import { Wda } from '$ROOT/scripts/iphone/lib/wda.mjs';
    const w = new Wda({ udid: process.argv[1] });
    w.status()
      .then(s => { console.log(JSON.stringify({ url: w.url(), wda: s.build?.version, ios: s.os?.version, ready: s.ready })); })
      .catch(e => { console.error(e.message); process.exit(1); });
  " "$(udid)"
}

start() {
  if status >/dev/null 2>&1; then
    status
    return
  fi
  build
  local u run
  u="$(udid)"
  run="$(xctestrun)"
  [ -n "$run" ] || { log "no .xctestrun after the build"; exit 1; }
  log "start WebDriverAgent on $u (log: $RUN_LOG)"
  nohup xcodebuild test-without-building -xctestrun "$run" -destination "id=$u" >"$RUN_LOG" 2>&1 &
  echo $! >"$PID_FILE"
  node --input-type=module -e "
    import { Wda } from '$ROOT/scripts/iphone/lib/wda.mjs';
    const w = new Wda({ udid: process.argv[1] });
    w.waitReady(Number(process.argv[2]))
      .then(s => console.log(JSON.stringify({ url: w.url(), wda: s.build?.version, ios: s.os?.version, ready: s.ready })))
      .catch(e => { console.error('WebDriverAgent did not answer: ' + e.message); process.exit(1); });
  " "$u" 180000 || {
    log "the last lines of $RUN_LOG:"
    tail -15 "$RUN_LOG" >&2
    log "an unlocked phone and Developer Mode are necessary; a first run can ask to trust the developer on the phone"
    exit 1
  }
}

stop() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE")"
    # Stop only the process that `start` started. A broad pkill could stop an upload (hard rule #12).
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" && log "stopped $pid"
    fi
    rm -f "$PID_FILE"
  else
    log "no runner that this script started"
  fi
}

case "${1:-start}" in
  start) start ;;
  status) status ;;
  stop) stop ;;
  build) build "${2:-}" ;;
  -h | --help) sed -n '2,24p' "$0" ;;
  *) log "unknown command '$1'"; exit 2 ;;
esac
