#!/usr/bin/env bash
# scripts/browserstack/run-maestro.sh
# Run the .maestro flow suite on a named device set via BrowserStack App Automate (Maestro).
# The same flows run locally with `maestro test .maestro/flows/...`.
#
# Usage:
#   scripts/browserstack/run-maestro.sh --set=smoke --platform=android
#   scripts/browserstack/run-maestro.sh --set=smoke --platform=ios --app=bs://<hash>
#   scripts/browserstack/run-maestro.sh --set=regression --platform=android   # uploads latest ~/qariah-releases APK
#
# --platform is REQUIRED. A BrowserStack Maestro build runs ONE app binary
# across the device list, so Android and iOS devices cannot share a build:
# an .apk dispatched to an iPhone errors out. (The original version of this
# script concatenated s.android + s.ios into one device array — it had never
# been executed. Found and fixed on first real use, 2026-08-02.)
#
# Env: BROWSERSTACK_USERNAME, BROWSERSTACK_ACCESS_KEY
# Endpoints per https://www.browserstack.com/docs/app-automate/maestro
#
# ⚠️ THIS REQUIRES AN **App Automate** SUBSCRIPTION. Qariah's is **App Live**, which is a
# different product: a human driving one streamed device, upload-only API, no way to run a
# flow. If the app upload here fails with HTTP 403
# BROWSERSTACK_TESTING_TIME_LIMIT_EXHAUSTED, that is the entitlement, NOT a bug in this
# script and NOT bad credentials (read-only App Automate endpoints still return 200, which
# makes it look like a config problem). Full write-up + the manual App Live fallback:
# docs/operations/regression-test-plan.md § "Stage 2".
set -euo pipefail

# Temporary files honour TMPDIR. macOS gives each user a private temp dir;
# a hardcoded /tmp is world-writable and is denied under the agent sandbox.
TMP_BASE="${TMPDIR:-/tmp}"; TMP_BASE="${TMP_BASE%/}"
cd "$(git rev-parse --show-toplevel)"

SET="smoke"; APP_URL=""; SWEEP_TAG=""; PLATFORM=""
for a in "$@"; do case "$a" in
  --set=*)      SET="${a#*=}" ;;
  --app=*)      APP_URL="${a#*=}" ;;
  --tag=*)      SWEEP_TAG="${a#*=}" ;;
  --platform=*) PLATFORM="${a#*=}" ;;
  *) echo "unknown arg: $a" >&2; exit 2 ;;
esac; done
case "$PLATFORM" in
  android|ios) ;;
  *) echo "❌ --platform=android|ios is required (one app binary per build)" >&2; exit 2 ;;
esac
if [ "$PLATFORM" = ios ] && [ -z "$APP_URL" ]; then
  echo "❌ --platform=ios needs an explicit --app=bs://<hash> (upload the .ipa with upload-app.sh)" >&2; exit 2
fi
: "${BROWSERSTACK_USERNAME:?set BROWSERSTACK_USERNAME}"
: "${BROWSERSTACK_ACCESS_KEY:?set BROWSERSTACK_ACCESS_KEY}"
AUTH=(-u "$BROWSERSTACK_USERNAME:$BROWSERSTACK_ACCESS_KEY")
BASE="https://api-cloud.browserstack.com/app-automate/maestro/v2"
[ -n "$SWEEP_TAG" ] || SWEEP_TAG="$( [ "$SET" = smoke ] && echo smoke || echo regression )"

# 0. App: upload the latest release if not provided.
if [ -z "$APP_URL" ]; then
  APK="$(ls -1t ~/qariah-releases/*.apk 2>/dev/null | head -1)"
  [ -n "$APK" ] || { echo "❌ no --app and no APK in ~/qariah-releases" >&2; exit 2; }
  APP_URL="$(scripts/browserstack/upload-app.sh "$APK")"
fi

# 1. Zip the flow suite (Maestro App Automate takes a zip of the .maestro flows).
ZIP="$TMP_BASE/qariah-maestro-${SET}.zip"; rm -f "$ZIP"
( cd .maestro && zip -qr "$ZIP" config.yaml subflows flows )
echo "▶ test-suite zip: $ZIP" >&2

# 2. Upload the test suite → testSuite url.
SUITE_URL="$(curl -fsSL "${AUTH[@]}" -X POST "${BASE}/test-suite" -F "file=@${ZIP}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).test_suite_url||""))')"
[ -n "$SUITE_URL" ] || { echo "❌ test-suite upload failed" >&2; exit 1; }

# 3. Devices for this set + platform (device-sets.json).
DEVICES="$(node -e '
  const s=require("./scripts/browserstack/device-sets.json")[process.argv[1]];
  console.log(JSON.stringify(s[process.argv[2]]||[]));' "$SET" "$PLATFORM")"
[ "$DEVICES" != "[]" ] || { echo "❌ no $PLATFORM devices in set '$SET'" >&2; exit 2; }
echo "▶ $SET/$PLATFORM devices: $DEVICES" >&2

# 4. Execute the build.
BUILD="$(curl -fsSL "${AUTH[@]}" -X POST "${BASE}/build" -H 'Content-Type: application/json' -d "{
  \"app\": \"${APP_URL}\",
  \"testSuite\": \"${SUITE_URL}\",
  \"devices\": ${DEVICES},
  \"includeTags\": [\"${SWEEP_TAG}\"],
  \"project\": \"qariah-regression\"
}")"
BUILD_ID="$(printf '%s' "$BUILD" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).build_id||JSON.parse(s).buildId||""))')"
[ -n "$BUILD_ID" ] || { echo "❌ build start failed: $BUILD" >&2; exit 1; }
echo "▶ build $BUILD_ID — https://app-automate.browserstack.com/builds/$BUILD_ID" >&2

# 5. Poll until done, then verify the run actually executed something.
#    A tag filter that matches no flow yields a vacuous "passed" with zero
#    sessions — that must not read as a green gate.
while :; do
  RESP="$(curl -fsSL "${AUTH[@]}" "${BASE}/builds/${BUILD_ID}")"
  ST="$(printf '%s' "$RESP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).status||""))')"
  echo "  status: $ST" >&2
  case "$ST" in
    passed|failed|error) break ;;
  esac
  sleep 20
done

printf '%s' "$RESP" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const b=JSON.parse(s);
  const devs=b.devices||b.sessions||[];
  let total=0, failed=0;
  for (const d of devs) {
    const name=`${d.device||d.name||"?"}-${d.os_version||""}`;
    const st=d.status||d.sessionStatus||"?";
    const n=(d.testcases?.count ?? d.total_testcases ?? d.testcases?.length ?? null);
    if (n!=null) total+=n;
    if (String(st).toLowerCase()!=="passed") failed++;
    console.log(`   ${st==="passed"?"✓":"✗"} ${name}  status=${st}${n!=null?`  tests=${n}`:""}`);
  }
  console.log(`   devices=${devs.length} failedDevices=${failed} totalTestcases=${total}`);
  if (devs.length===0) { console.log("VERDICT=EMPTY"); process.exit(0); }
  if (total===0)       { console.log("VERDICT=NO_TESTS"); process.exit(0); }
  console.log(failed===0 ? "VERDICT=PASS" : "VERDICT=FAIL");
});' > "$TMP_BASE/qariah-bs-verdict-$$.txt" 2>&1 || true
cat "$TMP_BASE/qariah-bs-verdict-$$.txt" >&2
VERDICT="$(grep -o 'VERDICT=[A-Z_]*' "$TMP_BASE/qariah-bs-verdict-$$.txt" | tail -1 | cut -d= -f2)"
rm -f "$TMP_BASE/qariah-bs-verdict-$$.txt"

case "$ST:$VERDICT" in
  passed:PASS) echo "✅ $SET/$PLATFORM PASS — https://app-automate.browserstack.com/builds/$BUILD_ID"; exit 0 ;;
  *:EMPTY|*:NO_TESTS)
    echo "❌ $SET/$PLATFORM ran ZERO test cases (tag '$SWEEP_TAG' matched nothing?) — NOT a pass." >&2
    echo "   https://app-automate.browserstack.com/builds/$BUILD_ID" >&2; exit 1 ;;
  *) echo "❌ $SET/$PLATFORM FAIL (build status=$ST) — https://app-automate.browserstack.com/builds/$BUILD_ID" >&2; exit 1 ;;
esac
