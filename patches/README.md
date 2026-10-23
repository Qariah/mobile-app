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
