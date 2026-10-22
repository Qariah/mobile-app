# Qariah v2 — Maestro flows

Functional flows for the 3-stage regression plan (`docs/operations/regression-test-plan.md`).
The **same** YAML runs on a local attached device and on BrowserStack App Automate.

## Run locally (attached device — Stage 1 boot gate)

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export PATH="$HOME/.maestro/bin:$HOME/Library/Android/sdk/platform-tools:$PATH"
# Serialize the single device (see "Device contention" below) — always for automated runs:
scripts/with-device-lock.sh --label="smoke" -- maestro test .maestro/flows/smoke/
scripts/with-device-lock.sh --label="smoke" -- maestro test .maestro/flows/smoke/00-launch.yaml
```

Install the build under test first if needed: `scripts/android-device-smoke.sh --apk=<release.apk>` (it self-locks — see below).

## Device contention (there is ONE Pixel)

`qariah-boot-gate-verify`, the daily `qariah-triage-loop` smoke, and any Maestro run all drive the same device. Two at once collide — the worst case is gotcha #7 (the Maestro gRPC instrumentation wedge). **Wrap every device command in the lock:**

```bash
scripts/with-device-lock.sh --label="what-this-is" -- <adb|maestro command>
```

`scripts/with-device-lock.sh` is a dependency-free cross-process mutex (atomic `mkdir` — macOS has no `flock`): exactly one holder at a time, auto-released on exit, a dead holder is reclaimed, and a blocked caller prints who holds it. It auto-detects the single serial and exports `ANDROID_SERIAL`. It's **re-entrant** (`QARIAH_DEVICE_LOCK_HELD`), so you can hold it for a whole session and still call scripts that self-lock — `scripts/android-device-smoke.sh` self-locks, so the triage loop is already covered. For a multi-command session, hold it once: `scripts/with-device-lock.sh --label="boot-gate" -- bash` then work in that subshell.

## Run on BrowserStack (Stage 1/2 — matrix)

```bash
export BROWSERSTACK_USERNAME=... BROWSERSTACK_ACCESS_KEY=...   # keep in .env.local
scripts/browserstack/run-maestro.sh --set=smoke               # or --set=regression
```

## Status (verified on Pixel 3 `8BNX1CU9Z`, 2026-06-30)

- **Smoke (Stage 1): 4/4 PASS.** `00-launch`, `01-tabs`, `02-browse-to-play` (#114 surah-list render), `03-mushaf-open`. Plain `launchApp` (models an onboarded returning user).
- **Regression (Stage 2): 6/6 PASS.** `search/search-results` (J1/J2), `search/browse-all` (C4), `collection/collection-grid` (I1), `settings/settings-subscreens` (K1/K2), `settings/theme` (K10), `mushaf/mushaf-open-reader` (E1). Each uses `launchApp: { clearState: true }` for a deterministic start (see gotcha #5). Run: `maestro test --include-tags=regression .maestro/`.
  - **WIP (tag `wip`, excluded from the green gate):** `search/system-playlist` (J4) — a curated-playlist tap navigates/plays rather than opening a titled detail; needs a `testID` + confirmed target.
  - **Backlog (coverage-matrix rows not yet written):** listen browse-rewaya/country (C2/C3 — a rewaya-card tap *starts playback*, needs a distinct target), player G-series (needs mini-player `testID`s), deep links A5/A6, multi-rewaya D2, verse-actions F-series, etc. Add per the "don't boil the ocean" rollout as each area is touched in a sprint (`qariah-post-sprint` Step 6.5).

## Selector gotchas (learned on the Pixel 3 — read before writing flows)

1. **Maestro text selectors are full-match regex, NOT substring.** `visible: "recitation"` does **not** match the node `"5 recitations"`; `visible: "Al-Fatihah"` does **not** match `"1. Al-Fatihah"`. Wildcard it: `".*recitation.*"`. Exact labels (tab names, `"Default Reciter"`, `"Browse by"`) match as-is.
2. **The S33 background-playback prompt can pop on launch** and steals the a11y focus (a native dialog → the underlying tab bar drops out of the query). Dismiss it conditionally first — see `subflows/skip-onboarding.yaml` / `00-launch.yaml` (`when: visible: "NOT NOW"`).
3. **Don't assert a specific surah** in the reciter-profile flow — the grid is shuffled and many reciters have partial catalogs (no Al-Fatihah). Assert structural signals: the `".*recitation.*"` header + a `".*JUZ.*"` divider (proves the surah list rendered, not the skeleton).
4. **Mushaf ayah text is Skia (canvas, no a11y nodes)** — but the surah-header chrome (e.g. `"Al-Fatihah"`) IS a real text node, so `03-mushaf-open` can assert it.
5. **Regression flows use `launchApp: { clearState: true }`; smoke uses plain `launchApp`.** Qariah's `restoreSession` reopens the last-viewed screen on launch — including the tab-less Mushaf reader. So a plain launch *after* a flow that ended deep can't find the tab bar → the next flow fails at its first tab tap. `clearState` gives every regression flow a deterministic Listen start. (Smoke deliberately keeps plain `launchApp` to model the real returning-user cold start.)
6. **Onboarding (shown after `clearState`) is THREE steps + a prompt, exact casing:** intro carousel `"Skip"` → final `"Get started"` → sign-in `"Skip for now"` → then the S33 `"NOT NOW"` prompt. `subflows/skip-onboarding.yaml` handles all four and is a no-op when already onboarded (the sequence is guarded on `"Skip"` being visible).
7. **Killing a Maestro run mid-flight wedges the host app** (stale `dev.mobile.maestro` gRPC instrumentation on port 50054 → the app hangs on the loading spinner, and later runs fail at 0s with `Command failed (tcp:50054): closed`). Recover with: `adb shell am force-stop dev.mobile.maestro && adb shell pm clear com.qariah.app` (then relaunch). Let runs finish rather than killing them.

## `testID` prerequisites (Phase-1 follow-up)

The flows fall back to text / point selectors today. Add stable `testID`s to make them deterministic + unlock the backlog flows:

- **reciter card** (browse grid) → replaces the `point: 50%,32%` tap in `02`.
- **surah row** → a precise #114 "rows rendered" assertion.
- **mini-player play/pause** → assert playback actually started; unlocks the player G-series (G1/G2/G3). Today the mini-player may already show a prior session's track, so it can't be asserted blindly.
- **rewaya card + country card** (Listen "Browse by" rows) → C2/C3. A rewaya-card tap *starts playback*, so a filtered-list vs play target must be disambiguated.
- **system-playlist card + its destination** → unblocks the `wip` J4 flow (tap currently lands on the Mushaf grid, no titled detail to assert).
</content>
