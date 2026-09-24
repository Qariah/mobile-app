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

### iOS simulator — exclude the `android-only` tag

`04-mini-player-close` is Android-only: iOS merges the mini-player bar into one composed a11y
label, so the ✕ cannot be tapped individually and a loosened selector passes for the WRONG
reason (it expands the player sheet instead of closing it). See #401. Run the iOS gate as:

```bash
maestro --device <sim-udid> test --exclude-tags=android-only .maestro/flows/smoke/
```

Expected: **5/5 on Android, 4/4 on iOS.** `platform:` in the flow config is not honoured by
Maestro 2.10.0 — the tag is the mechanism.

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

- **Smoke (Stage 1): 4/4 PASS.** `00-launch`, `01-tabs`, `02-browse-to-play` (#114 surah-list render), `03-mushaf-open`. Each uses `launchApp: { clearState: true }` since 2026-08-02 (see `00-launch.yaml`), so the smoke suite starts from onboarding every time.
- **Regression (Stage 2): 6/6 PASS.** `search/search-results` (J1/J2), `search/browse-all` (C4), `collection/collection-grid` (I1), `settings/settings-subscreens` (K1/K2), `settings/theme` (K10), `mushaf/mushaf-open-reader` (E1). Each uses `launchApp: { clearState: true }` for a deterministic start (see gotcha #5). Run: `maestro test --include-tags=regression .maestro/`.
  - **WIP (tag `wip`, excluded from the green gate):** `search/system-playlist` (J4) — a curated-playlist tap navigates/plays rather than opening a titled detail; needs a `testID` + confirmed target.
  - **Backlog (coverage-matrix rows not yet written):** listen browse-rewaya/country (C2/C3 — a rewaya-card tap *starts playback*, needs a distinct target), player G-series (needs mini-player `testID`s), deep links A5/A6, multi-rewaya D2, verse-actions F-series, etc. Add per the "don't boil the ocean" rollout as each area is touched in a sprint (`qariah-post-sprint` Step 6.5).

## Selector gotchas (learned on the Pixel 3 — read before writing flows)

1. **Maestro text selectors are full-match regex, NOT substring.** `visible: "recitation"` does **not** match the node `"5 recitations"`; `visible: "Al-Fatihah"` does **not** match `"1. Al-Fatihah"`. Wildcard it: `".*recitation.*"`. Exact labels (tab names, `"Default Reciter"`, `"Browse by"`) match as-is.
2. **The S33 background-playback prompt can pop on launch** and steals the a11y focus (a native dialog → the underlying tab bar drops out of the query). Dismiss it conditionally first — see `subflows/skip-onboarding.yaml` / `00-launch.yaml` (`when: visible: "NOT NOW"`).
3. **Don't assert a specific surah** in the reciter-profile flow — the grid is shuffled and many reciters have partial catalogs (no Al-Fatihah). Assert structural signals: the `".*recitation.*"` header + a `".*JUZ.*"` divider (proves the surah list rendered, not the skeleton).
4. **Mushaf ayah text is Skia (canvas, no a11y nodes)** — but the surah-header chrome (e.g. `"Al-Fatihah"`) IS a real text node, so `03-mushaf-open` can assert it.
5. **Every flow — smoke AND regression — uses `launchApp: { clearState: true }`.** Qariah's `restoreSession` reopens the last-viewed screen on launch — including the tab-less Mushaf reader. So a plain launch *after* a flow that ended deep can't find the tab bar → the next flow fails at its first tab tap. `clearState` gives every flow a deterministic onboarding → Listen start. (Smoke used plain `launchApp` until 2026-08-02 to model a returning user; the restore-into-Mushaf failure mode made that unreliable, so it was changed — `00-launch.yaml` carries the dated comment.)
6. **First-run surfaces (shown after `clearState`) arrive in NO fixed order — never write them as a sequence.** Welcome `"Get started"`, sign-in `"Skip( sign-in)? for now"`, the root-mounted What's New card `"Skip"` (opens 800 ms after an async version check, so it lands over the welcome screen OR over the sign-in screen), the Android 13+ `"Allow"` notification dialog (seen ~10 s after launch, over the splash), and the S33 `"NOT NOW"` prompt. A chain of one-shot `when:` guards (they check once, never wait) failed 4/4 on iOS 18 and 3/5 on a fresh API-34 emulator on 2026-09-20. `subflows/skip-onboarding.yaml` is therefore a bounded `repeat … while: notVisible: "Mushaf"` loop: each pass waits for any known surface, dismisses overlays first, then advances the screen that is showing. It is a no-op when already onboarded. Note that the card's last-page `"Get Started"` also matches `"Get started"` (Maestro regex is case-insensitive), so dismiss the card before you look for the welcome button.
7. **Killing a Maestro run mid-flight wedges the host app** (stale `dev.mobile.maestro` gRPC instrumentation on port 50054 → the app hangs on the loading spinner, and later runs fail at 0s with `Command failed (tcp:50054): closed`). Recover with: `adb shell am force-stop dev.mobile.maestro && adb shell pm clear com.qariah.app` (then relaunch). Let runs finish rather than killing them.

## `testID` prerequisites (Phase-1 follow-up)

The flows fall back to text / point selectors today. Add stable `testID`s to make them deterministic + unlock the backlog flows:

- **reciter card** (browse grid) → replaces the `point: 50%,32%` tap in `02`.
- **surah row** → a precise #114 "rows rendered" assertion.
- **mini-player play/pause** → ~~assert playback actually started~~ **testIDs added in source 2026-09-10 (#401), not yet in any build**, together with the rest of the bar: `mini-player-bar`, `mini-player-expand`, `mini-player-play-pause`, `mini-player-close` on both `MiniPlayer` (iOS 26+) and `FloatingPlayer` (Android, iOS < 26). The bar is also demoted from a grouping `Pressable` to a plain `View`, so iOS no longer composes its controls into one label. **Not yet exercised by any run** — `04-mini-player-close` still selects by text and stays `android-only` until an iOS run proves the new `id` selectors (see that flow's header). Unlocks the player G-series (G1/G2/G3); the mini-player may still show a prior session's track, so assert the control, not blind playback.
- **rewaya card + country card** (Listen "Browse by" rows) → C2/C3. A rewaya-card tap *starts playback*, so a filtered-list vs play target must be disambiguated.
- **system-playlist card + its destination** → unblocks the `wip` J4 flow (tap currently lands on the Mushaf grid, no titled detail to assert).
</content>
8. **iOS exposes labels differently from Android — write selectors that match both** (found 2026-09-07 on the first auto-sprint gate; the suite had only ever run on Android). iOS uses the accessibilityLabel when one is set (`"Skip sign-in for now"` vs visible `"Skip for now"`), prefixes the selected NativeTabs tab (`", Listen"`), and joins compound rows into one label (`"1, , Al-Fatihah, The Opener"`, `"Default Reciter, Choose your preferred reciter, "`). Maestro text is a full-match regex, so wildcard: `"Skip( sign-in)? for now"`, `".*Listen"`, `".*Al-Fatihah.*"`, `"Default Reciter.*"`. Verified 4/4 on the iPhone 16 Pro simulator and 4/4 on the `qariah-anr` emulator with the same files.
