#!/bin/bash

# iOS Archive and Upload Script
# Usage: ./scripts/ios-archive.sh [--upload] [--beta|--prod|--public-beta] [-y]
#
# Variants:
#   --beta         Internal beta: bundle id .beta suffix, BETA-banded icon,
#                  "Qariah Beta" display name, prelive QF env.
#   --public-beta  Public beta: PROD bundle id (so TestFlight Public Link
#                  serves it as prod), PUBLIC-BETA-banded icon (Qariah accent
#                  purple), "Qariah PB" display name, PRELIVE QF env.
#                  Lets external testers visually distinguish their app from
#                  the App Store prod build without forcing a separate bundle.
#   --prod         Prod release: bundle id stays prod, clean icon, "Qariah"
#                  display name, prod QF env.
#
# Auto-detects the iOS workspace + scheme by scanning `ios/*.xcworkspace`,
# rather than hardcoding the app name. Drop-in for forks that customize the
# appName via `expo prebuild --clean` — the script names the archive +
# IPA according to whatever workspace exists, no edits needed.
#
# Companion: ios/ExportOptions.example.plist — copy to ios/ExportOptions.plist
# (gitignored — it contains your team ID) and fill in your APPLE_TEAM_ID.
#
# Qariah extensions over upstream (Sprint 7 post-close):
#   - sources `.env.local` and passes App Store Connect API key auth flags to
#     xcodebuild so the CLI can regenerate provisioning profiles after cert
#     rotation without an active Xcode account session (TECH_DEBT #32).
#   - writes archive to `~/Library/Developer/Xcode/Archives/<date>/` so the
#     Xcode Organizer GUI sees it immediately (TECH_DEBT #33).
#   - asserts version sync (Info.plist + build.gradle vs app.config.ts) before
#     archiving (TECH_DEBT #25).
#   - records uploaded build metadata in `build/last-{beta,public-beta,prod}-
#     build.json` + appends to `build/testflight-uploads.ndjson` (audit trail).
#
# Branch-driven variant selection (added 2026-05-20):
#   - On `qariah-main` (the protected production branch) → archives as PROD
#     (bundle id `com.qariah.app`, QF prod env).
#   - On any other branch / detached HEAD → archives as BETA (bundle id
#     `com.qariah.app.beta`, QF prelive env). Testers can install side-by-
#     side with the App Store production app.
#   - `--beta`, `--public-beta`, or `--prod` overrides auto-detection.
#   - `--public-beta` (added 2026-05-28): same PROD bundle id as a prod
#     archive (so TestFlight Public Link serves it) but PUBLIC-BETA-banded
#     icon + "Qariah PB" display name + QF prelive env. Lets external
#     public-beta testers see at a glance they're not on the App Store prod.
#   - `--upload` defaults to a confirmation prompt; pass `-y` to skip.
#
# Beta variants: pbxproj is patched in-place before xcodebuild (bundle ids,
# app icon, display name — bundle id only for --beta), then restored via a
# trap on EXIT — the working tree is left clean regardless of success or
# failure. See CONTRIBUTING-QARIAH.md → "Beta TestFlight build" for the
# one-time App Store Connect + provisioning portal setup.

set -e
# Make `set -e` honor pipeline failures. Without `pipefail`, a failing
# `xcodebuild | xcpretty` exits 0 (because xcpretty exits 0) and `set -e`
# would not catch the archive failure — the `[ ! -d "$ARCHIVE_PATH" ]`
# guard below catches the missing artifact, but any other intermediate
# pipeline failure would slip through silently. Codified after the
# 2026-05-20 PR-#36 code review.
set -o pipefail

# Resolve absolute path to this script's directory at the top — both
# the `node -p require('...')` calls below and the metadata-recording
# block need a CWD-independent anchor. Using `dirname "$0"` or relying
# on `git rev-parse --git-common-dir` returning a CWD-relative `.git`
# both fail in non-standard invocations (e.g., called from a subdir
# of the worktree, or via an absolute path from elsewhere).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Anchor the whole script to the tree it LIVES in, not the tree it was launched
# from (issue #397, 2026-09-09). Everything below this line -- the workspace
# glob, ExportOptions, .env.local, the pbxproj/icon/Info.plist variant patch and
# its EXIT trap, build/export, and generate-version's git commit count -- was
# CWD-relative, while `bash /abs/path/to/other-worktree/scripts/ios-archive.sh`
# is a perfectly ordinary way to call it. That call read the OTHER tree's branch
# to choose prod-vs-beta and then patched THIS tree's files. `git -C "$REPO_ROOT"`
# below closes the same gap for the branch read, and mirrors what
# android-archive.sh:117 and android-upload-play.sh:311 have always done.
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

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

# Sprint 7 post-close (TECH_DEBT #33): write archive into Xcode's standard
# archives directory so the Organizer GUI sees it on the first try. Falls
# back to project-local `build/` if HOME isn't writable for some reason.
# Filename includes version + build for human-friendly Organizer rows.
EXPORT_PATH="build/export"
EXPORT_OPTIONS="ios/ExportOptions.plist"
IPA_PATH="${EXPORT_PATH}/${APP_NAME}.ipa"
# ARCHIVE_PATH set after VERSION/BUILD_NUMBER are read.
# EXPORT_OPTIONS overridden below when --beta is set.

# Parse arguments
UPLOAD=false
BETA=false
PUBLIC_BETA=false
PROD_OVERRIDE=false
SKIP_CONFIRM=false
for arg in "$@"; do
    case $arg in
        --upload)
            UPLOAD=true
            shift
            ;;
        --beta)
            BETA=true
            shift
            ;;
        --public-beta)
            PUBLIC_BETA=true
            shift
            ;;
        --prod)
            PROD_OVERRIDE=true
            shift
            ;;
        -y|--yes)
            SKIP_CONFIRM=true
            shift
            ;;
    esac
done

# Mutual-exclusion: any two of {--beta, --public-beta, --prod} → error.
mutex_count=0
[ "$BETA" = true ] && mutex_count=$((mutex_count + 1))
[ "$PUBLIC_BETA" = true ] && mutex_count=$((mutex_count + 1))
[ "$PROD_OVERRIDE" = true ] && mutex_count=$((mutex_count + 1))
if [ "$mutex_count" -gt 1 ]; then
    echo -e "${RED}❌ --beta, --public-beta, and --prod are mutually exclusive.${NC}"
    exit 1
fi

# Branch-driven variant selection (added 2026-05-20). The mental model:
# qariah-main is the protected production branch — archiving from there
# means we're shipping prod. Anywhere else (sprint branches, detached
# HEAD, parallel worktrees) means beta. Explicit `--beta` / `--prod`
# overrides this for unusual cases.
CURRENT_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [ "$BETA" = false ] && [ "$PUBLIC_BETA" = false ] && [ "$PROD_OVERRIDE" = false ]; then
    if [ "$CURRENT_BRANCH" = "qariah-main" ]; then
        # On qariah-main → prod.
        VARIANT_REASON="auto-detect: on qariah-main → prod"
    else
        # Anywhere else → beta.
        BETA=true
        VARIANT_REASON="auto-detect: branch '$CURRENT_BRANCH' is not qariah-main → beta"
    fi
elif [ "$BETA" = true ]; then
    VARIANT_REASON="explicit --beta override"
elif [ "$PUBLIC_BETA" = true ]; then
    VARIANT_REASON="explicit --public-beta override"
else
    VARIANT_REASON="explicit --prod override"
fi

# Beta-variant identity. Kept in lock-step with config/branding.js's
# bundleId.ios value (com.qariah.app) — appending `.beta` to it.
PROD_BUNDLE_ID="com.qariah.app"
PROD_SHARE_BUNDLE_ID="com.qariah.app.share-extension"
BETA_BUNDLE_ID="${PROD_BUNDLE_ID}.beta"
BETA_SHARE_BUNDLE_ID="${PROD_BUNDLE_ID}.beta.share-extension"

# Absolute, because the EXIT trap below restores these files and a trap can fire
# from a different working directory than the one that set it (a failing
# `cd ios && pod install` used to leave exactly that state, and the leftover
# beta-patched pbxproj is a documented recovery step in CLAUDE.md).
PBXPROJ="$REPO_ROOT/ios/Qariah.xcodeproj/project.pbxproj"
VARIANT_SUFFIX=""
if [ "$BETA" = true ]; then
    VARIANT_SUFFIX="beta-"
elif [ "$PUBLIC_BETA" = true ]; then
    VARIANT_SUFFIX="public-beta-"
fi

# Sprint 7 post-close (TECH_DEBT #32): source `.env.local` so we can pass
# App Store Connect API key auth flags to xcodebuild. With these, the CLI
# can regenerate provisioning profiles via `-allowProvisioningUpdates`
# without needing an active Xcode account session — the Sprint 7 close
# session got stuck on "No Accounts" because the CLI couldn't see Xcode's
# account, and the workaround was a manual Organizer GUI upload.
if [ -f "$REPO_ROOT/.env.local" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$REPO_ROOT/.env.local"
    set +a
fi

echo -e "${YELLOW}🔧 iOS Archive Script${NC}"
echo "========================"
echo -e "  Workspace: ${GREEN}$WORKSPACE${NC}"
echo -e "  Scheme:    ${GREEN}$SCHEME${NC}"
echo -e "  Branch:    ${GREEN}$CURRENT_BRANCH${NC}"
if [ "$BETA" = true ]; then
    EXPORT_OPTIONS="ios/ExportOptions.beta.plist"
    echo -e "  Variant:   ${YELLOW}BETA${NC} (bundle id: ${GREEN}$BETA_BUNDLE_ID${NC})"
    echo -e "             ${YELLOW}$VARIANT_REASON${NC}"
    echo -e "  Export:    ${GREEN}$EXPORT_OPTIONS${NC}"
elif [ "$PUBLIC_BETA" = true ]; then
    # Public-beta uses the PROD bundle id and PROD ExportOptions because
    # TestFlight Public Link serves off the prod app record. Only the
    # icon + display name differentiate from real prod.
    echo -e "  Variant:   ${YELLOW}PUBLIC BETA${NC} (bundle id: ${GREEN}$PROD_BUNDLE_ID${NC} — visual differentiation via icon + display name)"
    echo -e "             ${YELLOW}$VARIANT_REASON${NC}"
    echo -e "  Export:    ${GREEN}$EXPORT_OPTIONS${NC}"
else
    echo -e "  Variant:   ${RED}PROD${NC} (bundle id: ${GREEN}$PROD_BUNDLE_ID${NC})"
    echo -e "             ${YELLOW}$VARIANT_REASON${NC}"
    echo -e "  Export:    ${GREEN}$EXPORT_OPTIONS${NC}"
fi

# Loud confirmation gate before any prod upload. Beta uploads still
# confirm too, but the prod prompt is intentionally extra-noisy because
# a stray --prod from a sprint branch (or a forgotten branch switch
# before running) could ship untested code to App Store reviewers.
if [ "$UPLOAD" = true ] && [ "$SKIP_CONFIRM" = false ]; then
    if [ "$BETA" = true ]; then
        echo
        echo -e "${YELLOW}🚨 About to UPLOAD to TestFlight as BETA (${BETA_BUNDLE_ID}).${NC}"
    elif [ "$PUBLIC_BETA" = true ]; then
        echo
        echo -e "${YELLOW}🚨 About to UPLOAD to TestFlight as PUBLIC BETA (${PROD_BUNDLE_ID}).${NC}"
        echo -e "${YELLOW}   This ships to the prod App Store Connect record — assign to the${NC}"
        echo -e "${YELLOW}   Public Link external group post-processing.${NC}"
    else
        echo
        echo -e "${RED}🚨 About to UPLOAD to TestFlight as PROD (${PROD_BUNDLE_ID}).${NC}"
        echo -e "${RED}   This ships to App Store reviewers + prod TestFlight tester groups.${NC}"
        echo -e "${RED}   Confirm the beta has been validated by testers first.${NC}"
    fi
    printf "${YELLOW}Continue? [y/N] ${NC}"
    read -r REPLY </dev/tty
    case "$REPLY" in
        y|Y|yes|YES) ;;
        *) echo -e "${YELLOW}Aborted by user.${NC}"; exit 1 ;;
    esac
fi

# Read version + build from generate-version.js — the same source of truth
# verify-version-sync.js uses to patch Info.plist + build.gradle. Reading
# from package.json instead drifts: generate-version.js prefers the latest
# git tag (e.g. v3.1.5) which becomes the shipped CFBundleShortVersionString,
# while package.json (e.g. 3.1.2) gets bumped lazily and lags. Caught when
# a 2026-05-20 promote-script e2e shipped CFBundleShortVersionString=3.1.5
# but recorded version=3.1.2 in build/last-{beta,prod}-build.json.
VERSION=$(node -p "require('$SCRIPT_DIR/generate-version').semanticVersion")
BUILD_NUMBER=$(node -p "require('$SCRIPT_DIR/generate-version').buildNumber")
echo -e "  Version:   ${GREEN}$VERSION${NC}"
echo -e "  Build:     ${GREEN}$BUILD_NUMBER${NC}"

# TECH_DEBT #33: Xcode-standard archive location.
ARCHIVE_DATE="$(date +%Y-%m-%d)"
XCODE_ARCHIVES_ROOT="$HOME/Library/Developer/Xcode/Archives/$ARCHIVE_DATE"
if mkdir -p "$XCODE_ARCHIVES_ROOT" 2>/dev/null; then
    ARCHIVE_PATH="$XCODE_ARCHIVES_ROOT/${APP_NAME}-${VARIANT_SUFFIX}${VERSION}-${BUILD_NUMBER}.xcarchive"
    echo -e "  Archive:   ${GREEN}$ARCHIVE_PATH${NC} ${YELLOW}(visible in Xcode → Organizer)${NC}"
else
    ARCHIVE_PATH="build/${APP_NAME}-${VARIANT_SUFFIX%-}.xcarchive"
    echo -e "  Archive:   ${YELLOW}$ARCHIVE_PATH (Organizer fallback failed)${NC}"
fi
echo -e "  IPA:       ${GREEN}$IPA_PATH${NC}"

# TECH_DEBT #32: detect API key auth availability for xcodebuild.
ASC_API_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${APP_STORE_CONNECT_API_KEY_ID}.p8"
ASC_AUTH_ARGS=()
if [ -n "$APP_STORE_CONNECT_API_KEY_ID" ] && [ -n "$APP_STORE_CONNECT_ISSUER_ID" ] && [ -f "$ASC_API_KEY_PATH" ]; then
    ASC_AUTH_ARGS+=(
        -authenticationKeyID "$APP_STORE_CONNECT_API_KEY_ID"
        -authenticationKeyIssuerID "$APP_STORE_CONNECT_ISSUER_ID"
        -authenticationKeyPath "$ASC_API_KEY_PATH"
    )
    echo -e "  ASC auth:  ${GREEN}API key $APP_STORE_CONNECT_API_KEY_ID${NC} (CLI can auto-regen profiles)"
else
    echo -e "  ASC auth:  ${YELLOW}none — xcodebuild will rely on Xcode account session${NC}"
    echo -e "             ${YELLOW}If profiles need regenerating: open Xcode.app first.${NC}"
fi

# Pre-flight: ExportOptions.plist must exist (created by hand during sprint
# bootstrap; see planning/ for the team-id-aware template).
if [ ! -f "$EXPORT_OPTIONS" ]; then
    echo -e "${RED}❌ Missing $EXPORT_OPTIONS. Create it with method=app-store and your APPLE_TEAM_ID.${NC}"
    exit 1
fi

# QF environment switching by variant. .env.local seeds the prelive client as
# the default (so `npm run ios` and --beta INTERNAL archives talk to prelive);
# --public-beta and prod archives swap in QF_PROD_* to talk to production.
# Public beta ships to REAL users on the prod bundle id (com.qariah.app), so it
# must authenticate against prod QF — real accounts + v1-restore data — NOT the
# staging instance. Only the internal .beta variant stays on prelive. Metro reads
# EXPO_PUBLIC_* at bundle time from this process's env, so exporting before
# xcodebuild is enough — no .env.local rewrite needed.
if [ "$BETA" = true ]; then
    # Internal beta ONLY → QF prelive. Internal-tester data lives in QF's
    # staging instance, never touches prod accounts. (Public beta = prod, below.)
    echo -e "  QF env:    ${YELLOW}prelive${NC} (client ${EXPO_PUBLIC_QF_CLIENT_ID:-<unset>}) — internal-tester data lives in QF's staging instance, not production"
elif [ -n "$QF_PROD_CLIENT_ID" ] && [ -n "$QF_PROD_SECRET" ]; then
    # Public beta AND prod → QF production (real accounts + v1 restore).
    export EXPO_PUBLIC_QF_ENV=production
    export EXPO_PUBLIC_QF_CLIENT_ID="$QF_PROD_CLIENT_ID"
    export EXPO_PUBLIC_QF_CLIENT_SECRET="$QF_PROD_SECRET"
    echo -e "  QF env:    ${GREEN}production${NC} (client ${EXPO_PUBLIC_QF_CLIENT_ID})"
else
    echo -e "${RED}❌ Prod / public-beta archive requires QF_PROD_CLIENT_ID + QF_PROD_SECRET in .env.local.${NC}"
    exit 1
fi

# Pre-flight: assert version sync between app.config.ts source-of-truth +
# iOS Info.plist + android/app/build.gradle BEFORE the expensive archive.
# Sprint 7 paid this tax twice (TECH_DEBT #25); Sprint 9 added a --fix path
# (TECH_DEBT #39) that patches the working tree on drift. Sprint 21 absorbed
# upstream PR #251 review revisions: --fix is now opt-in via VERIFY_FIX=1
# (no silent native-file mutation on every run), and --platform=ios scopes
# the check to iOS so Android-only build-number drift doesn't block iOS
# archives (release cadences differ). Standing rule still applies: archive
# BEFORE committing the resulting sync.
if [ "${VERIFY_FIX:-}" = "1" ] || [ "${VERIFY_FIX:-}" = "true" ]; then
    echo -e "\n${YELLOW}🔍 Verifying version sync (VERIFY_FIX=1 → auto-fix on drift)...${NC}"
    node "$SCRIPT_DIR/verify-version-sync.js" --platform=ios --fix || {
        echo -e "${RED}❌ Version sync patch failed — manual fix needed (see output above).${NC}"
        exit 1
    }
else
    echo -e "\n${YELLOW}🔍 Verifying version sync (check-only, iOS)...${NC}"
    node "$SCRIPT_DIR/verify-version-sync.js" --platform=ios || {
        echo -e "${RED}❌ Version drift detected. Review output above, then either:${NC}"
        echo -e "${RED}   - re-run with VERIFY_FIX=1 ${0} to auto-patch and archive in one shot, OR${NC}"
        echo -e "${RED}   - fix manually and re-run ${0}.${NC}"
        exit 1
    }
fi

# Sprint 14 (TECH_DEBT #28): if APPLE_TEAM_ID is set in env (sourced from
# .env.local above), pass DEVELOPMENT_TEAM as an xcodebuild build setting so
# the archive uses the env value regardless of what's currently committed
# in ios/*.xcodeproj/project.pbxproj. The pbxproj-baked TEAM_ID drifts after
# `expo prebuild` is re-run from a different machine + .env state. Earlier
# sprints (S5/S7) chased this with sed scripts; xcodebuild's CLI override is
# the proper seam.
TEAM_OVERRIDE_ARGS=()
if [ -n "$APPLE_TEAM_ID" ]; then
    TEAM_OVERRIDE_ARGS+=("DEVELOPMENT_TEAM=$APPLE_TEAM_ID")
    echo -e "${YELLOW}🔑 Forcing DEVELOPMENT_TEAM=$APPLE_TEAM_ID for archive + export${NC}"
fi

# Variant patching: --beta swaps bundle id + icon + display name; --public-beta
# keeps the PROD bundle id (so TestFlight Public Link serves it as prod) but
# swaps icon + display name so external testers can see at a glance that
# they're on a beta build, not the App Store prod build. Both restore-on-exit.
# The actual identity-switching live point; xcodebuild reads pbxproj-baked
# PRODUCT_BUNDLE_IDENTIFIER per target, and workspace-level build-setting
# overrides apply to all targets uniformly (which would collapse share-
# extension's ID into the parent's). In-place patch + restore is the only
# clean way to handle the two-target swap.
if [ "$BETA" = true ] || [ "$PUBLIC_BETA" = true ]; then
    if [ ! -f "$PBXPROJ" ]; then
        echo -e "${RED}❌ $PBXPROJ not found; cannot apply variant patch.${NC}"
        exit 1
    fi
    # Choose icon variant + display name based on flag.
    if [ "$BETA" = true ]; then
        ICON_VARIANT_SUFFIX="beta"
        DISPLAY_NAME="Qariah Beta"
    else
        ICON_VARIANT_SUFFIX="public-beta"
        DISPLAY_NAME="Qariah PB"
    fi
    # Sprint 20: visually distinguish beta variants so testers can tell
    # them apart from prod on the home screen.
    #   1. pbxproj bundle IDs (app + share extension)   — BETA only
    #   2. App icon (light/dark/tinted) → variant-banded — both
    #   3. CFBundleDisplayName → "Qariah Beta"/"Qariah PB" — both
    ICON_DIR="$REPO_ROOT/ios/Qariah/Images.xcassets/AppIcon.appiconset"
    INFO_PLIST="$REPO_ROOT/ios/Qariah/Info.plist"
    ICON_LIGHT="$ICON_DIR/App-Icon-1024x1024@1x.png"
    ICON_DARK="$ICON_DIR/App-Icon-dark-1024x1024@1x.png"
    ICON_TINTED="$ICON_DIR/App-Icon-tinted-1024x1024@1x.png"

    # Take all backups upfront so the trap covers every artifact even if a
    # later patch step fails mid-stream.
    cp "$PBXPROJ" "$PBXPROJ.prod.bak"
    cp "$ICON_LIGHT" "$ICON_LIGHT.prod.bak"
    cp "$ICON_DARK" "$ICON_DARK.prod.bak"
    cp "$ICON_TINTED" "$ICON_TINTED.prod.bak"
    cp "$INFO_PLIST" "$INFO_PLIST.prod.bak"

    # shellcheck disable=SC2064
    trap "
        [ -f '$INFO_PLIST.prod.bak' ] && mv '$INFO_PLIST.prod.bak' '$INFO_PLIST'
        [ -f '$ICON_TINTED.prod.bak' ] && mv '$ICON_TINTED.prod.bak' '$ICON_TINTED'
        [ -f '$ICON_DARK.prod.bak' ] && mv '$ICON_DARK.prod.bak' '$ICON_DARK'
        [ -f '$ICON_LIGHT.prod.bak' ] && mv '$ICON_LIGHT.prod.bak' '$ICON_LIGHT'
        [ -f '$PBXPROJ.prod.bak' ] && mv '$PBXPROJ.prod.bak' '$PBXPROJ'
        echo -e '${YELLOW}🔁 Restored prod identity (pbxproj + Info.plist + icons).${NC}'
    " EXIT

    if [ "$BETA" = true ]; then
        if ! grep -q "PRODUCT_BUNDLE_IDENTIFIER = $PROD_BUNDLE_ID;" "$PBXPROJ"; then
            echo -e "${RED}❌ pbxproj does not contain expected '$PROD_BUNDLE_ID' bundle id; aborting beta patch.${NC}"
            echo -e "${RED}   If you renamed the prod bundle id, update PROD_BUNDLE_ID at the top of this script.${NC}"
            exit 1
        fi
        sed -i.tmp \
            -e "s|PRODUCT_BUNDLE_IDENTIFIER = ${PROD_BUNDLE_ID};|PRODUCT_BUNDLE_IDENTIFIER = ${BETA_BUNDLE_ID};|g" \
            -e "s|PRODUCT_BUNDLE_IDENTIFIER = \"${PROD_SHARE_BUNDLE_ID}\";|PRODUCT_BUNDLE_IDENTIFIER = \"${BETA_SHARE_BUNDLE_ID}\";|g" \
            "$PBXPROJ"
        rm -f "$PBXPROJ.tmp"
        echo -e "${YELLOW}🧬 Patched $PBXPROJ:${NC} ${PROD_BUNDLE_ID} → ${BETA_BUNDLE_ID} (+ share extension)"
    fi

    cp "$REPO_ROOT/assets/branding/ios-light-${ICON_VARIANT_SUFFIX}.png" "$ICON_LIGHT"
    cp "$REPO_ROOT/assets/branding/ios-dark-${ICON_VARIANT_SUFFIX}.png" "$ICON_DARK"
    cp "$REPO_ROOT/assets/branding/ios-tinted-${ICON_VARIANT_SUFFIX}.png" "$ICON_TINTED"
    echo -e "${YELLOW}🎨 Swapped AppIcon to ${ICON_VARIANT_SUFFIX}-banded variant${NC}"

    /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${DISPLAY_NAME}" "$INFO_PLIST"
    echo -e "${YELLOW}🏷️  Patched CFBundleDisplayName -> ${DISPLAY_NAME}${NC}"
fi

# Clean build folder (export IPA only — archive lives in Xcode-standard location)
echo -e "\n${YELLOW}📁 Cleaning build/ (export only — archive is in Xcode Archives/)...${NC}"
rm -rf build/export
mkdir -p build/

# Run pod install
echo -e "\n${YELLOW}📦 Running pod install...${NC}"
# In a subshell so a pod-install failure cannot leave the script -- and its EXIT
# trap -- running from ios/ instead of the repo root.
(cd "$REPO_ROOT/ios" && pod install)

# Archive
# `-allowProvisioningUpdates` lets xcodebuild refresh provisioning profiles for
# automatic signing on cold checkouts (Sprint 7 fix — Sprint 5 archive ran in a
# pre-warmed Xcode session that already had profiles cached).
# Sprint 7 post-close (TECH_DEBT #32): App Store Connect API key auth flags
# (`-authenticationKey*`) let the CLI auto-regenerate profiles when the
# previous Distribution cert has rotated, without requiring an Xcode account
# session.
echo -e "\n${YELLOW}📦 Archiving...${NC}"
ARCHIVE_CMD=(xcodebuild
    -workspace "$WORKSPACE"
    -scheme "$SCHEME"
    -configuration "$CONFIGURATION"
    -archivePath "$ARCHIVE_PATH"
    -destination "generic/platform=iOS"
    -allowProvisioningUpdates
    "${ASC_AUTH_ARGS[@]}"
    "${TEAM_OVERRIDE_ARGS[@]}"
    archive
)
# Sprint 14 (TECH_DEBT #27): only pipe through xcpretty if it's installed.
# Without this check, the SIGPIPE from a missing xcpretty triggers the
# `||` fallback and we ran the archive twice (~3 min wasted per cycle).
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

# Export
echo -e "\n${YELLOW}📤 Exporting IPA...${NC}"
EXPORT_CMD=(xcodebuild -exportArchive
    -archivePath "$ARCHIVE_PATH"
    -exportPath "$EXPORT_PATH"
    -exportOptionsPlist "$EXPORT_OPTIONS"
    -allowProvisioningUpdates
    "${ASC_AUTH_ARGS[@]}"
    "${TEAM_OVERRIDE_ARGS[@]}"
)
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

        # Record upload metadata to the main repo's build/ dir (not the
        # current worktree). Two files written: build/last-{beta,prod}-build.json
        # (one-row snapshot of the most recent upload of each variant) and
        # build/testflight-uploads.ndjson (append-only audit log). Both are
        # gitignored — local audit trail, useful for "what's on TestFlight
        # right now" and "which SHA did we ship as beta vs prod last."
        # Resolve to absolute via SCRIPT_DIR (top of file) + git's
        # --path-format=absolute, so CWD never enters the resolution. The
        # earlier `dirname "$(git rev-parse --git-common-dir)"` form returned
        # "." when run from the main repo, which silently wrote metadata to
        # the wrong directory if CWD wasn't the repo root.
        MAIN_REPO_ROOT="$(dirname "$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir)")"
        if [ -z "$MAIN_REPO_ROOT" ] || [ ! -d "$MAIN_REPO_ROOT" ]; then
            echo -e "${YELLOW}⚠️  Could not resolve main repo root; skipping metadata write.${NC}"
        else
        REC_VARIANT="prod"
        REC_BUNDLE_ID="$PROD_BUNDLE_ID"
        REC_QF_ENV="${EXPO_PUBLIC_QF_ENV:-production}"
        if [ "$BETA" = true ]; then
            REC_VARIANT="beta"
            REC_BUNDLE_ID="$BETA_BUNDLE_ID"
            REC_QF_ENV="prelive"
        elif [ "$PUBLIC_BETA" = true ]; then
            REC_VARIANT="public-beta"
            REC_BUNDLE_ID="$PROD_BUNDLE_ID"
            REC_QF_ENV="production"  # public beta authenticates against prod QF (real users)
        fi
        REC_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
        REC_SHORT_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
        REC_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
        REC_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        REC_IPA_ABS="$(cd "$(dirname "$IPA_PATH")" && pwd)/$(basename "$IPA_PATH")"

        REC_DIR="$MAIN_REPO_ROOT/build"
        mkdir -p "$REC_DIR"
        REC_VARIANT="$REC_VARIANT" \
        REC_SHA="$REC_SHA" \
        REC_SHORT_SHA="$REC_SHORT_SHA" \
        REC_BRANCH="$REC_BRANCH" \
        REC_VERSION="$VERSION" \
        REC_BUILD="$BUILD_NUMBER" \
        REC_BUNDLE_ID="$REC_BUNDLE_ID" \
        REC_QF_ENV="$REC_QF_ENV" \
        REC_ARCHIVE_PATH="$ARCHIVE_PATH" \
        REC_IPA_ABS="$REC_IPA_ABS" \
        REC_TIMESTAMP="$REC_TIMESTAMP" \
        REC_DIR="$REC_DIR" \
        node -e "$(cat <<'EOF'
const fs = require('fs');
const path = require('path');
const meta = {
  variant: process.env.REC_VARIANT,
  sha: process.env.REC_SHA,
  short_sha: process.env.REC_SHORT_SHA,
  branch: process.env.REC_BRANCH,
  version: process.env.REC_VERSION,
  build: process.env.REC_BUILD,
  bundle_id: process.env.REC_BUNDLE_ID,
  qf_env: process.env.REC_QF_ENV,
  archive_path: process.env.REC_ARCHIVE_PATH,
  ipa_path: process.env.REC_IPA_ABS,
  uploaded_at: process.env.REC_TIMESTAMP,
};
const dir = process.env.REC_DIR;
const lastFile = path.join(dir, 'last-' + meta.variant + '-build.json');
fs.writeFileSync(lastFile, JSON.stringify(meta, null, 2) + '\n');
fs.appendFileSync(path.join(dir, 'testflight-uploads.ndjson'), JSON.stringify(meta) + '\n');
console.log('  Recorded: ' + lastFile);
EOF
)"
        fi  # MAIN_REPO_ROOT resolution guard
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
