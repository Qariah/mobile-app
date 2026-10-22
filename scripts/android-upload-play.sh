#!/bin/bash
#
# Google Play Developer API — AAB upload + track assignment automation.
#
# Usage:
#   ./scripts/android-upload-play.sh --track=<internal|alpha|beta|production>
#       [--status=<draft|inProgress|completed>] [--user-fraction=<0-1>] <path/to/app-release.aab>
#
#   On the internal, alpha and beta tracks, --status defaults to `completed`.
#   The whole track then gets the build once Play accepts it; alpha and beta
#   go through Play review first. On --track=production, --status is REQUIRED.
#   The script refuses to guess, because `completed` there sends the release
#   to 100% of users at once.
#   For a production release that you roll out by hand from the Console, use
#   --status=draft. To start a 1% staged rollout directly, use
#   --status=inProgress --user-fraction=0.01. A staged rollout needs a fraction
#   strictly between 0 and 1, and the internal track has no staged rollout.
#
#   This script UPLOADS a new AAB. It cannot ramp, halt or complete a release
#   that is already on the track: Play rejects a second upload of the same
#   versionCode. Change a live rollout in the Play Console
#   (Release → Production → Manage rollout).
#
# Pre-requisites (one-time setup; see "Provisioning" block below if missing):
#   - .env.local var `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` pointing at a
#     service-account JSON file (default: ~/.android/play-service-account.json).
#   - That service account must have Play Console "Release manager" role
#     on the com.qariah.app app.
#
# Steps (Google Play Developer API v3):
#   1. JWT-sign access token from the service-account JSON, scope
#      androidpublisher (scripts/lib/google-play-auth.mjs does the signing).
#   2. POST /edits → returns edit id. On production: GET the track, and stop
#      while a staged rollout is live (an upload can stop it).
#   3. POST /upload bundles → uploads AAB.
#   4. PUT /tracks/<track> → assigns versionCode to the chosen track.
#   5. POST /edits/<id>:commit → commits the edit (Play review starts, where it applies).
#
# After upload, appends a row to build/last-play-upload.ndjson:
#   {timestamp, track, status, userFraction, sentForReview, versionCode, sha, aabPath}
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
# Release status on the track. It stays empty until the caller sets it. The
# script sets the per-track default after it parses the arguments.
#   draft      — uploaded + attached to the track but NOT live. A human starts
#                the rollout from the Play Console. This is what you want for a
#                staged production rollout you intend to drive by hand.
#   inProgress — --user-fraction of users (staged rollout, after Play review).
#   completed  — everyone on the track (after Play review, where it applies).
RELEASE_STATUS=""
USER_FRACTION=""

for arg in "$@"; do
    case $arg in
        --track=*)
            TRACK="${arg#*=}"
            ;;
        --status=*)
            RELEASE_STATUS="${arg#*=}"
            ;;
        --user-fraction=*)
            USER_FRACTION="${arg#*=}"
            ;;
        --help|-h)
            # Print the header comment block, from line 3 to the first line
            # that is not a comment.
            awk 'NR>=3 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$0"
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
    echo -e "${RED}❌ --track=<internal|alpha|beta|production> required${NC}"
    exit 1
fi
case "$TRACK" in
    internal|alpha|beta|production) ;;
    *)
        echo -e "${RED}❌ Invalid track: $TRACK (expected internal|alpha|beta|production)${NC}"
        exit 1
        ;;
esac
# On a test track the default `completed` is safe. On production it sends the
# release to 100% of users at once, so the caller must choose.
if [ -z "$RELEASE_STATUS" ]; then
    if [ "$TRACK" = "production" ]; then
        echo -e "${RED}❌ --track=production requires an explicit --status.${NC}"
        echo -e "${RED}   Use --status=draft (start the rollout by hand in the Play Console)${NC}"
        echo -e "${RED}   or --status=inProgress --user-fraction=<0-1> (staged rollout).${NC}"
        echo -e "${RED}   --status=completed sends the release to 100% of users at once.${NC}"
        exit 1
    fi
    RELEASE_STATUS="completed"
fi
# The script refuses `halted`. It always uploads a NEW versionCode, and a halt
# of a release that the script has just uploaded does nothing useful. To halt
# a live rollout, use the Play Console.
case "$RELEASE_STATUS" in
    draft|inProgress|completed) ;;
    *)
        echo -e "${RED}❌ Invalid --status: $RELEASE_STATUS (expected draft|inProgress|completed)${NC}"
        if [ "$RELEASE_STATUS" = "halted" ]; then
            echo -e "${RED}   To halt a live rollout, use the Play Console (Release → Production → Halt rollout).${NC}"
        fi
        exit 1
        ;;
esac
# Play accepts userFraction only on a staged (inProgress) release, and requires
# it there. The internal track has no staged rollout.
if [ "$RELEASE_STATUS" = "inProgress" ]; then
    if [ "$TRACK" = "internal" ]; then
        echo -e "${RED}❌ --status=inProgress is not valid on the internal track (it has no staged rollout).${NC}"
        exit 1
    fi
    if [ -z "$USER_FRACTION" ]; then
        echo -e "${RED}❌ --status=inProgress requires --user-fraction=<0-1> (e.g. 0.01 for 1%)${NC}"
        exit 1
    fi
    # A plain decimal strictly between 0 and 1, for example 0.2 or .05.
    # `20` (meant as 20%), `1.0`, `abc`, extra JSON and a newline fail here.
    # [[ =~ ]] checks the whole string; grep would check each line apart.
    # 1 to 4 decimals, not all zero. A longer value such as
    # 0.99999999999999999999 parses to exactly 1, which Play rejects after
    # the upload.
    if ! [[ "$USER_FRACTION" =~ ^0?\.[0-9]{1,4}$ && "$USER_FRACTION" =~ [1-9] ]]; then
        echo -e "${RED}❌ --user-fraction must be a decimal between 0 and 1, exclusive, with at most 4 decimals (got: $USER_FRACTION). Example: 0.2 for 20%.${NC}"
        exit 1
    fi
    # JSON needs a leading zero: `.2` becomes `0.2`.
    USER_FRACTION="0${USER_FRACTION#0}"
elif [ -n "$USER_FRACTION" ]; then
    echo -e "${RED}❌ --user-fraction is only valid with --status=inProgress; got --status=$RELEASE_STATUS${NC}"
    exit 1
fi

if [ -z "$AAB_PATH" ]; then
    AAB_PATH="$REPO_ROOT/android/app/build/outputs/bundle/release/app-release.aab"
    echo -e "${YELLOW}ℹ️  No AAB path given — defaulting to $AAB_PATH${NC}"
fi
if [ ! -f "$AAB_PATH" ]; then
    echo -e "${RED}❌ AAB not found: $AAB_PATH${NC}"
    if [ "$TRACK" = "production" ]; then
        echo -e "${RED}   Build first with: ./scripts/android-archive.sh --bundle --prod${NC}"
    else
        echo -e "${RED}   Build first with: ./scripts/android-archive.sh --bundle${NC}"
    fi
    exit 1
fi

# The guard above checked TRACK, RELEASE_STATUS and USER_FRACTION. Make them
# read-only, so a key with the same name in .env.local stops the script
# instead of a silent override.
readonly TRACK RELEASE_STATUS USER_FRACTION

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

# Require: node (token helper), jq, curl.
for cmd in node jq curl; do
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

# scripts/lib/google-play-auth.mjs signs the JWT and exchanges it for a token
# (TECH_DEBT #234: one helper for every Google Play script). It prints only the
# token on stdout. A failure goes to stderr with a non-zero exit.
# Node fetch (undici) tries only the IPv6 address on a hung IPv6 route, where
# curl works. --dns-result-order=ipv4first avoids that (CLAUDE.md, 2026-08-15).

echo -e "${YELLOW}🔑 Requesting OAuth2 access token…${NC}"
if ! ACCESS_TOKEN=$(node --dns-result-order=ipv4first "$SCRIPT_DIR/lib/google-play-auth.mjs" --print-token --scope=publisher --sa-file="$SA_JSON"); then
    echo -e "${RED}❌ Failed to obtain access token (the reason is in the message above)${NC}"
    exit 1
fi
if [ -z "$ACCESS_TOKEN" ]; then
    echo -e "${RED}❌ Failed to obtain access token (the helper printed no token)${NC}"
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

# ── Step 2b: Production only — refuse while a staged rollout is live ─────────
# Step 4 sends a track update that holds only the new release. Play can read
# that as the whole release list for the track, so the update could stop a
# staged rollout that is live (Gradle Play Publisher's promote path keeps a
# live rollout in its update for this reason). Read the track first, in this edit, and
# refuse. A failed read also refuses: on production, safe beats fast.
abandon_edit() {
    curl -sS -X DELETE "${API_BASE}/edits/${EDIT_ID}" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" >/dev/null 2>&1 || true
}
# The versionCodes of each live staged (inProgress) release, comma-separated.
# A release with no versionCodes still blocks (it prints "?").
LIVE_STAGED_JQ='[.releases[]? | select(.status == "inProgress") | (.versionCodes // ["?"])[]] | join(",")'
if [ "$TRACK" = "production" ]; then
    TRACK_NOW=$(curl -sS "${API_BASE}/edits/${EDIT_ID}/tracks/production" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}")
    if ! echo "$TRACK_NOW" | jq -e '.track' >/dev/null 2>&1; then
        echo -e "${RED}❌ Cannot read the production track, so the script stops before the upload.${NC}"
        echo "$TRACK_NOW" | jq . 2>/dev/null || echo "$TRACK_NOW"
        abandon_edit
        exit 1
    fi
    LIVE_STAGED=$(echo "$TRACK_NOW" | jq -r "$LIVE_STAGED_JQ")
    if [ -n "$LIVE_STAGED" ]; then
        echo -e "${RED}❌ A staged rollout is live on production (versionCode ${LIVE_STAGED}).${NC}"
        echo -e "${RED}   An upload now can stop it. First complete or halt that rollout in the Play Console.${NC}"
        echo -e "${RED}   Or upload to --track=internal and promote the release in the Play Console.${NC}"
        abandon_edit
        exit 1
    fi
fi

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
# Build the JSON with jq, so that no argument value can change its shape. One
# call for both cases: userFraction is present only for a staged rollout.
TRACK_PAYLOAD=$(jq -n --arg track "$TRACK" --arg vc "$VERSION_CODE" \
    --arg status "$RELEASE_STATUS" --argjson fraction "${USER_FRACTION:-null}" \
    '{track: $track, releases: [{name: $vc, versionCodes: [$vc], status: $status}
        + (if $fraction == null then {} else {userFraction: $fraction} end)]}')
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
SENT_FOR_REVIEW="true"
COMMIT_RESPONSE=$(commit_edit "${API_BASE}/edits/${EDIT_ID}:commit")
if ! echo "$COMMIT_RESPONSE" | jq -e '.id' >/dev/null 2>&1 \
   && echo "$COMMIT_RESPONSE" | grep -qi 'changesNotSentForReview'; then
    echo -e "${YELLOW}↻ Retrying commit with changesNotSentForReview=true…${NC}"
    COMMIT_RESPONSE=$(commit_edit "${API_BASE}/edits/${EDIT_ID}:commit?changesNotSentForReview=true")
    SENT_FOR_REVIEW="false"
fi

if ! echo "$COMMIT_RESPONSE" | jq -e '.id' >/dev/null 2>&1; then
    echo -e "${RED}❌ Commit failed. Response:${NC}"
    echo "$COMMIT_RESPONSE" | jq .
    exit 1
fi
# Play serves an alpha, beta or production release only after Google's
# review approves it. A commit with changesNotSentForReview=true is not in review at
# all, on any track, internal included: then the red warning below tells the
# owner to send it. A draft starts no review until a person rolls it out.
if [ "$RELEASE_STATUS" = "draft" ]; then
    SENT_FOR_REVIEW=""
    echo -e "${GREEN}✓ Edit committed — release is a DRAFT on track '$TRACK' (NOT live).${NC}"
    echo -e "${YELLOW}  Start the rollout from the Play Console when ready.${NC}"
elif [ "$TRACK" = "internal" ]; then
    echo -e "${GREEN}✓ Edit committed — release is on track 'internal'.${NC}"
elif [ "$RELEASE_STATUS" = "inProgress" ]; then
    echo -e "${GREEN}✓ Edit committed — staged rollout of ${USER_FRACTION} on track '$TRACK'. It starts after Play review approves it.${NC}"
else
    echo -e "${GREEN}✓ Edit committed — release on track '$TRACK'. It goes live after Play review approves it.${NC}"
fi
if [ "$SENT_FOR_REVIEW" = "false" ]; then
    echo -e "${RED}⚠ The commit used changesNotSentForReview=true, so the change is NOT in review.${NC}"
    echo -e "${RED}  Click \"Send for review\" in the Play Console (Publishing overview), or no user gets this build.${NC}"
fi

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
REC_STATUS="$RELEASE_STATUS" \
REC_USER_FRACTION="$USER_FRACTION" \
REC_SENT_FOR_REVIEW="$SENT_FOR_REVIEW" \
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
  status: process.env.REC_STATUS,
  userFraction: process.env.REC_USER_FRACTION ? Number(process.env.REC_USER_FRACTION) : null,
  // false when the commit needed changesNotSentForReview=true (the change is
  // not submitted); true otherwise; null for a draft, which starts no review.
  sentForReview: process.env.REC_SENT_FOR_REVIEW
    ? process.env.REC_SENT_FOR_REVIEW === 'true'
    : null,
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
