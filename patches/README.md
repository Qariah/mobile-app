# Native tab direction

Expo SDK 57 / React Native Screens 4.26 support native tab direction. Bayaan
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

`expo-audio+57.0.5.patch` adds opt-in next/previous track commands to the lock
screen (iOS `MPRemoteCommandCenter`, Android media session `SEEK_TO_NEXT` /
`SEEK_TO_PREVIOUS`). A player opts in per activation with
`setActiveForLockScreen(..., {trackControls: {previous, next}})`, updates them
with `setLockScreenTrackControls`, and receives `lockScreenTrackCommand`
events. Players that do not opt in behave as upstream. Adhkar playback is the
only user (`services/audio/LockScreenService.ts`).

Expo ships expo-audio prebuilt (an xcframework on iOS, an AAR in
`local-maven-repo` on Android), which would ignore the patch, so
`package.json` sets `expo.autolinking.buildFromSource: ["expo-audio"]`.
When upgrading expo-audio, regenerate the patch against the new version and
keep that setting.

# react-native-screens tab selection (QP-08)

`react-native-screens+4.29.0.patch` is the iOS part of
software-mansion/react-native-screens#4862, which is in 4.30.0. The patched
`ios/tabs/host/RNSTabBarController.mm` is byte-identical to the upstream
result.

The defect is on iOS 26.1 and later. A Fabric mount transaction between
`shouldSelectTab:` and `didSelectTab:` cleared the flag that marks a user
selection. Then `didSelectTab:` sent no `onTabSelected`, and JS kept the
previous tab as focused. expo-router gives each tab that JS does not think is
focused `pointerEvents: 'none'`, so the visible tab took no touches.

In the app, a change of the mini player (the tab-bar bottom accessory) causes
that mount transaction. "Clear cache" empties the queue, so the accessory goes
away and the safe area of each hidden tab changes. When the user selects such
a tab, the iOS 26 `SafeAreaView` around its stack screen sends the new insets
with an immediate state update. On the test iPhone (iOS 27), the Listen tab
then ignored every tap until two more tab changes.

`patches/__tests__/react-native-screens-tab-selection.test.ts` reads the
installed source and fails when the fix is not there. The RNScreens pod builds
from `node_modules`, so a rebuild compiles the patch. Remove the patch when
react-native-screens is 4.30.0 or later. The test then still passes.

# FlashList initial scroll offset (TECH_DEBT #376)

`@shopify+flash-list+2.0.2.patch` changes one method,
`RecyclerViewManager.applyInitialScrollAdjustment`, in `dist/` (the file that
Metro bundles) and in `src/`.

The defect: the Mushaf reader in List + Vertical, with Community Reflections
on, reopened on page 25 after a restore from page 50 (Android, Pixel 3). The
list mounts with `initialScrollIndex`. Until the rows are measured, FlashList
estimates them, and in each progressive render it moves the rows above the
target. FlashList 2.0.2 read the target offset before that move, so its
internal scroll offset kept the value of the previous render (162982 against
a real 120506). Its `maintainVisibleContentPosition` then took a reference row
from that wrong offset and scrolled by -50408 when the row went to its real
place. The rows after the target also kept their old positions, so the
search for the visible rows could return rows far from the target.

The patch:

1. Recomputes all the rows, not only the rows up to the target.
2. Reads the target offset after the recompute. This is the fix of
   Shopify/flash-list#2133 (FlashList 2.3.0).

`patches/__tests__/flash-list-initial-scroll-offset.test.ts` drives the
installed `RecyclerViewManager` without React and fails when the patch is not
there. When FlashList moves to 2.3.0 or later, regenerate the patch with item
1 only, or remove it if the test passes without it.

# expo-audio remote command targets (Qariah, TECH_DEBT #371)

Qariah adds one more hunk to the `ios/MediaController.swift` section of
`expo-audio+57.0.5.patch`. In expo-audio 57.0.5, `enableRemoteCommands()`
adds block targets to the play, pause, seek and skip commands, and
`disableRemoteCommands()` calls `removeTarget(self)`, which does not remove a
block target. After Settings → Storage → "Clear cache" cleared the lock screen
entry, iOS kept an empty "Qariah" card in Control Center. Each activation also
added one more set of handlers.

The hunk keeps each target by token, removes the earlier set before it adds a
new one, and removes all of them in `disableRemoteCommands()`. expo-audio 58
does the same (expo/expo#46020). Remove the hunk when expo-audio is 58 or
later. `patches/__tests__/expo-audio-remote-command-targets.test.ts` reads the
installed source and fails when the fix is not there; it still passes for 58.
When a Bayaan sync changes `expo-audio+57.0.5.patch`, keep this hunk.

# expo-audio live offset off the time-observer tick (Qariah, issue #763)

Qariah adds two hunks to the `ios/AudioPlayer.swift` section of
`expo-audio+57.0.5.patch`. They backport expo/expo#50724, which is in
expo-audio 58.0.7.

The defect is on iOS: the hang QARIAHV2-7B ("App Hanging for at least 3000
ms") of production 3.2.3 (3772). On each tick of the periodic time observer,
expo-audio sends a status, and the status reads `currentOffsetFromLive`. That
getter calls `AVPlayerItem.currentDate()` on the main thread. The call is a
synchronous call to the media server, and it blocks until the item has
loaded. So while a new recitation loads, the main thread waits on the
network. expo-audio 55 (production 1718) did not have the getter; expo-audio
56 added it.

The first hunk reads `currentDate()` only for a ready, live item (an
indefinite duration). Qariah plays files, not live streams, so the app does
not read it now, and no JS code reads `currentOffsetFromLive`. The second hunk
gives the status of a time-observer tick the tick's time, so the status does
not read `currentTime()` again while a source swap holds the player's lock.

`patches/__tests__/expo-audio-live-offset.test.ts` reads the installed source
and fails when the fix is not there. The ExpoAudio pod builds from
`node_modules` (`buildFromSource`), so a native rebuild compiles the patch.
Remove the two hunks when expo-audio is 58.0.7 or later (Bayaan `develop`
already has ~58.0.10). The test then still passes. When a Bayaan sync changes
`expo-audio+57.0.5.patch`, keep these hunks.
