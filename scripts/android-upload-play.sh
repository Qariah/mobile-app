#!/bin/bash
#
# Google Play Developer API — AAB upload + track assignment automation.
#
# Usage:
#   ./scripts/android-upload-play.sh --track=<internal|beta|production> <path/to/app-release.aab>
#
# Pre-requisites (one-time setup; see "Provisioning" block below if missing):
#   - .env.local var `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` pointing at a
#     service-account JSON file (default: ~/.android/play-service-account.json).
#   - That service account must have Play Console "Release manager" role
#     on the com.qariah.app app.
#
# Steps (Google Play Developer API v3):
#   1. JWT-sign access token from the service-account JSON, scope
#      androidpublisher.
#   2. POST /edits → returns edit id.
#   3. POST /upload bundles → uploads AAB.
#   4. PUT /tracks/<track> → assigns versionCode to the chosen track.
#   5. POST /edits/<id>:commit → commits the edit (live on Play).
#
# After upload, appends a row to build/last-play-upload.ndjson:
#   {timestamp, track, versionCode, sha, aabPath}
# Mirrors scripts/ios-archive.sh's testflight-uploads.ndjson audit pattern.
#
# Mirror PR candidate: this script is fork-generic — the package name
# `com.qariah.app` is the only Qariah-specific bit. Lift to upstream
# Bayaan as `scripts/android-upload-play.sh` with `PACKAGE_NAME` sourced
# from `app.config.ts` (or a CLI flag) when convenient.

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────

PACKAGE_NAME="com.qariah.app"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── Argument parsing ─────────────────────────────────────────────────────────

TRACK=""
AAB_PATH=""

for arg in "$@"; do
    case $arg in
        --track=*)
            TRACK="${arg#*=}"
            ;;
        --help|-h)
            sed -n '3,28p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        --*)
            echo -e "${RED}❌ Unknown flag: $arg${NC}"
            exit 1
            ;;
        *)
            if [ -n "$AAB_PATH" ]; then
                echo -e "${RED}❌ Multiple positional args; expected single AAB path.${NC}"
                exit 1
            fi
            AAB_PATH="$arg"
            ;;
    esac
done

if [ -z "$TRACK" ]; then
    echo -e "${RED}❌ --track=<internal|beta|production> required${NC}"
    exit 1
fi
case "$TRACK" in
    internal|alpha|beta|production) ;;
    *)
        echo -e "${RED}❌ Invalid track: $TRACK (expected internal|alpha|beta|production)${NC}"
        exit 1
        ;;
esac

if [ -z "$AAB_PATH" ]; then
    AAB_PATH="$REPO_ROOT/android/app/build/outputs/bundle/release/app-release.aab"
    echo -e "${YELLOW}ℹ️  No AAB path given — defaulting to $AAB_PATH${NC}"
fi
if [ ! -f "$AAB_PATH" ]; then
    echo -e "${RED}❌ AAB not found: $AAB_PATH${NC}"
    echo -e "${RED}   Build first with: ./scripts/android-archive.sh --bundle${NC}"
    exit 1
fi

# ── Load env + service account ───────────────────────────────────────────────

ENV_LOCAL="$REPO_ROOT/.env.local"
if [ -f "$ENV_LOCAL" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_LOCAL"
    set +a
fi

SA_JSON="${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:-$HOME/.android/play-service-account.json}"
if [ ! -f "$SA_JSON" ]; then
    cat <<MSG
${RED}❌ Service-account JSON not found: $SA_JSON${NC}

${YELLOW}Provisioning (one-time):${NC}
  1. GCP Console → IAM & Admin → Service Accounts → Create service account.
     - Name: qariah-play-publisher
     - Grant role "Service Account User" to your user.
     - Create + download a JSON key. Save to:
         ~/.android/play-service-account.json
       (or set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON in .env.local)
  2. Play Console (play.google.com/console) → Setup → API access → Link your
     GCP project → find the new service account in the list → Grant access.
  3. Permissions tab → check "Release manager" role (or at minimum: View app
     info + Manage production/testing/internal track releases).
  4. Re-run this script.
MSG
    exit 1
fi

# Require: openssl, jq, curl, base64.
for cmd in openssl jq curl base64; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo -e "${RED}❌ Required command not found: $cmd${NC}"
        exit 1
    fi
done

# ── Read AAB versionCode (for audit + reporting) ─────────────────────────────
# Prefer aapt2 / aapt if installed; otherwise fall back to bundletool's
# dump-manifest if present; otherwise grep the build.gradle versionCode.
VERSION_CODE=""
if command -v aapt >/dev/null 2>&1; then
    VERSION_CODE=$(aapt dump badging "$AAB_PATH" 2>/dev/null | grep -oE "versionCode='[0-9]+'" | head -1 | grep -oE '[0-9]+' || true)
fi
if [ -z "$VERSION_CODE" ]; then
    # Fallback: derive from build.gradle versionCode (what the AAB would have
    # been built with, assuming no env-var override).
    VERSION_CODE=$(grep -E '^\s*versionCode\s+[0-9]+' "$REPO_ROOT/android/app/build.gradle" 2>/dev/null | head -1 | grep -oE '[0-9]+' || true)
fi
if [ -z "$VERSION_CODE" ]; then
    echo -e "${YELLOW}⚠️  Could not determine versionCode automatically; proceeding without it in the track release.${NC}"
fi

echo -e "${YELLOW}🤖 Google Play Upload${NC}"
echo "===================================="
echo -e "  Package:      ${GREEN}$PACKAGE_NAME${NC}"
echo -e "  Track:        ${GREEN}$TRACK${NC}"
echo -e "  AAB:          ${GREEN}$AAB_PATH${NC}"
echo -e "  versionCode:  ${GREEN}${VERSION_CODE:-<unknown>}${NC}"
echo -e "  Service acct: ${GREEN}$SA_JSON${NC}"
echo ""

# ── Step 1: Mint OAuth2 access token via JWT grant ───────────────────────────

CLIENT_EMAIL=$(jq -r '.client_email' "$SA_JSON")
PRIVATE_KEY=$(jq -r '.private_key' "$SA_JSON")

if [ -z "$CLIENT_EMAIL" ] || [ "$CLIENT_EMAIL" = "null" ]; then
    echo -e "${RED}❌ Service-account JSON missing client_email${NC}"
    exit 1
fi

NOW=$(date +%s)
EXP=$((NOW + 3600))

JWT_HEADER=$(printf '{"alg":"RS256","typ":"JWT"}' | openssl base64 -A | tr '+/' '-_' | tr -d '=')
JWT_PAYLOAD=$(printf '{"iss":"%s","scope":"https://www.googleapis.com/auth/androidpublisher","aud":"https://oauth2.googleapis.com/token","exp":%d,"iat":%d}' \
    "$CLIENT_EMAIL" "$EXP" "$NOW" | openssl base64 -A | tr '+/' '-_' | tr -d '=')

JWT_UNSIGNED="${JWT_HEADER}.${JWT_PAYLOAD}"

# Sign with the service-account private key (PEM in JSON's `private_key`).
PEM_TMP=$(mktemp)
trap 'rm -f "$PEM_TMP"' EXIT
printf '%s' "$PRIVATE_KEY" > "$PEM_TMP"

JWT_SIG=$(printf '%s' "$JWT_UNSIGNED" | openssl dgst -sha256 -sign "$PEM_TMP" | openssl base64 -A | tr '+/' '-_' | tr -d '=')
JWT="${JWT_UNSIGNED}.${JWT_SIG}"

echo -e "${YELLOW}🔑 Requesting OAuth2 access token…${NC}"
TOKEN_RESPONSE=$(curl -sS -X POST https://oauth2.googleapis.com/token \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" \
    --data-urlencode "assertion=${JWT}")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')
if [ -z "$ACCESS_TOKEN" ]; then
    echo -e "${RED}❌ Failed to obtain access token. Response:${NC}"
    echo "$TOKEN_RESPONSE" | jq .
    exit 1
fi
echo -e "${GREEN}✓ Access token acquired${NC}"

API_BASE="https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}"
UPLOAD_BASE="https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE_NAME}"

# ── Step 2: Create edit ──────────────────────────────────────────────────────

echo -e "\n${YELLOW}📝 Opening new edit…${NC}"
EDIT_RESPONSE=$(curl -sS -X POST "${API_BASE}/edits" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Length: 0")
EDIT_ID=$(echo "$EDIT_RESPONSE" | jq -r '.id // empty')
if [ -z "$EDIT_ID" ]; then
    echo -e "${RED}❌ Failed to open edit. Response:${NC}"
    echo "$EDIT_RESPONSE" | jq .
    exit 1
fi
echo -e "${GREEN}✓ Edit id: $EDIT_ID${NC}"

# ── Step 3: Upload AAB ───────────────────────────────────────────────────────

echo -e "\n${YELLOW}📦 Uploading AAB ($(du -h "$AAB_PATH" | cut -f1))…${NC}"
UPLOAD_RESPONSE=$(curl -sS -X POST \
    "${UPLOAD_BASE}/edits/${EDIT_ID}/bundles?ackBundleInstallationWarning=true&uploadType=media" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@${AAB_PATH}")

UPLOADED_VERSION_CODE=$(echo "$UPLOAD_RESPONSE" | jq -r '.versionCode // empty')
if [ -z "$UPLOADED_VERSION_CODE" ]; then
    # Check for duplicate versionCode (most common rejection).
    if echo "$UPLOAD_RESPONSE" | jq -e '.error.message' >/dev/null 2>&1; then
        ERR_MSG=$(echo "$UPLOAD_RESPONSE" | jq -r '.error.message')
        if echo "$ERR_MSG" | grep -qi "version code"; then
            echo -e "${RED}❌ Upload rejected — versionCode likely already used on Play.${NC}"
            echo -e "${RED}   $ERR_MSG${NC}"
            echo -e "${YELLOW}   Bump the commit count (or BUILD_NUMBER) and rebuild the AAB.${NC}"
            exit 1
        fi
    fi
    echo -e "${RED}❌ Upload failed. Response:${NC}"
    echo "$UPLOAD_RESPONSE" | jq .
    exit 1
fi
echo -e "${GREEN}✓ Uploaded versionCode: $UPLOADED_VERSION_CODE${NC}"

# Use the API-reported versionCode (truth-source) over the AAB-extracted one.
VERSION_CODE="$UPLOADED_VERSION_CODE"

# ── Step 4: Assign to track ──────────────────────────────────────────────────

echo -e "\n${YELLOW}🚀 Assigning versionCode $VERSION_CODE to track '$TRACK'…${NC}"
TRACK_PAYLOAD=$(cat <<EOF
{
  "track": "${TRACK}",
  "releases": [
    {
      "name": "${VERSION_CODE}",
      "versionCodes": ["${VERSION_CODE}"],
      "status": "completed"
    }
  ]
}
EOF
)
TRACK_RESPONSE=$(curl -sS -X PUT "${API_BASE}/edits/${EDIT_ID}/tracks/${TRACK}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$TRACK_PAYLOAD")

if ! echo "$TRACK_RESPONSE" | jq -e '.track' >/dev/null 2>&1; then
    echo -e "${RED}❌ Track assignment failed. Response:${NC}"
    echo "$TRACK_RESPONSE" | jq .
    exit 1
fi
echo -e "${GREEN}✓ Track assigned${NC}"

# ── Step 5: Commit edit ──────────────────────────────────────────────────────

echo -e "\n${YELLOW}✅ Committing edit…${NC}"
# The `changesNotSentForReview` query param is app/track-state dependent and
# Google has flipped its requirement twice:
#   - 2026-06 (Sprint 29 internal beta): the param had to be set to `true`,
#     otherwise the commit was rejected ("must be set"); the release then
#     needed a manual "Send for review" in the Console.
#   - 2026-06-04 (this public beta on com.qariah.app/beta): the param must
#     NOT be set — "Changes are sent for review automatically. The query
#     parameter changesNotSentForReview must not be set."
# So we commit ADAPTIVELY: try without the param first (the common
# auto-send-for-review case); if Play complains about the param either way,
# retry with it set. Whichever path commits, the release lands on the track.
commit_edit() {
    curl -sS -X POST "$1" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        -H "Content-Length: 0"
}
COMMIT_RESPONSE=$(commit_edit "${API_BASE}/edits/${EDIT_ID}:commit")
if ! echo "$COMMIT_RESPONSE" | jq -e '.id' >/dev/null 2>&1 \
   && echo "$COMMIT_RESPONSE" | grep -qi 'changesNotSentForReview'; then
    echo -e "${YELLOW}↻ Retrying commit with changesNotSentForReview=true…${NC}"
    COMMIT_RESPONSE=$(commit_edit "${API_BASE}/edits/${EDIT_ID}:commit?changesNotSentForReview=true")
fi

if ! echo "$COMMIT_RESPONSE" | jq -e '.id' >/dev/null 2>&1; then
    echo -e "${RED}❌ Commit failed. Response:${NC}"
    echo "$COMMIT_RESPONSE" | jq .
    exit 1
fi
echo -e "${GREEN}✓ Edit committed — release is live on track '$TRACK'${NC}"

# ── Audit trail ──────────────────────────────────────────────────────────────

REC_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
REC_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
REC_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
REC_DIR="$REPO_ROOT/build"
mkdir -p "$REC_DIR"

REC_TIMESTAMP="$REC_TIMESTAMP" \
REC_SHA="$REC_SHA" \
REC_BRANCH="$REC_BRANCH" \
REC_TRACK="$TRACK" \
REC_VERSION_CODE="$VERSION_CODE" \
REC_AAB_PATH="$AAB_PATH" \
REC_PACKAGE="$PACKAGE_NAME" \
REC_DIR="$REC_DIR" \
node -e "$(cat <<'EOF'
const fs = require('fs');
const path = require('path');
const meta = {
  timestamp: process.env.REC_TIMESTAMP,
  track: process.env.REC_TRACK,
  versionCode: process.env.REC_VERSION_CODE,
  sha: process.env.REC_SHA,
  branch: process.env.REC_BRANCH,
  package: process.env.REC_PACKAGE,
  aabPath: process.env.REC_AAB_PATH,
};
const dir = process.env.REC_DIR;
fs.appendFileSync(path.join(dir, 'last-play-upload.ndjson'), JSON.stringify(meta) + '\n');
console.log('  Audit row appended to ' + path.join(dir, 'last-play-upload.ndjson'));
EOF
)"

echo ""
echo -e "${GREEN}🎉 Done!${NC}"
echo -e "  Track:       $TRACK"
echo -e "  versionCode: $VERSION_CODE"
echo -e "  Console:     https://play.google.com/console/u/0/developers/-/app/-/$PACKAGE_NAME/tracks/$TRACK"
