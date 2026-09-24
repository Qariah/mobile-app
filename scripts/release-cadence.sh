#!/bin/bash
#
# Qariah v2 release-cadence orchestrator (Sprint 26 CI-3).
#
# Implements a 7-step beta-to-prod release flow:
#
#   STEP 1 — Boot-gate (tsc + branding lint + expo export).
#   STEP 2 — (skipped per user direction: no install-via-adb step).
#   STEP 3 — Beta upload (iOS TestFlight + Android Play internal track).
#   STEP 4 — Soak prompt (operator waits for beta-tester feedback).
#   STEP 5 — Promote beta → prod for both platforms (qariah-main fast-forward).
#   STEP 6 — Start 7-day soak timer (records to build/release-soak.json).
#   STEP 7 — (cron-driven, in .github/workflows/promote-beta-to-prod.yml).
#
# Idempotent: state lives in build/release-soak.json. Re-running the
# script reads the current state and picks up at the next outstanding
# step. To force a fresh release cycle, delete the state file.
#
# State machine values for `phase` in build/release-soak.json:
#   "boot-gated"      — step 1 passed
#   "beta-uploaded"   — step 3 passed
#   "soak-confirmed"  — step 4 confirmed by operator
#   "promoted"        — step 5 done; step 6 timestamp recorded
#   "released"        — step 7 cron promoted to public
#
# Usage:
#   ./scripts/release-cadence.sh            # advance to next phase
#   ./scripts/release-cadence.sh --status   # print state, exit
#   ./scripts/release-cadence.sh --reset    # delete state file

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_FILE="$REPO_ROOT/build/release-soak.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── Flags ────────────────────────────────────────────────────────────────────

MODE="advance"
for arg in "$@"; do
    case $arg in
        --status) MODE="status" ;;
        --reset)  MODE="reset" ;;
        --help|-h)
            sed -n '3,28p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo -e "${RED}❌ Unknown flag: $arg${NC}"
            exit 1
            ;;
    esac
done

mkdir -p "$REPO_ROOT/build"

# ── State helpers ────────────────────────────────────────────────────────────

read_phase() {
    if [ -f "$STATE_FILE" ]; then
        node -e "console.log(JSON.parse(require('fs').readFileSync('$STATE_FILE','utf8')).phase || 'unknown')" 2>/dev/null || echo "unknown"
    else
        echo "fresh"
    fi
}

write_state() {
    local PHASE="$1"
    local NOTE="${2:-}"
    local NOW
    NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    local SHA
    SHA="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
    local BRANCH
    BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

    PHASE="$PHASE" NOW="$NOW" SHA="$SHA" BRANCH="$BRANCH" NOTE="$NOTE" STATE_FILE="$STATE_FILE" \
    node -e "$(cat <<'EOF'
const fs = require('fs');
const file = process.env.STATE_FILE;
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const next = {
  ...prev,
  phase: process.env.PHASE,
  branch: process.env.BRANCH,
  sha: process.env.SHA,
  updatedAt: process.env.NOW,
  note: process.env.NOTE || prev.note || '',
};
if (process.env.PHASE === 'promoted' && !prev.promotedAt) {
  next.promotedAt = process.env.NOW;
}
fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
EOF
)"
}

if [ "$MODE" = "status" ]; then
    if [ -f "$STATE_FILE" ]; then
        cat "$STATE_FILE"
    else
        echo "{ \"phase\": \"fresh\" }"
    fi
    exit 0
fi

if [ "$MODE" = "reset" ]; then
    rm -f "$STATE_FILE"
    echo -e "${GREEN}✓ State reset.${NC}"
    exit 0
fi

CURRENT_PHASE="$(read_phase)"
echo -e "${BLUE}🎯 Release cadence — current phase: ${CURRENT_PHASE}${NC}\n"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — Boot-gate
# ─────────────────────────────────────────────────────────────────────────────

if [ "$CURRENT_PHASE" = "fresh" ] || [ "$CURRENT_PHASE" = "unknown" ]; then
    echo -e "${YELLOW}── STEP 1: Boot-gate (tsc + branding + expo export) ──${NC}"
    cd "$REPO_ROOT"

    echo -e "${BLUE}→ tsc --noEmit${NC}"
    NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit

    echo -e "${BLUE}→ branding-conformance grep${NC}"
    ALLOWED='config/branding\.(ts|js|d\.ts)|DIVERGENCE_LEDGER\.md|TECH_DEBT\.md|planning/|docs/|README|CHANGELOG|LICENSE|CONTRIBUTING|CODE_OF_CONDUCT|GOVERNANCE|TRADEMARKS|THIRD_PARTY|SECURITY|package\.json|package-lock\.json|pnpm-lock\.yaml|\.github/PULL_REQUEST_TEMPLATE|\.github/ISSUE_TEMPLATE|\.github/workflows/branding-conformance\.yml|packages/bayaan-|data/availableTafaseer\.ts|data/reciterCollections\.ts|data/reciterData\.ts|data/changelog\.json|config/featureFlags\.ts|services/dataService\.ts|services/timestamps/TimestampFetchService\.ts|scripts/__tests__/|scripts/toggle-killswitch\.ts|scripts/generate-fallback-reciters\.ts|scripts/resize-splash-images\.js|scripts/generate-icons\.js|scripts/verify-catalog-urls\.ts|components/share/shareCardConstants\.ts|app/\(tabs\)/\(d\.settings\)/credits\.tsx'
    COMMENT_LINE='^[^:]+:[0-9]+:[[:space:]]*(//|/\*|\*/|\*([[:space:]]|$))'
    MATCHES=$(grep -rEn 'Bayaan|thebayaan' \
        --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
        --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=ios --exclude-dir=android \
        . 2>/dev/null | grep -vE "$ALLOWED" | grep -vE "$COMMENT_LINE" || true)
    if [ -n "$MATCHES" ]; then
        echo -e "${RED}❌ Hardcoded brand strings detected:${NC}"
        echo "$MATCHES"
        exit 1
    fi
    echo -e "${GREEN}  ✓ branding clean${NC}"

    echo -e "${BLUE}→ expo export (ios + android JS bundles)${NC}"
    npx expo export --platform ios --platform android --output-dir build/release-export

    write_state "boot-gated" "tsc + branding + expo export green"
    CURRENT_PHASE="boot-gated"
    echo -e "${GREEN}✓ Step 1 complete (phase = boot-gated)${NC}\n"
fi

# STEP 2 intentionally skipped — no install-via-adb per user direction.

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — Beta upload (iOS TestFlight + Android Play internal)
# ─────────────────────────────────────────────────────────────────────────────

if [ "$CURRENT_PHASE" = "boot-gated" ]; then
    echo -e "${YELLOW}── STEP 3: Beta upload to TestFlight + Play internal ──${NC}"

    BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
    if [ "$BRANCH" = "qariah-main" ]; then
        echo -e "${YELLOW}⚠️  On qariah-main — ios-archive.sh will auto-select PROD (com.qariah.app).${NC}"
        echo -e "${YELLOW}   For a true beta cycle, run from a non-main branch.${NC}"
    fi

    echo -e "${BLUE}→ ./scripts/ios-archive.sh --upload${NC}"
    "$SCRIPT_DIR/ios-archive.sh" --upload -y

    echo -e "${BLUE}→ ./scripts/android-archive.sh --bundle --upload=internal${NC}"
    "$SCRIPT_DIR/android-archive.sh" --bundle --upload=internal

    write_state "beta-uploaded" "iOS TestFlight + Android Play internal uploaded"
    CURRENT_PHASE="beta-uploaded"
    echo -e "${GREEN}✓ Step 3 complete (phase = beta-uploaded)${NC}\n"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — Operator confirmation
# ─────────────────────────────────────────────────────────────────────────────

if [ "$CURRENT_PHASE" = "beta-uploaded" ]; then
    echo -e "${YELLOW}── STEP 4: Beta soak window open ──${NC}"
    echo -e "${BLUE}Tester feedback period — review TestFlight + Play internal-track installs.${NC}"
    echo ""
    echo -e "${YELLOW}Press Enter when ready to promote to public beta, or Ctrl-C to abort.${NC}"
    read -r _
    write_state "soak-confirmed" "operator pressed Enter — promote authorized"
    CURRENT_PHASE="soak-confirmed"
    echo -e "${GREEN}✓ Step 4 complete (phase = soak-confirmed)${NC}\n"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 — Promote beta → prod (both platforms)
# ─────────────────────────────────────────────────────────────────────────────

if [ "$CURRENT_PHASE" = "soak-confirmed" ]; then
    echo -e "${YELLOW}── STEP 5: Promote beta → prod ──${NC}"

    echo -e "${BLUE}→ Fast-forward qariah-main${NC}"
    cd "$REPO_ROOT"
    git fetch origin qariah-main
    BRANCH="$(git rev-parse --abbrev-ref HEAD)"
    if [ "$BRANCH" != "qariah-main" ]; then
        echo -e "${YELLOW}⚠️  Not on qariah-main (current: $BRANCH). Checkout + ff manually before re-running.${NC}"
        exit 1
    fi
    git merge --ff-only origin/qariah-main

    # iOS promote — if an existing helper exists, use it; otherwise re-archive
    # against qariah-main as PROD and instruct operator to submit for review
    # on App Store Connect.
    if [ -x "$SCRIPT_DIR/ios-promote-beta-to-prod.sh" ]; then
        echo -e "${BLUE}→ ./scripts/ios-promote-beta-to-prod.sh${NC}"
        "$SCRIPT_DIR/ios-promote-beta-to-prod.sh"
    else
        echo -e "${YELLOW}ℹ️  No ios-promote-beta-to-prod.sh helper found.${NC}"
        echo -e "${YELLOW}   Re-archiving against qariah-main (PROD) and uploading as production build.${NC}"
        "$SCRIPT_DIR/ios-archive.sh" --upload --prod -y
        echo -e "${YELLOW}   App Store submission for review must be done manually:${NC}"
        echo -e "${YELLOW}     - App Store Connect → My Apps → Qariah → iOS App → +Version${NC}"
        echo -e "${YELLOW}     - Pick the just-uploaded build, fill in release notes, Submit for Review.${NC}"
    fi

    # Android — find the most recent prod-signed AAB (whatever was just built
    # against qariah-main) and promote to production track.
    AAB_PATH="$REPO_ROOT/android/app/build/outputs/bundle/release/app-release.aab"
    if [ ! -f "$AAB_PATH" ]; then
        echo -e "${YELLOW}ℹ️  No AAB at $AAB_PATH — building one against qariah-main (PROD env)…${NC}"
        "$SCRIPT_DIR/android-archive.sh" --bundle --prod
    fi
    echo -e "${BLUE}→ ./scripts/android-upload-play.sh --track=production${NC}"
    "$SCRIPT_DIR/android-upload-play.sh" --track=production "$AAB_PATH"

    write_state "promoted" "iOS + Android promoted; 7-day soak timer started"
    CURRENT_PHASE="promoted"
    echo -e "${GREEN}✓ Step 5 complete (phase = promoted)${NC}\n"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6 — Soak timer banner
# ─────────────────────────────────────────────────────────────────────────────

if [ "$CURRENT_PHASE" = "promoted" ]; then
    echo -e "${YELLOW}── STEP 6: Soak timer ──${NC}"
    PROMOTED_AT="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$STATE_FILE','utf8')).promotedAt || '')")"
    if [ -n "$PROMOTED_AT" ]; then
        # Compute soak end: promotedAt + 7 days. macOS `date -j` syntax.
        if date -j >/dev/null 2>&1; then
            SOAK_END=$(date -u -j -v+7d -f "%Y-%m-%dT%H:%M:%SZ" "$PROMOTED_AT" "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")
        else
            SOAK_END=$(date -u -d "$PROMOTED_AT + 7 days" "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")
        fi
        echo -e "${GREEN}  Promoted at: $PROMOTED_AT${NC}"
        echo -e "${GREEN}  Soak ends:   ${SOAK_END:-<computation failed>}${NC}"
    fi
    echo -e "${BLUE}  Cron .github/workflows/promote-beta-to-prod.yml will auto-promote when ready.${NC}\n"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 7 — runs in the cron workflow; printed here for operator visibility.
# ─────────────────────────────────────────────────────────────────────────────

if [ "$CURRENT_PHASE" = "released" ]; then
    echo -e "${GREEN}✓ Phase = released. Cycle complete. Run --reset to start a new cycle.${NC}"
fi
