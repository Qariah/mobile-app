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
#   scripts/backup-secrets.sh [STAGING_DIR]     stage for real
#   scripts/backup-secrets.sh --dry-run         report what WOULD be staged, copy nothing
#
#   STAGING_DIR defaults to ~/qariah-secrets-backup-<timestamp>.
#
# The script NEVER prints secret values. It copies files with 600 perms into a
# 700 staging dir, VERIFIES each staged copy by independent re-read, and prints a
# MANIFEST + an upload checklist. DELETE the staging dir after uploading.
#
# ---------------------------------------------------------------------------
# DESIGN RULES (learned the hard way, 2026-09-01 — do not regress these)
#
# 1. FAIL LOUDLY. A backup that stages nothing and exits 0 is worse than no
#    backup, because you only discover it at restore time — when the machine is
#    already gone. Every source is CRITICAL or OPTIONAL; a missing CRITICAL is a
#    non-zero exit, not a tally line. (Same class as the hygiene audit script
#    that fabricated findings from empty reads and exited 0.)
#
# 2. NEVER HARDCODE AN ACCOUNT-DERIVED PATH. The Claude memory dir is
#    ~/.claude/projects/-<home-with-slashes-as-dashes>-claude-qariah-v2/memory.
#    It was hardcoded to the pre-migration account and silently became a
#    "✗ MISSING" line on 2026-08-30 — the memory dir was dropped from every
#    backup for two days and the script still exited 0. Derive it from $HOME.
#
# 3. VERIFY BY INDEPENDENT RE-READ, NOT BY THE WRITE SUCCEEDING. `cp` returning 0
#    does not mean the bytes are usable. Each staged artifact is re-opened and
#    sanity-checked (keystore loads, JSON parses, key has a PEM header, .env.local
#    has a plausible key count) before the run is called a success.
#
# 4. DO NOT STAGE SECRETS IN /tmp. macOS purges it, so a backup can evaporate
#    between staging and upload, and it is world-traversable. Default to $HOME.
#
# 5. DO NOT MASK THE EXIT CODE. Never judge a run by piping it through head/sed.
#    The last line printed states PASS or FAIL explicitly, and $? agrees with it.
#
# 6. HONOUR THE SAME PATH OVERRIDES THE REST OF THE TOOLCHAIN USES. Every other
#    consumer resolves these as "$ENV_VAR, else the default path"
#    (android-upload-play.sh:104, play-reviews-triage.mjs:74,
#    android/app/build.gradle:126). A backup that only knows the default reports
#    MISSING for a secret that publishing uses happily every day — both a false
#    alarm and, worse, training to ignore a real one. Same shape as rule 2: an
#    assumed path instead of the configured one.
# ---------------------------------------------------------------------------
#
set -euo pipefail

DRY_RUN=0
POSITIONAL=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '17,25p' "$0"; exit 0 ;;
    # Reject anything that LOOKS like a flag. Falling through to POSITIONAL made a
    # mistyped `-dry-run` the staging DIRECTORY NAME, so the run died in mkdir with
    # "illegal option -- d" — a confusing failure for a one-character slip, and a
    # silent one for any typo that happens to be a legal directory name (you would
    # get a real backup staged somewhere you did not intend).
    -*)
      echo "✗ backup-secrets.sh: unknown option '$arg'" >&2
      echo "  Did you mean --dry-run? (two dashes)" >&2
      echo "  Usage: backup-secrets.sh [--dry-run] [STAGING_DIR]" >&2
      exit 2
      ;;
    *)
      [ -n "$POSITIONAL" ] && {
        echo "✗ backup-secrets.sh: more than one staging dir given ('$POSITIONAL', '$arg')" >&2
        exit 2
      }
      POSITIONAL="$arg"
      ;;
  esac
done

TS="$(date +%Y%m%d-%H%M%S)"
# Rule 4: $HOME, not /tmp.
STAGING="${POSITIONAL:-$HOME/qariah-secrets-backup-$TS}"
# Canonical maintainer checkout — .env.local lives here (worktrees only copy it
# in and may be absent). Override with QARIAH_MAIN_REPO if your checkout differs.
MAIN_REPO="${QARIAH_MAIN_REPO:-$HOME/claude/qariah-v2}"
REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || echo "$MAIN_REPO")"

# Rule 2: derive the Claude project slug from $HOME instead of hardcoding an
# account name: the home path with its slashes turned into dashes, then
# "-claude-qariah-v2" (the same rule ~/.claude/bin/check-portable-paths.sh documents).
CLAUDE_SLUG="-$(printf '%s' "${HOME#/}" | tr '/' '-')-claude-qariah-v2"
CLAUDE_MEMORY="$HOME/.claude/projects/$CLAUDE_SLUG/memory"

# Rule 6: read one KEY= out of .env.local WITHOUT sourcing the whole file
# (sourcing an arbitrary env file into this shell could clobber HOME/PATH).
# Strips optional quotes and expands a leading ~.
env_local_value() {
  local key="$1" file="$MAIN_REPO/.env.local" raw
  [ -f "$file" ] || return 0
  raw="$(grep -m1 -E "^${key}=" "$file" 2>/dev/null | cut -d= -f2-)" || return 0
  raw="${raw%\"}"; raw="${raw#\"}"
  raw="${raw%\'}"; raw="${raw#\'}"
  raw="${raw/#\~/$HOME}"
  printf '%s' "$raw"
}

# Resolve overridable paths the way the publishing toolchain does:
# environment first, then .env.local, then the documented default.
PLAY_SA_JSON="${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:-$(env_local_value GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)}"
PLAY_SA_JSON="${PLAY_SA_JSON:-$HOME/.android/play-service-account.json}"
UPLOAD_KEYSTORE="${QARIAH_UPLOAD_STORE_FILE:-$(env_local_value QARIAH_UPLOAD_STORE_FILE)}"
UPLOAD_KEYSTORE="${UPLOAD_KEYSTORE:-$HOME/.android/keystores/qariah-upload-key.jks}"

if [ "$DRY_RUN" -eq 0 ]; then
  mkdir -p "$STAGING"
  chmod 700 "$STAGING"
  MANIFEST="$STAGING/MANIFEST.txt"
  : > "$MANIFEST"
  chmod 600 "$MANIFEST"
else
  MANIFEST="$(mktemp -t qariah-backup-manifest)"
fi

ok=0; miss_critical=0; miss_optional=0; verify_fail=0
note()  { printf '%s\n' "$1" | tee -a "$MANIFEST" >/dev/null; }
have()  { note "  ✓ $1"; ok=$((ok+1)); }
lack()  {
  local sev="$1" msg="$2"
  if [ "$sev" = CRITICAL ]; then note "  ✗ MISSING [CRITICAL]: $msg"; miss_critical=$((miss_critical+1))
  else                          note "  – absent  [optional]: $msg"; miss_optional=$((miss_optional+1)); fi
}
bad()   { note "  ✗ VERIFY FAILED: $1"; verify_fail=$((verify_fail+1)); }

# Rule 3: re-open the STAGED copy and sanity-check it. Never prints values.
verify_staged() {
  local dest="$1" kind="$2" label="$3"
  [ -e "$dest" ] || { bad "$label — staged path missing after copy"; return; }
  case "$kind" in
    envfile)
      local keys; keys="$(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$dest" || true)"
      [ "${keys:-0}" -ge 5 ] || bad "$label — only ${keys:-0} KEY= lines; expected a populated env file"
      ;;
    json)
      python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$dest" >/dev/null 2>&1 \
        || bad "$label — not parseable JSON"
      ;;
    keystore)
      if command -v keytool >/dev/null 2>&1 && [ -n "${QARIAH_UPLOAD_STORE_PASSWORD:-}" ]; then
        keytool -list -keystore "$dest" -storepass "$QARIAH_UPLOAD_STORE_PASSWORD" >/dev/null 2>&1 \
          || bad "$label — keytool could not open the staged keystore"
      else
        # No password available: at least prove it is a real keystore container.
        [ -s "$dest" ] || bad "$label — empty keystore file"
      fi
      ;;
    pemkey)
      # A dir of .p8s, or a single key file.
      if [ -d "$dest" ]; then
        grep -rlq -- '-----BEGIN' "$dest" 2>/dev/null || bad "$label — no PEM-headered key found in the staged dir"
      else
        grep -q -- '-----BEGIN' "$dest" 2>/dev/null || bad "$label — no PEM header in the staged key"
      fi
      ;;
    dir)
      [ -n "$(ls -A "$dest" 2>/dev/null)" ] || bad "$label — staged directory is empty"
      ;;
    file)
      [ -s "$dest" ] || bad "$label — staged file is zero bytes"
      ;;
  esac
}

# grab SRC -> STAGING/<destrel>. SEVERITY is CRITICAL or OPTIONAL. KIND drives verification.
grab() {
  local src="$1" destrel="$2" severity="$3" kind="$4" label="$5"
  local dest="$STAGING/$destrel"
  if [ ! -e "$src" ]; then
    lack "$severity" "$label  (expected at $src)"
    return
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    have "$label  ($src)  [dry-run: not copied]"
    return
  fi
  mkdir -p "$(dirname "$dest")"
  cp -R "$src" "$dest"
  find "$dest" -type f -exec chmod 600 {} \;
  verify_staged "$dest" "$kind" "$label"
  have "$label  ($src)"
}

note "Qariah secrets backup — $TS"
[ "$DRY_RUN" -eq 1 ] && note "MODE: DRY RUN (nothing is copied)"
note "Staging dir: $STAGING"
note "Repo root:   $REPO_ROOT"
note "Claude slug: $CLAUDE_SLUG  (derived from \$HOME)"
note "Play SA:     $PLAY_SA_JSON"
note "Keystore:    $UPLOAD_KEYSTORE"
note ""
note "== Files staged =="

# --- app/build/publish secrets ---
# .env.local: prefer the canonical main checkout; fall back to this worktree.
if [ -f "$MAIN_REPO/.env.local" ]; then
  grab "$MAIN_REPO/.env.local"                    "env/qariah-v2.env.local"           CRITICAL envfile  ".env.local (qariah-v2 main checkout)"
else
  grab "$REPO_ROOT/.env.local"                    "env/qariah-v2.env.local"           CRITICAL envfile  ".env.local (qariah-v2 worktree)"
fi
grab "$HOME/claude/qariah-ops-console/.dev.vars"  "env/ops-console.dev.vars"          OPTIONAL file     "ops-console .dev.vars"
grab "$HOME/claude/qariah-media-proxy/.dev.vars"  "env/media-proxy.dev.vars"          OPTIONAL file     "media-proxy .dev.vars"

# --- Android signing + publishing ---
# The keystore is the one true irreplaceable: losing it forces a Play upload-key
# reset with a multi-day Google turnaround (TECH_DEBT #29, lived through once).
grab "$UPLOAD_KEYSTORE"                                 "android/qariah-upload-key.jks"      CRITICAL keystore "Android upload keystore (.jks)"
# Targeted hint: a "LOCAL-VERIFY-ONLY" keystore is NOT the production upload key.
# Seeing only that one means the real key never made it onto this machine (e.g. it
# was left behind by an account migration) — check 1Password before assuming loss,
# and never let a verify-only key masquerade as the backup.
if [ ! -f "$UPLOAD_KEYSTORE" ] \
   && ls "$HOME"/.android/keystores/*LOCAL-VERIFY-ONLY* >/dev/null 2>&1; then
  note "      ↳ NOTE: only a *LOCAL-VERIFY-ONLY* keystore is present. That is NOT the"
  note "        Play upload key. Confirm 1Password holds the real .jks + its passphrase"
  note "        BEFORE relying on this backup — re-issuing it means another upload-key"
  note "        reset (TECH_DEBT #29, multi-day Google turnaround)."
fi
grab "$HOME/.android/keystores/qariah-upload-cert.pem"  "android/qariah-upload-cert.pem"     CRITICAL pemkey   "Android upload cert (.pem)"
grab "$PLAY_SA_JSON"                                    "android/play-service-account.json"  CRITICAL json     "Google Play service-account JSON"

# --- iOS publishing ---
grab "$HOME/.appstoreconnect/private_keys"        "ios/appstoreconnect_private_keys"  CRITICAL pemkey   "App Store Connect API key (.p8)"

# --- Claude working memory (not in any repo) ---
# Rule 2: path is derived, and this is CRITICAL — it silently vanished from
# backups for two days after the 2026-08-30 account migration because it wasn't.
grab "$CLAUDE_MEMORY"                             "claude/memory"                     CRITICAL dir      "Claude Qariah memory dir"

# --- iOS Apple Distribution identity → .p12 (cert + PRIVATE KEY; not re-downloadable) ---
note ""
note "== iOS Apple Distribution .p12 export =="
P12="$STAGING/ios/qariah-ios-distribution.p12"
[ "$DRY_RUN" -eq 0 ] && mkdir -p "$STAGING/ios"
if security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Distribution"; then
  note "  Found an 'Apple Distribution' identity in the login keychain."
  note "  Export it (interactive — Keychain will prompt to allow + you pick a passphrase):"
  note "    security export -t identities -f pkcs12 -k login.keychain-db \\"
  note "      -P '<choose-a-strong-passphrase>' -o '$P12'"
  note "  ON RE-IMPORT (new Mac): pick the \"login\" keychain — the dialog defaults"
  note "  to \"Local Items\", which silently hides the identity from codesign — and"
  note "  do NOT tick \"Always Trust\" (it breaks signing; see RESTORE-FIRST.txt)."
  note "  Store BOTH the .p12 AND its passphrase in 1Password (the passphrase is"
  note "  required to import it on a new Mac). If 'security export' errors with a"
  note "  user-interaction-not-allowed message, do it via Keychain Access.app:"
  note "    Keychain Access → My Certificates → 'Apple Distribution: …' →"
  note "    right-click → Export → .p12 → set the passphrase."
  lack OPTIONAL "iOS Distribution .p12 (MANUAL export — see commands above)"
else
  note "  No 'Apple Distribution' identity found in the login keychain on this Mac."
  lack OPTIONAL "iOS Distribution .p12 (no identity present to export)"
fi

note ""
note "== Summary =="
note "  staged OK: $ok    missing CRITICAL: $miss_critical    absent optional: $miss_optional    verify failures: $verify_fail"
note ""
note "== Upload checklist (1Password → 'Qariah — Infra Secrets' vault) =="
note "  Create/Update a Secure Note item per group and attach the files:"
note "    • env/        → .env.local + any .dev.vars"
note "    • android/    → .jks + .pem + play-service-account.json"
note "    • ios/        → AuthKey_*.p8 + qariah-ios-distribution.p12 (+ its passphrase as a field)"
note "    • claude/     → memory/ (zipped for you below)"
note "    • RESTORE-FIRST.txt → attach this too; it carries the restore traps"
note "      that are otherwise only in the repo you will not have yet."
note "  Also record (text fields, not files): the keystore alias + passwords"
note "  (QARIAH_UPLOAD_*), the .p12 passphrase, and the ops-console CF-dashboard"
note "  secrets that have no local file (R2 keys, CF Access policy) — see"
note "  DISASTER_RECOVERY.md §ops-console."
note ""
note "  If you install the 1Password CLI (brew install 1password-cli) and run"
note "  'op signin', a future version of this script can attach these"
note "  automatically; today it stages for manual drag-and-drop."

# zip the memory dir for tidy attachment. Rule 1: if the zip fails, say so —
# do NOT swallow it, or the memory silently ships as nothing.
if [ "$DRY_RUN" -eq 0 ] && [ -d "$STAGING/claude/memory" ]; then
  if ( cd "$STAGING/claude" && zip -qr memory.zip memory ); then
    # The zip is created AFTER grab()'s per-file chmod pass, so it does not
    # inherit 600 from it — set it here or the archive ships world-readable.
    chmod 600 "$STAGING/claude/memory.zip" 2>/dev/null || true
    [ -s "$STAGING/claude/memory.zip" ] && rm -rf "$STAGING/claude/memory" \
      || bad "Claude memory zip is empty — keeping the raw dir"
  else
    bad "Claude memory zip failed — keeping the raw dir so nothing is lost"
  fi
fi

# The vault is what survives a dead Mac — the repo may not be cloned yet at
# restore time. Ship the restore-critical gotchas INSIDE the backup so they
# arrive with the secrets, not only in DISASTER_RECOVERY.md.
if [ "$DRY_RUN" -eq 0 ]; then
  cat > "$STAGING/RESTORE-FIRST.txt" <<'RESTORE_EOF'
QARIAH RESTORE — READ BEFORE IMPORTING ANYTHING
================================================
Full procedure: DISASTER_RECOVERY.md in the qariah-v2 repo. This file exists
because on a dead-Mac restore you have this vault BEFORE you have the repo.

Everything below was learned by losing hours to it on 2026-09-02.

1. iOS .p12 import — three traps, in the order you will hit them:
   a) The "Add Certificates" dialog DEFAULTS to the "Local Items" keychain.
      Choose "login". Local Items is the iCloud password keychain; the import
      looks successful and codesign never sees the identity.
   b) DO NOT tick "Always Trust". Leave it on "Use System Defaults".
      Always Trust marks the LEAF as a trust anchor, so codesign fails with
        "unable to build chain to self-signed root" + errSecInternalComponent
      while `security verify-cert -p codeSign` still reports SUCCESS.
      That exact split is the fingerprint of a trust override, NOT a missing
      certificate. Undo it:
        security find-certificate -c "Apple Distribution: <name>" -p > "${TMPDIR:-/tmp}/leaf.pem"
        security remove-trusted-cert "${TMPDIR:-/tmp}/leaf.pem"      # approve the GUI prompt
        security dump-trust-settings                    # want "No Trust Settings were found"
   c) Pre-authorize the key or the first xcodebuild archive HANGS on an
      invisible prompt rather than failing:
        security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
          ~/Library/Keychains/login.keychain-db

2. WWDR intermediate — check BOTH keychains in the search list. A Mac carried
   through OS upgrades often still holds the 2013 cert, EXPIRED 2023-02-07,
   which shadows the good one:
     good  G3  SHA-1 06EC06599F4ED0027CC58956B4D3AC1255114F35  (to 2030)
     stale     SHA-1 FF6797793A3CD798DC5B2ABEF56F73EDC9F83A64  (expired) -> delete
   Fix: sudo security delete-certificate -Z <stale-sha1> /Library/Keychains/System.keychain
        cd /tmp && curl -fsSLO https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer \
          && sudo security import AppleWWDRCAG3.cer -k /Library/Keychains/System.keychain

3. VERIFY BY USING EACH SECRET, never by seeing the file exist. Everything
   looked correct by inspection while signing was completely broken.
     codesign --force --sign "Apple Distribution: <name> (<TEAMID>)" "${TMPDIR:-/tmp}/somebinary"
   Want exit 0, no chain warning, and TeamIdentifier = APPLE_TEAM_ID.
   `security find-identity` reporting "1 valid identity" proves NOTHING here.

4. Known-good reference values (2026-09-02):
     Apple team id ............ 9FX2C39549
     Upload-key cert SHA-1 .... 52:13:B5:AD:89:C8:55:CA:82:3D:20:86:0A:83:96:12:C7:86:C5:1A
     Play SA client email ..... qariah-play-publisher@sixth-well-487004-a5.iam.gserviceaccount.com
     Distribution cert expiry . 2027-05-07  (re-issue + re-vault before then)
   A keystore file named *LOCAL-VERIFY-ONLY* is NOT the Play upload key.

5. Claude memory dir: unzip claude/memory.zip to
     ~/.claude/projects/<slug>/memory/
   DERIVE <slug> from the NEW machine's $HOME, never copy it from the old one:
     echo "-$(printf '%s' "${HOME#/}" | tr '/' '-')-claude-qariah-v2"
   A copied slug points at a dead directory and the backup silently stops
   capturing memory (this happened, undetected, for days).
RESTORE_EOF
  chmod 600 "$STAGING/RESTORE-FIRST.txt"
fi

echo
cat "$MANIFEST"
[ "$DRY_RUN" -eq 1 ] && rm -f "$MANIFEST"
echo

# Rule 1 + 5: an explicit verdict, and an exit code that agrees with it.
if [ "$miss_critical" -gt 0 ] || [ "$verify_fail" -gt 0 ]; then
  echo "❌ BACKUP INCOMPLETE — $miss_critical missing CRITICAL, $verify_fail failed verification."
  echo "   Do NOT treat this as a backup. Fix the sources above and re-run."
  [ "$DRY_RUN" -eq 0 ] && echo "   Partial staging left at: $STAGING"
  exit 1
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "✅ DRY RUN PASS — every CRITICAL source is present and would be staged."
  echo "   Re-run without --dry-run to stage for real."
  exit 0
fi

echo "✅ BACKUP COMPLETE — $ok artifacts staged and verified by re-read."
echo "⚠️  Staging dir contains REAL SECRETS at: $STAGING"
echo "⚠️  Upload to 1Password, then DELETE it:  rm -rf '$STAGING'"
