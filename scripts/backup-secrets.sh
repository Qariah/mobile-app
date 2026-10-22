#!/usr/bin/env bash
#
# backup-secrets.sh — stage the machine-only Qariah secrets into one folder for
# upload to the 1Password "Qariah — Infra Secrets" vault (the off-machine backup).
#
# These files live ONLY on the maintainer's Mac and are NOT in any git repo:
#   - .env.local (all build/publish/admin secrets)
#   - Android upload keystore (.jks) + cert (.pem) + its passwords (in .env.local)
#   - Google Play service-account JSON
#   - App Store Connect API key (.p8)
#   - iOS Apple Distribution cert + private key (exported as .p12 — NOT re-downloadable)
#   - ~/.claude Qariah memory (working context, not in any repo)
#
# Losing any of these forces a painful re-issue (e.g. an Android upload-key reset,
# TECH_DEBT #29). See DISASTER_RECOVERY.md for the restore side.
#
# Usage:
#   scripts/backup-secrets.sh [STAGING_DIR]
#       STAGING_DIR defaults to /tmp/qariah-secrets-backup-<timestamp>
#
# The script NEVER prints secret values. It copies files with 600 perms into a
# 700 staging dir and prints a MANIFEST + an upload checklist. DELETE the staging
# dir after you've uploaded to 1Password (the script reminds you).
#
set -euo pipefail

TS="$(date +%Y%m%d-%H%M%S)"
STAGING="${1:-/tmp/qariah-secrets-backup-$TS}"
# Canonical maintainer checkout — .env.local lives here (worktrees only copy it
# in and may be absent). Override with QARIAH_MAIN_REPO if your checkout differs.
MAIN_REPO="${QARIAH_MAIN_REPO:-$HOME/claude/qariah-v2}"
REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || echo "$MAIN_REPO")"

mkdir -p "$STAGING"
chmod 700 "$STAGING"
MANIFEST="$STAGING/MANIFEST.txt"
: > "$MANIFEST"

ok=0; miss=0
note()  { printf '%s\n' "$1" | tee -a "$MANIFEST" >/dev/null; }
have()  { note "  ✓ $1"; ok=$((ok+1)); }
lack()  { note "  ✗ MISSING: $1"; miss=$((miss+1)); }

# copy SRC into STAGING/<destrel>; warn (don't fail) if missing
grab() {
  local src="$1" destrel="$2" label="$3"
  local dest="$STAGING/$destrel"
  if [ -e "$src" ]; then
    mkdir -p "$(dirname "$dest")"
    cp -R "$src" "$dest"
    find "$dest" -type f -exec chmod 600 {} \;
    have "$label  ($src)"
  else
    lack "$label  (expected at $src)"
  fi
}

note "Qariah secrets backup — $TS"
note "Staging dir: $STAGING"
note "Repo root:   $REPO_ROOT"
note ""
note "== Files staged =="

# --- app/build/publish secrets ---
# .env.local: prefer the canonical main checkout; fall back to this worktree.
if [ -f "$MAIN_REPO/.env.local" ]; then
  grab "$MAIN_REPO/.env.local"                                 "env/qariah-v2.env.local"            ".env.local (qariah-v2 main checkout)"
else
  grab "$REPO_ROOT/.env.local"                                 "env/qariah-v2.env.local"            ".env.local (qariah-v2 worktree)"
fi
grab "$HOME/claude/qariah-ops-console/.dev.vars"               "env/ops-console.dev.vars"           "ops-console .dev.vars (if present)"
grab "$HOME/claude/qariah-media-proxy/.dev.vars"               "env/media-proxy.dev.vars"           "media-proxy .dev.vars (if present)"

# --- Android signing + publishing ---
grab "$HOME/.android/keystores/qariah-upload-key.jks"          "android/qariah-upload-key.jks"       "Android upload keystore (.jks)"
grab "$HOME/.android/keystores/qariah-upload-cert.pem"         "android/qariah-upload-cert.pem"      "Android upload cert (.pem)"
grab "$HOME/.android/play-service-account.json"                "android/play-service-account.json"  "Google Play service-account JSON"

# --- iOS publishing ---
grab "$HOME/.appstoreconnect/private_keys"                     "ios/appstoreconnect_private_keys"   "App Store Connect API key (.p8)"

# --- Claude working memory (not in any repo) ---
grab "$HOME/.claude/projects/-Users-omarzarka-claude-qariah-v2/memory" "claude/memory"              "Claude Qariah memory dir"

# --- iOS Apple Distribution identity → .p12 (cert + PRIVATE KEY; not re-downloadable) ---
note ""
note "== iOS Apple Distribution .p12 export =="
P12="$STAGING/ios/qariah-ios-distribution.p12"
mkdir -p "$STAGING/ios"
if security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Distribution"; then
  note "  Found an 'Apple Distribution' identity in the login keychain."
  note "  Export it (interactive — Keychain will prompt to allow + you pick a passphrase):"
  note "    security export -t identities -f pkcs12 -k login.keychain-db \\"
  note "      -P '<choose-a-strong-passphrase>' -o '$P12'"
  note "  Store BOTH the .p12 AND its passphrase in 1Password (the passphrase is"
  note "  required to import it on a new Mac). If 'security export' errors with a"
  note "  user-interaction-not-allowed message, do it via Keychain Access.app:"
  note "    Keychain Access → My Certificates → 'Apple Distribution: …' →"
  note "    right-click → Export → .p12 → set the passphrase."
  lack "iOS Distribution .p12 (manual export — see commands above)"
else
  note "  No 'Apple Distribution' identity found in the login keychain on this Mac."
  lack "iOS Distribution .p12 (no identity present to export)"
fi

note ""
note "== Summary =="
note "  staged OK: $ok    missing/manual: $miss"
note ""
note "== Upload checklist (1Password → 'Qariah — Infra Secrets' vault) =="
note "  Create/Update a Secure Note item per group and attach the files:"
note "    • env/        → .env.local + any .dev.vars"
note "    • android/    → .jks + .pem + play-service-account.json"
note "    • ios/        → AuthKey_*.p8 + qariah-ios-distribution.p12 (+ its passphrase as a field)"
note "    • claude/     → memory/ (zip it first)"
note "  Also record (text fields, not files): the keystore alias + passwords"
note "  (QARIAH_UPLOAD_*), the .p12 passphrase, and the ops-console CF-dashboard"
note "  secrets that have no local file (R2 keys, CF Access policy) — see"
note "  DISASTER_RECOVERY.md §ops-console."
note ""
note "  If you install the 1Password CLI (brew install 1password-cli) and run"
note "  'op signin', a future version of this script can attach these"
note "  automatically; today it stages for manual drag-and-drop."

# zip the memory dir for tidy attachment, if it came across
if [ -d "$STAGING/claude/memory" ]; then
  ( cd "$STAGING/claude" && zip -qr memory.zip memory && rm -rf memory ) || true
fi

echo
cat "$MANIFEST"
echo
echo "⚠️  Staging dir contains REAL SECRETS at: $STAGING"
echo "⚠️  Upload to 1Password, then DELETE it:  rm -rf '$STAGING'"
