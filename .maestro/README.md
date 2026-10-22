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

### iOS simulator

```bash
maestro --device <sim-udid> test .maestro/flows/smoke/
```

Expected: **4/4 on Android and on iOS 18.** On iOS 26, `01-tabs` fails at "Collection": record it
as KNOWN #219 (rule R6 in `docs/operations/regression-test-plan.md`) and run QP-03 by its steps.
No smoke flow is platform-only today. The Android-only
flow `04-mini-player-close` was deleted with the mini-player ✕ (TECH_DEBT #227, Sprint 45).
If a flow must run on one platform only, tag it (for example `android-only`) and pass
`--exclude-tags=<tag>` on the other platform. `platform:` in the flow config is not honoured by
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

## Status (last full run: Sprint 48 Tier 2, 2026-10-20)

The last run used build 3.2.2 (3356) at `86cb24f8`: a release APK on the emulator `qariah_pixel_7`
(API 34), and a Release simulator build on the iPhone 16 Pro (iOS 18.2). Smoke 4/4 and regression 9/9
on both platforms (Android: `player/playlist-session-restore` passed on a rerun; the first try was a
slow-emulator fault). The run before it (Sprint 46 Tier 2, build 2877 at `7d5b5ec6`) used the
iPhone 17 Pro (iOS 26.5); the iOS 26.5 results below are from that run.
The first full run was on the Pixel 3 `8BNX1CU9Z` on 2026-06-30 (smoke 4/4, regression 6/6).

- **Smoke (Stage 1): Android 4/4 PASS. iOS 26.5: 3/4.** `01-tabs` fails at "Collection" on iOS 26: KNOWN #219 (rule R6); QP-03 passed by its steps. The flows are `00-launch`, `01-tabs`, `02-browse-to-play` (#114 surah-list render) and `03-mushaf-open`. Each uses `launchApp: { clearState: true }` since 2026-08-02 (see `00-launch.yaml`), so the smoke suite starts from onboarding every time. `04-mini-player-close` was deleted in Sprint 45 together with the mini-player ✕ (TECH_DEBT #227; upstream keeps the mini player non-dismissable by design). The `04` slot is left vacant rather than renumbering.
- **Regression (Stage 2): 9/9 PASS on Android and on iOS 26.5.** Each flow uses `launchApp: { clearState: true }` for a deterministic start (see gotcha #5). Run: `maestro test --include-tags=regression .maestro/`. The ids are case ids of the case catalog in `docs/operations/regression-test-plan.md`. The header comment of each flow names its case id and its old matrix id (J1, C4, E2 …).
  - `settings/theme` (SET-02), `collection/collection-grid` (FLG-01), `search/search-results` (SRC-01), `search/browse-all` (LST-04).
  - `settings/settings-subscreens` (SET-01). Platform-safe since Sprint 46 (TECH_DEBT #259): wildcard row selectors, and a tap on the Settings header "Back" control instead of the Android-only `back` command.
  - `mushaf/mushaf-open-reader` (MSH-01) and `mushaf/mushaf-session-restore` (UPG-04 step 4). Since Sprint 46 both open Mushaf Settings by `id: mushaf-settings-button`, so they pass on iOS too. The old text selector failed on iOS.
  - `player/queue-remove` (PLY-06, TECH_DEBT #258, new in Sprint 46). It plays one surah from a one-item playlist, opens the queue, checks that the ✕ `queue-remove-0` shows, and taps it (the only-track path, #237). The full player and the mini player then close. **Android only for the queue steps:** on iOS the full player sheet is one a11y element, so the flow runs only its setup there; check the queue ✕ on iOS by hand (PLY-06).
  - `player/playlist-session-restore` (UPG-04, TECH_DEBT #271, 2026-10-18). It plays a surah from a playlist, kills the app, relaunches it and taps Play; on Android it waits for the full-player time to pass 0:35 (a 0:15 check passed on the defective build when the pause came late). It fails on the stock 2579 build and passes with the fix on the `qariah_pixel_7` emulator. On iOS it runs the path but cannot read the time (the full player sheet is one a11y element), and it taps the first Browse All cell by point because iOS merges that grid into one element.
  - **New in Sprint 48 (post-sprint Step 6.5, 2026-10-20, build 3.2.2 (3356)):** `listen/newly-added` (LST-06) and `settings/notifications` (NTF-01). The Sprint 48 Tier 2 run (smoke 4/4 and regression 9/9 on the emulator and on the iPhone 16 Pro simulator, iOS 18.2) came before them. Both new flows PASS on the emulator `qariah_pixel_7` (API 34, release APK) and on the iPhone 16 Pro simulator (iOS 18.2, Release build), all from `86cb24f8`. The Android `listen/newly-added` run passed after an emulator reboot (see "Slow emulator" below).
    - `listen/newly-added` reads the accessibility label of the first Newly Added card with `subflows/recitation-card-label.js` (English: `Play <surah>, <range>, by <reciter>`), taps the card, and checks that the mini player names that surah and reciter. Android only: the full player opens and shows the range of the card. On iOS the full player sheet is one a11y element. The flow does not check where the ayah list starts: the list follows the audio.
    - `settings/notifications` opens Settings → Notifications, checks the 5 switches (`notification-switch-<type>`), turns the Al-Kahf switch OFF, force-quits (`stopApp`, then `launchApp` without clearState), and checks that it stays OFF. A holdout arm hides the row: then the flow logs `NTF-01 SKIPPED` and ends green. `clearState` removes the arm, so about 15% of runs enroll in the holdout; run the flow again. The `checked` selector works on both platforms (checked on the iOS 18.2 simulator on 2026-10-20).
  - **Slow emulator (2026-10-20).** The `qariah_pixel_7` AVD has 2 GB of guest RAM. Under load, a clearState launch took 39 s to show the first screen (60 s once, with an app ANR dialog), so `subflows/skip-onboarding.yaml` now waits 60 s. While audio plays, the player screen never settles, so a tap that starts audio sets `waitToSettleTimeoutMs: 1000`; without it, one tap waited more than 10 min and the Maestro driver timed out on screenshots. When the emulator is slow (load average above 10 in `adb shell uptime`, or a "System UI isn't responding" dialog), reboot it (`adb reboot`) and wait until the load is below 3 before a run.
  - **WIP (tag `wip`, excluded from the green gate):** `search/system-playlist` (SRC-03) — a curated-playlist tap navigates/plays rather than opening a titled detail; needs a `testID` + confirmed target.
  - **Backlog (catalog cases with no flow yet):** Browse by Rewaya/Country (LST-03 — a rewaya-card tap *starts playback*, needs a distinct target), the other player cases (PLY-), deep links (LNK-02, MSH-07 step 3), the widgets (WID-01, WID-03), multi-rewaya (RCP-02), verse actions (VRS-), etc. An `agent` case with "—" in its Maestro column is a flow to write. Add per the "don't boil the ocean" rollout as each area is touched in a sprint (`qariah-post-sprint` Step 6.5).

## Selector gotchas (learned on the Pixel 3 — read before writing flows)

1. **Maestro text selectors are full-match regex, NOT substring.** `visible: "surahs"` does **not** match the node `"45 surahs · 1 rewayah"`; `visible: "Al-Fatihah"` does **not** match `"1. Al-Fatihah"`. Wildcard it: `".*[0-9]+ surahs? · [0-9]+ rewaya.*"`. Exact labels (tab names, `"Default Reciter"`, `"Browse by"`) match as-is.
2. **The S33 background-playback prompt can pop on launch** and steals the a11y focus (a native dialog → the underlying tab bar drops out of the query). Dismiss it conditionally first — see `subflows/skip-onboarding.yaml` / `00-launch.yaml` (`when: visible: "NOT NOW"`).
3. **Don't assert a specific surah** in the reciter-profile flow — the grid is shuffled and many reciters have partial catalogs (no Al-Fatihah). Assert structural signals: the `".*[0-9]+ surahs? · [0-9]+ rewaya.*"` meta row (TECH_DEBT #306) + a `".*JUZ.*"` divider (proves the surah list rendered, not the skeleton).
4. **Mushaf ayah text is Skia (canvas, no a11y nodes)** — but the surah-header chrome (e.g. `"Al-Fatihah"`) IS a real text node, so `03-mushaf-open` can assert it.
5. **Every flow — smoke AND regression — uses `launchApp: { clearState: true }`.** Qariah's `restoreSession` reopens the last-viewed screen on launch — including the tab-less Mushaf reader. So a plain launch *after* a flow that ended deep can't find the tab bar → the next flow fails at its first tab tap. `clearState` gives every flow a deterministic onboarding → Listen start. (Smoke used plain `launchApp` until 2026-08-02 to model a returning user; the restore-into-Mushaf failure mode made that unreliable, so it was changed — `00-launch.yaml` carries the dated comment.)
6. **First-run surfaces (shown after `clearState`) arrive in NO fixed order — never write them as a sequence.** Welcome `"Get started"`, sign-in `"Skip( sign-in)? for now"`, the root-mounted What's New card `"Skip"` (opens 800 ms after an async version check, so it lands over the welcome screen OR over the sign-in screen), the Android 13+ `"Allow"` notification dialog (seen ~10 s after launch, over the splash), and the S33 `"NOT NOW"` prompt. A chain of one-shot `when:` guards (they check once, never wait) failed 4/4 on iOS 18 and 3/5 on a fresh API-34 emulator on 2026-09-20. `subflows/skip-onboarding.yaml` is therefore a bounded `repeat … while: notVisible: "Mushaf"` loop: each pass waits for any known surface, dismisses overlays first, then advances the screen that is showing. It is a no-op when already onboarded. Note that the card's last-page `"Get Started"` also matches `"Get started"` (Maestro regex is case-insensitive), so dismiss the card before you look for the welcome button.
7. **Killing a Maestro run mid-flight wedges the host app** (stale `dev.mobile.maestro` gRPC instrumentation on port 50054 → the app hangs on the loading spinner, and later runs fail at 0s with `Command failed (tcp:50054): closed`). Recover with: `adb shell am force-stop dev.mobile.maestro && adb shell pm clear com.qariah.app` (then relaunch). Let runs finish rather than killing them.
8. **iOS exposes labels differently from Android — write selectors that match both** (found 2026-09-07 on the first auto-sprint gate; the suite had only ever run on Android). iOS uses the accessibilityLabel when one is set (`"Skip sign-in for now"` vs visible `"Skip for now"`), prefixes the selected NativeTabs tab (`", Listen"`), and joins compound rows into one label (`"1, , Al-Fatihah, The Opener"`, `"Default Reciter, Choose your preferred reciter, "`). Maestro text is a full-match regex, so wildcard: `"Skip( sign-in)? for now"`, `".*Listen"`, `".*Al-Fatihah.*"`, `"Default Reciter.*"`. Verified 4/4 on the iPhone 16 Pro simulator and 4/4 on the `qariah-anr` emulator with the same files. When a label differs too much between the platforms, use a `testID` (`id:`) instead, as the Mushaf flows do since Sprint 46.

## `testID` prerequisites (Phase-1 follow-up)

The flows fall back to text / point selectors today. Add stable `testID`s to make them deterministic + unlock the backlog flows:

- **reciter card** (browse grid) → replaces the `point: 50%,32%` tap in `02`.
- **surah row** → a precise #114 "rows rendered" assertion.
- **mini-player play/pause** → ~~assert playback actually started~~ **testIDs added in source 2026-09-10 (#401)**, together with the rest of the bar: `mini-player-bar`, `mini-player-expand`, `mini-player-play-pause` on both `MiniPlayer` (iOS 26+) and `FloatingPlayer` (Android, iOS < 26). The bar is also demoted from a grouping `Pressable` to a plain `View`, so iOS no longer composes its controls into one label. `player/playlist-session-restore` and `player/queue-remove` use these `id` selectors, and both pass on Android and iOS 26.5 (Sprint 46). (The ✕ and its `mini-player-close` testID were removed in Sprint 45, TECH_DEBT #227.) Unlocks the player G-series (G1/G2/G3); the mini-player may still show a prior session's track, so assert the control, not blind playback.
- **Done in Sprint 46:** `mushaf-settings-button` (the Mushaf reader's settings control; both Mushaf flows), `player-queue-button` (the full player's queue control) and `queue-remove-<index>` (the ✕ of each queue row; `player/queue-remove`).
- **rewaya card + country card** (Listen "Browse by" rows) → C2/C3. A rewaya-card tap *starts playback*, so a filtered-list vs play target must be disambiguated.
- **system-playlist card + its destination** → unblocks the `wip` J4 flow (tap currently lands on the Mushaf grid, no titled detail to assert).
- **Done in Sprint 48:** `newly-added-recitations-row`, `recitation-card` (each Newly Added card), `notification-switch-<type>` (the 5 switches of Settings → Notifications), `notifications-permission-banner` and `notifications-permission-button`.
- **Settings index rows** (Sprint 48 follow-up) → `settings/notifications` finds the Notifications row by its English description (`.*Choose the notifications you get.*`), because the rows of the upstream `app/(tabs)/(d.settings)/index.tsx` have no `testID`. A `testID` on the Qariah row (`components/settings/notificationsSettingsItem.ts` → for example `settings-row-notifications`) would make the flow work in Arabic too.
- **recitation card content** (Sprint 48 follow-up) → `listen/newly-added` parses the English accessibility label of the card to learn the surah and the reciter (`subflows/recitation-card-label.js`). A `testID` on the card's surah and reciter texts (or the recitation key in the card `testID`) would remove the English parse and let the flow run in Arabic.
