#!/usr/bin/env bash
# scripts/browserstack/upload-app.sh
# Upload a release build (APK or IPA) to BrowserStack App Automate.
# Prints the bs://<hashed-id> app_url that run-maestro.sh consumes.
#
# Usage:  scripts/browserstack/upload-app.sh ~/qariah-releases/qariah-3.1.8-1519-bdfdaf1a.apk
# Env:    BROWSERSTACK_USERNAME, BROWSERSTACK_ACCESS_KEY  (keep in .env.local, NOT committed)
set -euo pipefail

APP="${1:?usage: upload-app.sh <path-to-apk-or-ipa>}"
: "${BROWSERSTACK_USERNAME:?set BROWSERSTACK_USERNAME}"
: "${BROWSERSTACK_ACCESS_KEY:?set BROWSERSTACK_ACCESS_KEY}"
[ -f "$APP" ] || { echo "❌ build not found: $APP" >&2; exit 2; }

echo "▶ uploading $APP to BrowserStack App Automate ..." >&2
RESP="$(curl -fsSL -u "$BROWSERSTACK_USERNAME:$BROWSERSTACK_ACCESS_KEY" \
  -X POST "https://api-cloud.browserstack.com/app-automate/upload" \
  -F "file=@${APP}")"

APP_URL="$(printf '%s' "$RESP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).app_url||"")}catch{process.exit(1)}})')"
[ -n "$APP_URL" ] || { echo "❌ upload failed: $RESP" >&2; exit 1; }

echo "$APP_URL"                       # stdout = just the app_url, for piping
echo "✓ $APP_URL" >&2
