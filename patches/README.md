# Native tab direction

Expo SDK 57+ / React Native Screens 4.26+ support native tab direction. Bayaan
passes `unstable_nativeProps={{direction: appDirection}}` to `NativeTabs`,
placing Home on the right and the separate Search button on the left in Arabic
while keeping the normal platform design. No Screens patch is required.

The Yoga wrapper remains LTR to preserve the native mini-player accessory's
coordinates; screen and player contents apply the selected app direction.
Language changes persist the native direction. Android relaunches the app
process to apply it; iOS applies it the next time the app is opened. The app
is never reloaded in process (see i18n/language.ts).

When upgrading Router or Screens, verify Arabic and English tab order, Search
placement, tab switching, and regular/minimized mini-player accessories.

# expo-audio lock screen next/previous

`expo-audio+58.0.10.patch` adds opt-in next/previous track commands for a
single `AudioPlayer` to the lock screen (iOS `MPRemoteCommandCenter`, Android
media session `SEEK_TO_NEXT` / `SEEK_TO_PREVIOUS`). Upstream SDK 58 only offers
these for `AudioPlaylist`; the patch plugs into the same `supportsNextTrack` /
`nextTrack()` hooks. A player opts in per activation with
`setActiveForLockScreen(..., {trackControls: {previous, next}})`, updates them
with `setLockScreenTrackControls`, and receives `lockScreenTrackCommand`
events. Players that do not opt in behave as upstream. Adhkar playback is the
only user (`services/audio/LockScreenService.ts`).

On iOS the patch also stops upstream from claiming `nextTrackCommand` /
`previousTrackCommand` for players that did not ask for them. Upstream 58
registers failing targets and disables both commands on every activation,
which would take next/previous away from the CarPlay Now Playing screen
(`modules/bayaan-car/ios/CarNowPlaying.swift`).

Expo ships expo-audio prebuilt (an xcframework on iOS, an AAR in
`local-maven-repo` on Android), which would ignore the patch, so
`package.json` sets `expo.autolinking.buildFromSource: ["expo-audio"]`.
When upgrading expo-audio, regenerate the patch against the new version and
keep that setting.

# react-native-draggable-flatlist drag state

`react-native-draggable-flatlist+4.0.3.patch` fixes three ways a drag left
stale state behind in the iPad queue (`components/player/v2/tablet/QueuePane.tsx`,
the only user):

- A row dropped where it started changes no data, so upstream never reset
  the drag. The next drag of that row started from the old scroll offset and
  landed rows away from the finger. The patch resets after a drop in place.
- A plain scroll of the list wrote its distance into the drag offset. The patch
  only tracks the pan while a row is lifted.
- When the scroll view took a touch from a lifted row, the pan ended without
  `onEnd` or a touch up, so the row stayed lifted and the next swipe dragged
  it. The patch ends the touch on cancel and finalize, which drops the row
  in place.

Metro reads the package's `src` (its `react-native` field), so only `src` is
patched. When upgrading the library, check whether these are fixed upstream
before regenerating the patch.

# Qariah patches after Pass D (2026-11-07)

Pass D moved to Expo SDK 58. These Qariah patches are now part of the
upstream packages, so Pass D removed them. Their tests in
`patches/__tests__/` stay: each one fails if an upgrade or a downgrade loses
the fix.

- `react-native-screens+4.29.0.patch` (QP-08, TECH_DEBT #349). The fix is in
  react-native-screens 4.30.0 (software-mansion/react-native-screens#4862).
  The app has 4.30.1. Test: `react-native-screens-tab-selection.test.ts`.
- The Qariah hunks of `expo-audio+57.0.5.patch`: the remote command targets
  (TECH_DEBT #371, expo/expo#46020, expo-audio 58) and the live offset off
  the time-observer tick (issue #763, expo/expo#50724, expo-audio 58.0.7).
  The app has expo-audio 58.0.10 with the upstream patch above. Tests:
  `expo-audio-remote-command-targets.test.ts`, `expo-audio-live-offset.test.ts`.
- `react-native-worklets+0.10.1.patch` (TECH_DEBT #397). The fix is in
  react-native-worklets 0.13.0. Test:
  `react-native-worklets-background-pause.test.ts`.
- `@shopify+react-native-skia+2.6.2.patch` (issue #777, merged on
  `qariah-main` on 2026-11-08 after Pass D). The fix is in Skia 2.14.0, which
  Expo SDK 58 brings, so the base merge into Sprint 52 removed the patch.
  Test: `skia-memory-pressure.test.ts`.

# FlashList initial scroll offset (TECH_DEBT #376)

`@shopify+flash-list+2.3.2.patch` changes one method,
`RecyclerViewManager.applyInitialScrollAdjustment`, in `dist/` (the file that
Metro bundles) and in `src/`.

The defect: the Mushaf reader in List + Vertical, with Community Reflections
on, reopened on page 25 after a restore from page 50 (Android, Pixel 3). The
list mounts with `initialScrollIndex`. Until the rows are measured, FlashList
estimates them, and in each progressive render it moves the rows above the
target. FlashList 2.0.2 read the target offset before that move. FlashList
2.3.0 fixes that read (Shopify/flash-list#2133). It still recomputes only the
rows up to the target, so the rows after the target keep their old places,
and the search for the visible rows can return rows far from the target.

The patch recomputes all the rows, not only the rows up to the target.

`patches/__tests__/flash-list-initial-scroll-offset.test.ts` drives the
installed `RecyclerViewManager` without React and fails when the patch is not
there. FlashList 2.3 ships ES modules, so the Jest config in `package.json`
(`transformIgnorePatterns`) transforms `@shopify/flash-list`. When FlashList
changes this method again, run the test without the patch first: remove the
patch if the test passes.

# react-native-mmkv App Group fallback (#69, QARIAHV2-P)

`react-native-mmkv+4.3.2.patch` changes one method,
`HybridMMKVPlatformContext.getAppGroupDirectory()`. When the App Group
container is not available at an early start, the method returns nil (the
default MMKV folder) instead of a throw that crashed the boot. Pass D ported
the patch from 4.2.0 to 4.3.2 (the version that Android Gradle Plugin 9
needs). `package.json` pins the exact version, so the patch applies.

# expo-share-intent prebuild duplicates (TECH_DEBT #291, #292)

`expo-share-intent+9.0.0.patch` changes the config plugin only. A prebuild
with `--no-clean` adds each Android share filter once and the iOS App Group
once. Pass D ported the patch from 8.0.1 to 9.0.0 with no change.
