#!/bin/bash

# Android Release Archive Script
# Usage: ./scripts/android-archive.sh [--bundle] [--clean]
#
# Builds a signed Android Release APK (and optionally an AAB for the Play
# Store). Mirrors scripts/ios-archive.sh's self-sufficiency pattern so that
# a release build "just works" from a clean checkout without the caller
# having to remember to source .env.local or export SENTRY_ALLOW_FAILURE.
#
# Why this wrapper exists — `cd android && ./gradlew assembleRelease` fails
# twice on a bare invocation:
#   1. The Sentry source-map upload task (createBundleReleaseJsAndAssets_
#      SentryUpload_*) errors on any transient network failure unless
#      SENTRY_ALLOW_FAILURE=true is exported.
#   2. :app:packageRelease aborts with "SigningConfig 'release' is missing
#      required property 'storePassword'" — the keystore passwords
#      (QARIAH_UPLOAD_STORE_PASSWORD / _KEY_PASSWORD / _KEY_ALIAS) live in
#      .env.local (gitignored) and android/app/build.gradle's
#      signingConfigs.release reads them via System.getenv(...).
#      QARIAH_UPLOAD_STORE_FILE itself is a project property in
#      ~/.gradle/gradle.properties.
#
# Branch-driven QF environment (mirrors scripts/ios-archive.sh):
#   - On `qariah-main` → QF production (EXPO_PUBLIC_QF_* sourced from
#     .env.local's QF_PROD_*). This is the build that represents the
#     shipping app.
#   - On any other branch / detached HEAD → QF prelive (the .env.local
#     default). Testers' data lives in QF's staging instance.
#   - `--prod` / `--prelive` override the auto-detection explicitly.
# NOTE: Android's applicationId is always `com.qariah.app` regardless of
# branch — there is no `.beta` bundle-id variant on Android (unlike iOS).
# Branch only switches the QF backend the JS bundle is baked against.
#
# Flags:
#   --bundle    also build the Play Store AAB (./gradlew bundleRelease)
#   --clean     run ./gradlew clean before the release build
#   --prod      force QF production env
#   --prelive   force QF prelive env
#
# Output:
#   APK → android/app/build/outputs/apk/release/app-release.apk
#   AAB → android/app/build/outputs/bundle/release/app-release.aab  (--bundle)

set -e
set -o pipefail

# CWD-independent anchor — resolve the repo root from this script's location
# so the script works whether invoked from the repo root, a subdir, or via
# an absolute path. Mirrors ios-archive.sh's SCRIPT_DIR pattern.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Don't fail the build when Sentry source-map upload hits a transient
# network error (DNS, SSL_read, etc). Symbolication is best-effort; a
# flaky upload should not block a release build. Same guard as ios-archive.sh.
export SENTRY_ALLOW_FAILURE=true

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
BUNDLE=false
CLEAN=false
PROD_OVERRIDE=false
PRELIVE_OVERRIDE=false
UPLOAD_TRACK=""
for arg in "$@"; do
    case $arg in
        --bundle)
            BUNDLE=true
            ;;
        --clean)
            CLEAN=true
            ;;
        --prod)
            PROD_OVERRIDE=true
            ;;
        --prelive)
            PRELIVE_OVERRIDE=true
            ;;
        --upload=*)
            # Auto-invoke scripts/android-upload-play.sh after a successful
            # build. Implies --bundle (Play Console only accepts AABs).
            UPLOAD_TRACK="${arg#*=}"
            BUNDLE=true
            ;;
        *)
            echo -e "${RED}❌ Unknown argument: $arg${NC}"
            echo "Usage: ./scripts/android-archive.sh [--bundle] [--clean] [--prod|--prelive] [--upload=<internal|beta|production>]"
            exit 1
            ;;
    esac
done

if [ -n "$UPLOAD_TRACK" ]; then
    case "$UPLOAD_TRACK" in
        internal|alpha|beta|production) ;;
        *)
            echo -e "${RED}❌ --upload track must be one of: internal | alpha | beta | production (got: $UPLOAD_TRACK)${NC}"
            exit 1
            ;;
    esac
fi

if [ "$PROD_OVERRIDE" = true ] && [ "$PRELIVE_OVERRIDE" = true ]; then
    echo -e "${RED}❌ --prod and --prelive are mutually exclusive.${NC}"
    exit 1
fi

# Branch-driven QF environment selection. qariah-main is the protected
# production branch — building from there bakes the JS bundle against QF
# production. Anywhere else → prelive. Explicit flags override.
CURRENT_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
QF_PROD=false
if [ "$PROD_OVERRIDE" = true ]; then
    QF_PROD=true
    QF_REASON="explicit --prod override"
elif [ "$PRELIVE_OVERRIDE" = true ]; then
    QF_REASON="explicit --prelive override"
elif [ "$CURRENT_BRANCH" = "qariah-main" ]; then
    QF_PROD=true
    QF_REASON="auto-detect: on qariah-main → QF production"
else
    QF_REASON="auto-detect: branch '$CURRENT_BRANCH' is not qariah-main → QF prelive"
fi

echo -e "${YELLOW}🤖 Android Release Archive Script${NC}"
echo "===================================="
echo -e "  Branch:    ${GREEN}$CURRENT_BRANCH${NC}"

# Pin Java 21 — Gradle + AGP in this project require Java 21 (NOT 25).
# Mirrors package.json's "android" script. java_home -v 21 fails loudly
# if Java 21 is not installed, which is the correct behavior.
if JAVA_HOME_21="$(/usr/libexec/java_home -v 21 2>/dev/null)"; then
    export JAVA_HOME="$JAVA_HOME_21"
    export PATH="$JAVA_HOME/bin:$PATH"
    echo -e "  Java:      ${GREEN}$JAVA_HOME${NC}"
else
    echo -e "${RED}❌ Java 21 not found. Install it (e.g. 'brew install --cask temurin@21').${NC}"
    exit 1
fi

# Source .env.local so signingConfigs.release can read the keystore
# passwords via System.getenv(...). The `set -a` block exports every
# variable defined in the file for the duration of this process.
ENV_LOCAL="$REPO_ROOT/.env.local"
if [ -f "$ENV_LOCAL" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_LOCAL"
    set +a
    echo -e "  Env:       ${GREEN}sourced .env.local${NC}"
else
    echo -e "${RED}❌ Missing $ENV_LOCAL — required for release keystore passwords.${NC}"
    echo -e "${RED}   Copy it from a sibling worktree or restore from your secrets store.${NC}"
    exit 1
fi

# Pre-flight: the release keystore must be reachable. QARIAH_UPLOAD_STORE_FILE
# is a project property in ~/.gradle/gradle.properties; if it's unset or the
# file is missing, build.gradle silently falls back to debug signing — which
# produces an APK that can't be uploaded to the Play Store. Fail loud instead.
GRADLE_PROPS="$HOME/.gradle/gradle.properties"
STORE_FILE="$(grep -E '^QARIAH_UPLOAD_STORE_FILE=' "$GRADLE_PROPS" 2>/dev/null | head -1 | cut -d= -f2-)"
if [ -z "$STORE_FILE" ]; then
    echo -e "${RED}❌ QARIAH_UPLOAD_STORE_FILE not set in $GRADLE_PROPS.${NC}"
    echo -e "${RED}   Release build would fall back to debug signing.${NC}"
    exit 1
fi
if [ ! -f "$STORE_FILE" ]; then
    echo -e "${RED}❌ Release keystore not found at: $STORE_FILE${NC}"
    exit 1
fi
echo -e "  Keystore:  ${GREEN}$STORE_FILE${NC}"

if [ -z "$QARIAH_UPLOAD_STORE_PASSWORD" ] || [ -z "$QARIAH_UPLOAD_KEY_PASSWORD" ]; then
    echo -e "${RED}❌ QARIAH_UPLOAD_STORE_PASSWORD / _KEY_PASSWORD not found in .env.local.${NC}"
    exit 1
fi

# QF environment switching. .env.local seeds the prelive client as the
# default; a prod build swaps in QF_PROD_* before the Gradle build so the
# release JS bundle (createBundleReleaseJsAndAssets) is baked against QF
# production. Metro reads EXPO_PUBLIC_* from this process's env at bundle
# time, so exporting before ./gradlew is enough — no .env.local rewrite.
if [ "$QF_PROD" = true ]; then
    if [ -n "$QF_PROD_CLIENT_ID" ] && [ -n "$QF_PROD_SECRET" ]; then
        export EXPO_PUBLIC_QF_ENV=production
        export EXPO_PUBLIC_QF_CLIENT_ID="$QF_PROD_CLIENT_ID"
        export EXPO_PUBLIC_QF_CLIENT_SECRET="$QF_PROD_SECRET"
        echo -e "  QF env:    ${GREEN}production${NC} (client ${EXPO_PUBLIC_QF_CLIENT_ID})"
        echo -e "             ${YELLOW}$QF_REASON${NC}"
    else
        echo -e "${RED}❌ Prod build requires QF_PROD_CLIENT_ID + QF_PROD_SECRET in .env.local.${NC}"
        exit 1
    fi
else
    echo -e "  QF env:    ${YELLOW}prelive${NC} (client ${EXPO_PUBLIC_QF_CLIENT_ID:-<unset>}) — staging data, not production"
    echo -e "             ${YELLOW}$QF_REASON${NC}"
fi

# Assert version sync (app.config.ts source-of-truth vs Info.plist +
# android/app/build.gradle) BEFORE the expensive build. --fix auto-patches
# the working tree on drift. Same step ios-archive.sh runs.
echo -e "\n${YELLOW}🔍 Verifying version sync (auto-fix on drift)...${NC}"
node "$SCRIPT_DIR/verify-version-sync.js" --fix || {
    echo -e "${RED}❌ Version sync patch failed — manual fix needed (see output above).${NC}"
    exit 1
}

# Ensure android/local.properties points at the Android SDK. Gradle needs
# this before any build; the file is gitignored, so fresh worktrees don't
# carry it. The bootstrap script is a no-op if the file already exists.
echo -e "\n${YELLOW}🔧 Ensuring android/local.properties...${NC}"
node "$SCRIPT_DIR/bootstrap-android-local-properties.js"
if [ ! -f "$REPO_ROOT/android/local.properties" ]; then
    echo -e "${RED}❌ android/local.properties still missing — set ANDROID_HOME and retry.${NC}"
    exit 1
fi

cd "$REPO_ROOT/android"

if [ "$CLEAN" = true ]; then
    echo -e "\n${YELLOW}🧹 Cleaning...${NC}"
    ./gradlew clean
fi

# Force the JS bundle to re-bake. Gradle up-to-date-checks the
# createBundleReleaseJsAndAssets task on JS *source files* only — it does
# NOT track EXPO_PUBLIC_* env vars. Without this, a QF-prod build can
# silently ship a stale prelive-baked bundle (or vice versa) left over
# from an earlier build, since the QF env switch above changes only env
# vars and not any file Gradle watches. Deleting the bundle output forces
# a fresh Metro bake against the QF env resolved above. Confirmed
# 2026-05-22 — a --prod build shipped a prelive-baked AAB without this.
echo -e "\n${YELLOW}♻️  Forcing JS bundle rebuild (QF env is not a Gradle input)...${NC}"
rm -rf app/build/generated/assets/react/release
rm -rf app/build/generated/sourcemaps/react/release

# Sprint 30 (B4) — trim the sideload APK to phone-only ABIs. The universal
# APK shipped all 4 ABIs (~128 MB of native libs); x86/x86_64 are emulator-only
# (~72 MB of pure dead weight on a sideload artifact). Real devices are
# arm64-v8a / armeabi-v7a. The Play AAB (bundleRelease below) is left untouched
# so Google still splits per-ABI for the store. Override with SIDELOAD_ARCHS.
SIDELOAD_ARCHS="${SIDELOAD_ARCHS:-armeabi-v7a,arm64-v8a}"
echo -e "\n${YELLOW}📦 Building Release APK (assembleRelease, ABIs=${SIDELOAD_ARCHS})...${NC}"
./gradlew assembleRelease -PreactNativeArchitectures="${SIDELOAD_ARCHS}"

APK_PATH="$REPO_ROOT/android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK_PATH" ]; then
    echo -e "${RED}❌ Build succeeded but APK not found at $APK_PATH${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Signed APK: $APK_PATH${NC}"

if [ "$BUNDLE" = true ]; then
    echo -e "\n${YELLOW}📦 Building Release AAB (bundleRelease)...${NC}"
    ./gradlew bundleRelease
    AAB_PATH="$REPO_ROOT/android/app/build/outputs/bundle/release/app-release.aab"
    if [ ! -f "$AAB_PATH" ]; then
        echo -e "${RED}❌ Bundle succeeded but AAB not found at $AAB_PATH${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Signed AAB: $AAB_PATH${NC}"
fi

# Sprint 34 (S34.4, TECH_DEBT #141) — durable archive of every release APK.
# The 2026-06-11 pre-B3 A/B was only possible because old APKs happened to
# survive in volatile /private/tmp; the 1305 diagnostic APK did NOT (it was
# purged), blocking the #139 tester repro. Copy each release APK to a stable,
# versioned location so a build is always recoverable for later A/B / tester /
# diagnostic use. Named versionName-versionCode-sha so a rebuild of the same
# commit overwrites rather than accumulates, and distinct commits at the same
# versionCode stay separable.
#
# The version pair is read from the BUILT APK, not from build.gradle. The
# comment here used to claim build.gradle was "what gradle actually baked";
# it isn't. build.gradle carries a committed literal that lags the number
# generate-version.js derives (`git rev-list --count HEAD` + VERSION_CODE_
# OFFSET), and a `BUILD_NUMBER=` override diverges from both. That produced
# `qariah-3.2.0-1705-5b7aead5.apk` containing versionCode 1716 — a filename
# matching neither the natural number (1717) nor the baked one. A misnamed
# archive is an upload hazard: these files are exactly what you reach for
# months later to sideload or promote, when nothing else remembers.
# aapt2 reads the binary manifest, so it cannot disagree with the artifact.
# Falls back to build.gradle only if aapt2 is unavailable.
# Non-fatal: a failed copy must never fail the build. Override dir with
# QARIAH_RELEASES_DIR.
RELEASES_DIR="${QARIAH_RELEASES_DIR:-$HOME/qariah-releases}"
ARCHIVE_AAPT2=$(ls "$HOME"/Library/Android/sdk/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1)
ARCHIVE_VN=""
ARCHIVE_VC=""
if [ -n "$ARCHIVE_AAPT2" ] && [ -x "$ARCHIVE_AAPT2" ]; then
    # NOT `aapt2 dump badging | head -1`. This script runs under `set -e -o
    # pipefail`, so head closing the pipe after one line kills aapt2 with
    # SIGPIPE, the pipeline reports 141, and the whole script dies AFTER the
    # APK and AAB are already built — a silent loss of the archive step with a
    # successful-looking build above it. Same trap as TECH_DEBT #27 (xcpretty).
    # Capture whole (badging is a few dozen lines) and match the single
    # `package:` line, so no early pipe close exists to trip over.
    ARCHIVE_BADGING=$("$ARCHIVE_AAPT2" dump badging "$APK_PATH" 2>/dev/null || true)
    ARCHIVE_VN=$(printf '%s\n' "$ARCHIVE_BADGING" | sed -nE "s/^package:.*versionName='([^']+)'.*/\1/p")
    ARCHIVE_VC=$(printf '%s\n' "$ARCHIVE_BADGING" | sed -nE "s/^package:.*versionCode='([0-9]+)'.*/\1/p")
fi
if [ -z "$ARCHIVE_VC" ]; then
    echo -e "${YELLOW}⚠ aapt2 unavailable — naming archive from build.gradle, which may lag the baked versionCode.${NC}"
    ARCHIVE_VN=$(grep -E '^[[:space:]]*versionName ' "$REPO_ROOT/android/app/build.gradle" | head -1 | sed -E 's/.*versionName "([^"]+)".*/\1/')
    ARCHIVE_VC=$(grep -E '^[[:space:]]*versionCode ' "$REPO_ROOT/android/app/build.gradle" | head -1 | sed -E 's/.*versionCode ([0-9]+).*/\1/')
fi
ARCHIVE_SHA=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)
if mkdir -p "$RELEASES_DIR" 2>/dev/null; then
    ARCHIVED_APK="$RELEASES_DIR/qariah-${ARCHIVE_VN:-unknown}-${ARCHIVE_VC:-0}-${ARCHIVE_SHA}.apk"
    if cp "$APK_PATH" "$ARCHIVED_APK" 2>/dev/null; then
        echo -e "${GREEN}🗄  Durable archive: $ARCHIVED_APK${NC}"
    else
        echo -e "${YELLOW}⚠ Could not archive APK to $RELEASES_DIR (non-fatal).${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Could not create $RELEASES_DIR (non-fatal).${NC}"
fi

echo -e "\n${GREEN}🎉 Build done!${NC}"
echo -e "  APK: $APK_PATH"
if [ "$BUNDLE" = true ]; then
    echo -e "  AAB: $AAB_PATH"
fi

# Auto-upload to Play Console if --upload=<track> was passed. Mirrors
# scripts/ios-archive.sh's --upload pattern; delegated to a dedicated
# script so the upload logic is testable + reusable in cron contexts.
if [ -n "$UPLOAD_TRACK" ]; then
    echo -e "\n${YELLOW}🚀 Auto-uploading to Play Console (track: $UPLOAD_TRACK)…${NC}"
    "$SCRIPT_DIR/android-upload-play.sh" --track="$UPLOAD_TRACK" "$AAB_PATH"
fi
