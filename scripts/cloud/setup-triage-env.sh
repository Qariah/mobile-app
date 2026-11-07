#!/usr/bin/env bash
# setup-triage-env.sh — prepare a Claude Cloud session for the daily triage routine.
#
# The routine runs this script after `bash scripts/run-start.sh triage` and before any
# triage script. It is safe to run again: every step writes the same result.
#
# Usage:
#   bash scripts/cloud/setup-triage-env.sh           # in a cloud session
#   bash scripts/cloud/setup-triage-env.sh --force   # outside the cloud (tests only)
#
# What it does:
#   1. Checks Node. The triage scripts need Node 20 or later (global fetch, node:test).
#      The cloud VM has Node 22 on PATH (docs/operations/cloud-triage.md).
#   2. Does NOT run `npm ci`. The triage scripts import only Node built-in modules, files
#      under scripts/, and config/branding.js (through scripts/lib/app-ids.mjs; it has no
#      top-level import), so they need no node_modules. (Checked 2026-09-27 for every
#      script that docs/operations/cloud-triage.md lists; checked again 2026-10-12.)
#   3. Writes the App Store Connect key file from APP_STORE_CONNECT_API_KEY_P8_B64
#      (base64 of the .p8 file) to
#        $HOME/.appstoreconnect/private_keys/AuthKey_<APP_STORE_CONNECT_API_KEY_ID>.p8
#      scripts/asc-phased-release.mjs reads only that file. scripts/lib/asc-client.mjs
#      also reads the variable directly.
#   4. Writes the Google Play service-account key from GOOGLE_PLAY_SA_JSON_B64 (base64 of
#      the JSON file) to $HOME/.android/play-service-account.json, the default path of
#      scripts/lib/google-play-auth.mjs (play-vitals.mjs, asc-phased-release.mjs and
#      lib/anr-card.mjs use it).
#   5. Installs the GitHub CLI when it is missing (the cloud VM has no `gh`; found by the
#      first shadow run on 2026-09-27). It uses the Ubuntu package (`apt-get install gh`).
#      Then it checks that `gh api` reaches the repository over REST.
#   6. Probes each key with one read-only GET: Sentry, PostHog and the Play reporting API.
#      A failed probe prints "probe FAIL <service>: HTTP <code> <reason>" and the run goes on.
#
# It never prints a secret. It prints each path it writes, the byte count, and a check.
# Without CLAUDE_CODE_REMOTE=true it stops before step 3, so it cannot replace the key
# files on the Mac by mistake. --force runs it anyway (the local cloud simulation sets
# HOME to a scratch directory first).
#
# Exit 0 = ready. Exit 1 = a required value is missing or wrong (the lines say which).
set -uo pipefail
umask 077

force=0
[ "${1:-}" = "--force" ] && force=1
fail=0
say() { echo "setup: $*"; }
bad() {
  echo "setup: FAIL $*" >&2
  fail=1
}

# --- 1. node -------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  bad "node is not on PATH"
else
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -lt 20 ]; then
    bad "node $(node --version) is too old; the triage scripts need Node 20 or later"
  else
    say "node $(node --version) OK"
  fi
fi

# --- 2. dependencies -----------------------------------------------------------------
say "npm ci not needed (the triage scripts use Node built-in modules only)"

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ] && [ "$force" -ne 1 ]; then
  say "not a cloud session (CLAUDE_CODE_REMOTE is not true): key files not written. Use --force to test."
  exit "$fail"
fi

# --- 3. App Store Connect key --------------------------------------------------------
if [ -z "${APP_STORE_CONNECT_API_KEY_ID:-}" ] || [ -z "${APP_STORE_CONNECT_ISSUER_ID:-}" ]; then
  bad "APP_STORE_CONNECT_API_KEY_ID and APP_STORE_CONNECT_ISSUER_ID must be set"
elif [ -z "${APP_STORE_CONNECT_API_KEY_P8_B64:-}" ]; then
  bad "APP_STORE_CONNECT_API_KEY_P8_B64 is not set (base64 of the AuthKey_<id>.p8 file)"
else
  p8="$HOME/.appstoreconnect/private_keys/AuthKey_${APP_STORE_CONNECT_API_KEY_ID}.p8"
  mkdir -p "$(dirname "$p8")"
  if printf '%s' "$APP_STORE_CONNECT_API_KEY_P8_B64" | node -e '
      let s = ""; process.stdin.on("data", d => (s += d)).on("end", () => {
        const pem = Buffer.from(s.replace(/\s+/g, ""), "base64").toString("utf8");
        if (!/-----BEGIN PRIVATE KEY-----/.test(pem)) process.exit(3);
        require("crypto").createPrivateKey(pem);
        require("fs").writeFileSync(process.argv[1], pem, {mode: 0o600});
      });' "$p8" 2>/dev/null; then
    say "wrote $p8 ($(wc -c <"$p8" | tr -d ' ') bytes, a valid private key)"
  else
    bad "APP_STORE_CONNECT_API_KEY_P8_B64 is not the base64 of a .p8 private key"
  fi
fi

# --- 4. Google Play service account ---------------------------------------------------
sa="$HOME/.android/play-service-account.json"
if [ -n "${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:-}" ]; then
  say "note: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is set, so the scripts read that path, not $sa"
fi
if [ -z "${GOOGLE_PLAY_SA_JSON_B64:-}" ]; then
  bad "GOOGLE_PLAY_SA_JSON_B64 is not set (base64 of the service-account JSON file)"
else
  mkdir -p "$(dirname "$sa")"
  if printf '%s' "$GOOGLE_PLAY_SA_JSON_B64" | node -e '
      let s = ""; process.stdin.on("data", d => (s += d)).on("end", () => {
        const txt = Buffer.from(s.replace(/\s+/g, ""), "base64").toString("utf8");
        const j = JSON.parse(txt);
        if (!j.client_email || !j.private_key) process.exit(3);
        require("fs").writeFileSync(process.argv[1], txt, {mode: 0o600});
      });' "$sa" 2>/dev/null; then
    say "wrote $sa ($(wc -c <"$sa" | tr -d ' ') bytes, has client_email and private_key)"
  else
    bad "GOOGLE_PLAY_SA_JSON_B64 is not the base64 of a service-account JSON file"
  fi
fi

# --- 5. the other variables and GitHub -------------------------------------------------
for v in SENTRY_READ_TOKEN SENTRY_ORG SENTRY_PROJECT SENTRY_REGION_HOST POSTHOG_PERSONAL_API_TOKEN POSTHOG_PROJECT_ID POSTHOG_HOST; do
  [ -n "${!v:-}" ] || bad "$v is not set"
done
[ -n "${SENTRY_WRITE_TOKEN:-}" ] ||
  say "note: SENTRY_WRITE_TOKEN is not set — prod-close.mjs will close GitHub issues but not resolve Sentry issues"

if ! command -v gh >/dev/null 2>&1; then
  if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && command -v apt-get >/dev/null 2>&1; then
    sudo_cmd=""
    [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && sudo_cmd="sudo"
    say "gh is not installed — installing the Ubuntu package"
    if $sudo_cmd apt-get update -qq >/dev/null 2>&1 &&
      DEBIAN_FRONTEND=noninteractive $sudo_cmd apt-get install -y -qq gh >/dev/null 2>&1; then
      say "installed $(gh --version 2>/dev/null | head -1)"
    fi
  fi
fi

repo="${GH_REPO:-omar-zarka/qariah-v2}"
if ! command -v gh >/dev/null 2>&1; then
  bad "gh is not installed and apt-get could not install it — check that the environment's network list includes the default package managers"
elif full="$(gh api "repos/$repo" --jq .full_name 2>/dev/null)" && [ -n "$full" ]; then
  say "gh api reaches $full over REST"
else
  bad "gh api repos/$repo failed — check that the routine has this repository attached"
fi

# --- 6. live key probes -----------------------------------------------------------------
# One cheap read-only GET for each service, so a run says exactly which key fails. The first
# shadow run (2026-09-27) got Sentry "401 Invalid token" and Play "The caller does not have
# permission" deep inside the triage scripts. Each probe prints "probe <service>: OK" or
# "probe FAIL <service>: HTTP <code> <short reason>". It never prints a token. A failed probe
# does not stop the other probes and does not change the exit code: the run continues, and
# the report names the service that has no data. Skipped when a value it needs is missing
# (step 5 already printed a FAIL line for that).
# Node fetch (undici) tries only the IPv6 address on a hung IPv6 route, where curl works,
# so the probe runs with --dns-result-order=ipv4first (CLAUDE.md, 2026-08-15).
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
probe_out="$(SA_FILE="${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:-$sa}" LIB_DIR="$here/../lib" node --dns-result-order=ipv4first -e '
  const {readFileSync} = require("fs");
  const env = process.env;
  const short = s => String(s || "").replace(/\s+/g, " ").slice(0, 100);
  const reason = async r => {
    const t = await r.text().catch(() => "");
    try {
      const j = JSON.parse(t);
      return short(j.detail || (j.error && (j.error.message || j.error)) || j.message || t);
    } catch {
      return short(t);
    }
  };
  async function probe(name, needs, run) {
    if (needs.some(v => !env[v])) return console.log(`probe ${name}: skipped (${needs.filter(v => !env[v]).join(", ")} not set)`);
    try {
      const r = await run();
      if (r.ok) console.log(`probe ${name}: OK`);
      else console.log(`probe FAIL ${name}: HTTP ${r.status} ${await reason(r)}`);
    } catch (e) {
      console.log(`probe FAIL ${name}: no response (${short(e.cause ? e.cause.code || e.cause.message : e.message)})`);
    }
  }
  const t = () => AbortSignal.timeout(15000);
  (async () => {
    await probe("sentry", ["SENTRY_READ_TOKEN", "SENTRY_ORG", "SENTRY_REGION_HOST"], () =>
      fetch(`${env.SENTRY_REGION_HOST.replace(/\/+$/, "")}/api/0/organizations/${env.SENTRY_ORG}/`, {
        headers: {authorization: `Bearer ${env.SENTRY_READ_TOKEN}`}, signal: t()}));
    await probe("posthog", ["POSTHOG_PERSONAL_API_TOKEN", "POSTHOG_PROJECT_ID", "POSTHOG_HOST"], () =>
      fetch(`${env.POSTHOG_HOST.replace(/\/+$/, "")}/api/projects/${env.POSTHOG_PROJECT_ID}/feature_flags/?limit=1`, {
        headers: {authorization: `Bearer ${env.POSTHOG_PERSONAL_API_TOKEN}`}, signal: t()}));
    let sa = null;
    try { sa = JSON.parse(readFileSync(env.SA_FILE, "utf8")); } catch {}
    if (!sa) return console.log("probe play-reporting: skipped (no service-account file)");
    // The token comes from scripts/lib/google-play-auth.mjs and the package name from
    // config/branding.js (through scripts/lib/app-ids.mjs): the same sources the triage scripts use.
    const lib = f => import(require("url").pathToFileURL(require("path").join(env.LIB_DIR, f)).href);
    const {mintPlayToken} = await lib("google-play-auth.mjs");
    const {ANDROID_PACKAGE_NAME} = await lib("app-ids.mjs");
    await probe("play-reporting", [], async () => {
      let access_token;
      try {
        access_token = await mintPlayToken(sa, {scope: "reporting", ttlSeconds: 600, signal: t()});
      } catch (e) {
        // The token endpoint refused the key: report it like any other failed GET.
        if (e.name === "PlayAuthError") return {ok: false, status: e.status, text: async () => e.bodyText};
        throw e;
      }
      return fetch(`https://playdeveloperreporting.googleapis.com/v1beta1/apps/${ANDROID_PACKAGE_NAME}/crashRateMetricSet`, {
        headers: {authorization: `Bearer ${access_token}`}, signal: t()});
    });
  })();
' 2>&1)"
probe_fails=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  case "$line" in
    "probe FAIL "*) probe_fails=$((probe_fails + 1)) ;;
  esac
  say "$line"
done <<<"$probe_out"

if [ "$fail" -ne 0 ]; then
  say "STOP. Fix the FAIL lines in the cloud environment settings (docs/operations/cloud-triage.md)."
  exit 1
fi
if [ "$probe_fails" -gt 0 ]; then
  say "OK, but $probe_fails live probe(s) failed. Copy each 'probe FAIL' line into the report; those services give no data this run."
else
  say "OK"
fi
