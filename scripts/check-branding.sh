#!/usr/bin/env bash
# Branding conformance (hard-rule #4): no hardcoded Bayaan brand strings.
#
# CI runs this script from .github/workflows/branding-conformance.yml. Run it
# locally the same way, from anywhere in the checkout:
#
#   bash scripts/check-branding.sh
#
# Exit 0 = clean, 1 = a brand string was found. Two checks:
#   1. JS/TS: "Bayaan" or "thebayaan" in .ts/.tsx/.js/.jsx outside the
#      allowlists below (moved here from the workflow in Sprint 46).
#   2. Native: the word "Bayaan" in user-visible text in .swift/.kt/.xml/
#      .plist/.xcstrings/.strings under modules/ and targets/, and in the
#      string literals of the JS/TS paths that PASS_B_ALLOWED exempts
#      (scripts/check-native-branding.mjs).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

# Allowed in:
#   - branding config (canonical home)
#   - allowlisted file paths (markdown docs, package metadata, i18n keys, etc.)
#   - test files under scripts/__tests__/ — Sprint 23 (S23.1):
#     verify-version-sync.test.js uses upstream-canonical fixture
#     paths (ios/Bayaan/Info.plist, BayaanTests/, …) because the
#     function under test discovers ios/*/Info.plist by upstream
#     naming; keeping the upstream fixtures keeps the test mergeable.
#   - source-code COMMENT lines (// or /* … */ or *) — Sprint 6 (S6.2):
#     comments referencing "Bayaan" as a code identifier (`BayaanError`,
#     "upstream Bayaan convention", etc.) are legitimate; the comment
#     filter prevents false positives that tripped Sprint 4 + 5.
#   - services/timestamps/TimestampFetchService.ts — Sprint 26 RFC-015:
#     after the RFC-015 adoption, the URL is read from
#     `branding.timestampCdnBase` (Qariah sets its own R2 base),
#     with the upstream CDN URL kept as an inline `??` fallback
#     to preserve byte-equivalent behavior when the field is
#     absent (Bayaan default). The single literal `thebayaan`
#     occurrence is that fallback string — deliberate per the
#     RFC-015 contract. File stays allowlisted so the fallback
#     can stay inline (the alternative — hoisting the fallback
#     into a comment-only constant — defeats the seam's intent
#     of mirroring upstream byte-for-byte until the upstream
#     code-PR merges, at which point this file becomes pure
#     upstream code with no Qariah delta).
#   - scripts/upload-adhkar-audio.ts — Sprint 40 (SDK-56 absorption):
#     inherited upstream ops script (uploads adhkar audio to Bayaan's
#     CDN). Qariah ships adhkar:false and never runs it; the
#     `cdn.thebayaan.com` literal is Bayaan's adhkar CDN, not a Qariah
#     brand string. Allowlisted like the other inherited scripts so the
#     upstream file stays mergeable (don't-delete-upstream-code rule).
ALLOWED='config/branding\.(ts|js|d\.ts)|DIVERGENCE_LEDGER\.md|TECH_DEBT\.md|planning/|docs/|README|CHANGELOG|LICENSE|CONTRIBUTING|CODE_OF_CONDUCT|GOVERNANCE|TRADEMARKS|THIRD_PARTY|SECURITY|package\.json|package-lock\.json|pnpm-lock\.yaml|\.github/PULL_REQUEST_TEMPLATE|\.github/ISSUE_TEMPLATE|\.github/workflows/branding-conformance\.yml|packages/bayaan-|data/availableTafaseer\.ts|data/reciterCollections\.ts|data/reciterData\.ts|data/changelog\.json|config/featureFlags\.ts|services/dataService\.ts|services/timestamps/TimestampFetchService\.ts|scripts/__tests__/|scripts/toggle-killswitch\.ts|scripts/generate-fallback-reciters\.ts|scripts/resize-splash-images\.js|scripts/generate-icons\.js|scripts/verify-catalog-urls\.ts|scripts/upload-adhkar-audio\.ts|components/share/shareCardConstants\.ts|app/\(tabs\)/\(d\.settings\)/credits\.tsx'

# Pass B (Sprint 46, story B4): the upstream CarPlay, Android Auto and widget
# code (Bayaan #334-#343) carries the upstream name in identifiers: module
# names (BayaanCar, BayaanWidgets), the widget kind BayaanNow, the Info.plist
# key BayaanAppGroup, file names. Each entry is anchored to its path, and the
# entries outside the module trees also name the allowed line. The native
# check below still reads the string literals of these JS/TS paths, so
# user-visible "Bayaan" text in them still fails.
PASS_B_ALLOWED=(
  # The upstream module trees, as packages/bayaan- above.
  '^\./modules/bayaan-'
  '^\./services/car/'
  '^\./services/widgets/'
  '^\./plugins/with(BayaanCar|AppShortcuts|BayaanWidgets)\.js:'
  '^\./plugins/__tests__/withBayaanWidgets\.test\.js:'
  '^\./targets/widgets/expo-target\.config\.js:'
  # The widget id BayaanNow (an identifier; the label comes from the plugin).
  "^\./config/nativeWidgets\.(js|d\.ts):[0-9]+:.*'BayaanNow'"
  '^\./config/__tests__/nativeWidgets\.test\.ts:'
  # The car and widget surah-artwork CDN default, until
  # branding.surahArtworkCdnBase is set (plan B3, "Artwork").
  "^\./utils/surahArtworkBase\.ts:[0-9]+:.*'https://cdn\.thebayaan\.com/assets/car/surah/'"
  '^\./utils/__tests__/surahArtworkBase\.test\.ts:'
  # app.config.ts: the App Group Info.plist key and the plugin paths.
  "^\./app\.config\.ts:[0-9]+:[[:space:]]*(BayaanAppGroup:|'\./plugins/with(BayaanCar|BayaanWidgets)\.js',)"
  # The mock of the BayaanCar native module (Sprint 46 boot test).
  '^\./services/__tests__/appBoot\.qariah\.characterization\.test\.ts:[0-9]+:[[:space:]]*BayaanCar: \{$'
  # Pass C (Sprint 47): upstream's adhkar lock-screen suite mocks branding
  # with appName 'Bayaan' (a fixture value, never shown to a user). Kept
  # byte-identical to upstream.
  "^\./services/audio/__tests__/LockScreenService\.adhkar\.test\.ts:[0-9]+:.*'Bayaan'"
)
PASS_B="$(IFS='|'; echo "${PASS_B_ALLOWED[*]}")"

# Comment-line filter — drop lines whose first non-whitespace token is
# //, /*, *, or */. Anchored on `path:line:` prefix from `grep -n`.
COMMENT_LINE='^[^:]+:[0-9]+:[[:space:]]*(//|/\*|\*/|\*([[:space:]]|$))'

MATCHES=$(grep -rEn 'Bayaan|thebayaan' \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=ios --exclude-dir=android \
  . 2>/dev/null | grep -vE "$ALLOWED" | grep -vE "$PASS_B" | grep -vE "$COMMENT_LINE" || true)

STATUS=0
if [ -n "$MATCHES" ]; then
  echo "::error::Hardcoded Bayaan brand strings detected outside config/branding.ts."
  echo "Each match below must either be moved to config/branding.ts or have its file path added to the allowlist in scripts/check-branding.sh."
  echo "Comments are exempt — if your line is a // or /* … */ comment, prefix it accordingly."
  echo ""
  echo "$MATCHES"
  STATUS=1
else
  echo "✓ No hardcoded Bayaan brand strings found in source files."
fi

if ! node scripts/check-native-branding.mjs "$ROOT"; then
  echo "::error::User-visible Bayaan text in native or module code (scripts/check-native-branding.mjs)."
  STATUS=1
fi

exit "$STATUS"
