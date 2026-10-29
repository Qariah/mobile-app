#!/bin/bash

# iOS Archive and Upload Script
# Usage: ./scripts/ios-archive.sh [--upload]
#
# Auto-detects the iOS workspace + scheme by scanning `ios/*.xcworkspace`,
# rather than hardcoding the app name. Drop-in for forks that customize the
# appName via `expo prebuild --clean` — the script names the archive +
# IPA according to whatever workspace exists, no edits needed.
#
# Companion: ios/ExportOptions.example.plist — copy to ios/ExportOptions.plist
# (gitignored — it contains your team ID) and fill in your APPLE_TEAM_ID.
# Qariah: a direct call runs scripts/qariah-ios-archive.sh (the variants); it calls this script as a child.

set -e
# Qariah: a failing `xcodebuild | xcpretty` must stop the script.
set -o pipefail
if [ "${QARIAH_IOS_ARCHIVE_CHILD:-}" != "1" ]; then
    export QARIAH_IOS_ARCHIVE_ENTRY=1
    exec bash "$(dirname "${BASH_SOURCE[0]}")/qariah-ios-archive.sh" "$@"
fi

# Force UTF-8 locale for CocoaPods. Ruby 3.3 + CocoaPods 1.16.x raise
# Encoding::CompatibilityError when LANG isn't a UTF-8 locale. Mirrors
# the same guard in package.json's "ios" script.
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# Don't fail the archive when Sentry source-map upload hits a transient
# network error (DNS, SSL_read, etc). Symbolication is best-effort; a
# flaky upload should not block a release build.
export SENTRY_ALLOW_FAILURE=true

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ── Auto-detect workspace + scheme ────────────────────────────────────────────
shopt -s nullglob
WORKSPACES=(ios/*.xcworkspace)
shopt -u nullglob
if [ ${#WORKSPACES[@]} -eq 0 ]; then
    echo -e "${RED}❌ No iOS workspace found. Run 'npx expo prebuild --platform ios' first.${NC}"
    exit 1
fi
if [ ${#WORKSPACES[@]} -gt 1 ]; then
    echo -e "${RED}❌ Multiple iOS workspaces found in ios/. Expected exactly one.${NC}"
    printf '   %s\n' "${WORKSPACES[@]}"
    exit 1
fi
WORKSPACE="${WORKSPACES[0]}"
APP_NAME="$(basename "$WORKSPACE" .xcworkspace)"
SCHEME="$APP_NAME"
CONFIGURATION="Release"
ARCHIVE_PATH="${ARCHIVE_PATH:-build/${APP_NAME}.xcarchive}"
EXPORT_PATH="build/export"
EXPORT_OPTIONS="${EXPORT_OPTIONS:-ios/ExportOptions.plist}"
IPA_PATH="${EXPORT_PATH}/${APP_NAME}.ipa"

# Parse arguments
UPLOAD=false
for arg in "$@"; do
    case $arg in
        --upload)
            UPLOAD=true
            shift
            ;;
    esac
done

echo -e "${YELLOW}🔧 iOS Archive Script${NC}"
echo "========================"
echo -e "  Workspace: ${GREEN}$WORKSPACE${NC}"
echo -e "  Scheme:    ${GREEN}$SCHEME${NC}"
echo -e "  IPA:       ${GREEN}$IPA_PATH${NC}"

# Get version from package.json
# Qariah: package.json lags; the derived version is what ships.
VERSION=$(node -p "require('./scripts/generate-version').semanticVersion")
echo -e "  Version:   ${GREEN}$VERSION${NC}"

# Pre-flight: ExportOptions.plist must exist (created by hand during sprint
# bootstrap; see planning/ for the team-id-aware template).
if [ ! -f "$EXPORT_OPTIONS" ]; then
    echo -e "${RED}❌ Missing $EXPORT_OPTIONS. Create it with method=app-store and your APPLE_TEAM_ID.${NC}"
    exit 1
fi

# Qariah (TECH_DEBT #32): the ASC API key lets xcodebuild regenerate profiles; APPLE_TEAM_ID overrides the baked team id.
XCODEBUILD_EXTRA_ARGS=()
ASC_API_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${APP_STORE_CONNECT_API_KEY_ID}.p8"
if [ -n "$APP_STORE_CONNECT_API_KEY_ID" ] && [ -n "$APP_STORE_CONNECT_ISSUER_ID" ] && [ -f "$ASC_API_KEY_PATH" ]; then
    XCODEBUILD_EXTRA_ARGS+=(
        -authenticationKeyID "$APP_STORE_CONNECT_API_KEY_ID"
        -authenticationKeyIssuerID "$APP_STORE_CONNECT_ISSUER_ID"
        -authenticationKeyPath "$ASC_API_KEY_PATH"
    )
    echo -e "  ASC auth:  ${GREEN}API key $APP_STORE_CONNECT_API_KEY_ID${NC} (CLI can auto-regen profiles)"
else
    echo -e "  ASC auth:  ${YELLOW}none — xcodebuild will rely on Xcode account session${NC}"
fi
if [ -n "$APPLE_TEAM_ID" ]; then
    XCODEBUILD_EXTRA_ARGS+=("DEVELOPMENT_TEAM=$APPLE_TEAM_ID")
    echo -e "${YELLOW}🔑 Forcing DEVELOPMENT_TEAM=$APPLE_TEAM_ID for archive + export${NC}"
fi

# Pre-flight: assert version sync between app.config.ts source-of-truth +
# iOS Info.plist + android/app/build.gradle. `expo prebuild` regenerates the
# native dirs from the config, but if you bump app.config.ts and forget to
# re-prebuild before archiving, the archive will ship with stale version
# metadata — Apple rejects builds whose CFBundleShortVersionString is below
# a previously-shipped value. Catching this at archive time costs an extra
# build cycle.
#
# Default: check-only. On drift, exit non-zero and ask the developer to
# re-run with VERIFY_FIX=1 (consciously opt-in to native-file mutation).
# `VERIFY_FIX=1` triggers `--fix` on this single archive run; standing rule
# is still archive BEFORE committing the resulting sync (committing first
# bumps the build count and leaves the native files 1 behind again).
#
# Why opt-in: previous default of unconditional `--fix` mutated native
# files on every archive run, which (a) makes the working tree non-pristine
# whenever the script runs, and (b) means there's no signal when drift
# actually exists vs. when everything was already in sync.
# --platform=ios scopes the check to the iOS Info.plist only — an Android-only
# build number drift shouldn't block an iOS archive (release cadences differ).
if [ "${VERIFY_FIX:-}" = "1" ] || [ "${VERIFY_FIX:-}" = "true" ]; then
    echo -e "\n${YELLOW}🔍 Verifying version sync (VERIFY_FIX=1 → auto-fix on drift)...${NC}"
    node "$(dirname "$0")/verify-version-sync.js" --platform=ios --fix || {
        echo -e "${RED}❌ Version sync patch failed — manual fix needed (see output above).${NC}"
        exit 1
    }
else
    echo -e "\n${YELLOW}🔍 Verifying version sync (check-only, iOS)...${NC}"
    node "$(dirname "$0")/verify-version-sync.js" --platform=ios || {
        echo -e "${RED}❌ Version drift detected. Review output above, then either:${NC}"
        echo -e "${RED}   - re-run with VERIFY_FIX=1 ${0} to auto-patch and archive in one shot, OR${NC}"
        echo -e "${RED}   - fix manually and re-run ${0}.${NC}"
        exit 1
    }
fi

# Clean build folder
# Qariah: export only. The main checkout's build/ holds the upload records.
echo -e "\n${YELLOW}📁 Cleaning build folder...${NC}"
rm -rf build/export
mkdir -p build/

# Run pod install
echo -e "\n${YELLOW}📦 Running pod install...${NC}"
# Qariah (TECH_DEBT #178): under `set -e` a failed `&&` list does not exit, so check it.
if ! (cd ios && pod install); then
    echo -e "${RED}❌ pod install failed (output above). Fix CocoaPods first; not archiving.${NC}"
    echo -e "${RED}   A pod 'differs from Pods/Local Podspecs' error: check node_modules against package-lock.json first (npm ci).${NC}"
    exit 1
fi
if [ ! -d "$WORKSPACE" ]; then
    echo -e "${RED}❌ $WORKSPACE is missing after pod install; not archiving.${NC}"
    exit 1
fi

# Archive
echo -e "\n${YELLOW}📦 Archiving...${NC}"
# Qariah (TECH_DEBT #27): use xcpretty only when installed; a `|| xcodebuild` fallback archived twice.
ARCHIVE_CMD=(xcodebuild -workspace "$WORKSPACE"
    -scheme "$SCHEME"
    -configuration "$CONFIGURATION"
    -archivePath "$ARCHIVE_PATH"
    -destination "generic/platform=iOS"
    -allowProvisioningUpdates
    "${XCODEBUILD_EXTRA_ARGS[@]}"
    archive)
if command -v xcpretty >/dev/null 2>&1; then
    "${ARCHIVE_CMD[@]}" | xcpretty
else
    "${ARCHIVE_CMD[@]}"
fi

if [ ! -d "$ARCHIVE_PATH" ]; then
    echo -e "${RED}❌ Archive failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Archive created at $ARCHIVE_PATH${NC}"

# Qariah (Sprint 51): stop before the export and the upload when the widget has no fonts.
node "$(dirname "${BASH_SOURCE[0]}")/check-widget-fonts.mjs" --root . "$ARCHIVE_PATH" || exit 1

# Export
#
# -allowProvisioningUpdates lets Xcode refresh the App Store distribution
# profiles itself. Without it the export fails outright whenever a capability
# or an extension target has been added since the profiles were last issued,
# even though nothing is actually missing from the developer account:
#
#   error: exportArchive Provisioning profile "iOS Team Store Provisioning
#          Profile: com.bayaan.app" doesn't include the Siri capability.
#   error: exportArchive No profiles for 'com.bayaan.app.widget' were found
#
# Both of those came from App Shortcuts and the widgets extension landing on
# develop; SIRIKIT was already enabled on com.bayaan.app and the widget bundle
# id was already registered. Only the cached profiles were stale. The flag
# keeps the script working as further targets are added.
echo -e "\n${YELLOW}📤 Exporting IPA...${NC}"
EXPORT_CMD=(xcodebuild -exportArchive
    -archivePath "$ARCHIVE_PATH"
    -exportPath "$EXPORT_PATH"
    -exportOptionsPlist "$EXPORT_OPTIONS"
    -allowProvisioningUpdates
    "${XCODEBUILD_EXTRA_ARGS[@]}")
if command -v xcpretty >/dev/null 2>&1; then
    "${EXPORT_CMD[@]}" | xcpretty
else
    "${EXPORT_CMD[@]}"
fi

if [ ! -f "$IPA_PATH" ]; then
    echo -e "${RED}❌ Export failed (expected $IPA_PATH)${NC}"
    exit 1
fi

echo -e "${GREEN}✅ IPA exported to $IPA_PATH${NC}"

# Upload to App Store Connect (optional)
if [ "$UPLOAD" = true ]; then
    echo -e "\n${YELLOW}🚀 Uploading to App Store Connect...${NC}"
    if [ -n "$APP_STORE_CONNECT_API_KEY_ID" ] && [ -n "$APP_STORE_CONNECT_ISSUER_ID" ]; then
        xcrun altool --upload-app \
            --type ios \
            --file "$IPA_PATH" \
            --apiKey "$APP_STORE_CONNECT_API_KEY_ID" \
            --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID"
    else
        echo -e "${YELLOW}⚠️  APP_STORE_CONNECT_API_KEY_ID / _ISSUER_ID not set in env.${NC}"
        echo -e "${YELLOW}   Manual upload options:${NC}"
        echo -e "${YELLOW}     • Transporter.app — drag $IPA_PATH onto its window${NC}"
        echo -e "${YELLOW}     • xcrun altool --upload-app --type ios --file $IPA_PATH \\${NC}"
        echo -e "${YELLOW}       --apiKey \$ID --apiIssuer \$ISSUER  (Apple ID API key)${NC}"
    fi
fi

echo -e "\n${GREEN}🎉 Done!${NC}"
echo -e "  Archive: $ARCHIVE_PATH"
echo -e "  IPA:     $IPA_PATH"
