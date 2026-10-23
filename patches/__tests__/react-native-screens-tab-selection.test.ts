// @ai
// DO NOT DROP — guards patches/react-native-screens+4.29.0.patch (QP-08).
//
// The defect (iOS 26.1 and later, test iPhone on iOS 27): after Settings ->
// Storage -> "Clear cache", a tap on the Listen tab content did nothing until
// the user changed tabs two more times. The clear empties the queue, so the
// mini player (the native tab-bar bottom accessory) goes away, and the safe
// area of each hidden tab changes. When the user then selects such a tab,
// UIKit puts its view in the window between `shouldSelectTab:` and
// `didSelectTab:`. The iOS 26 `SafeAreaView` around each stack screen sends
// its new insets with an immediate state update, so React Native mounts a
// transaction at that time. In react-native-screens 4.29.0 each mount
// transaction clears the flag that marks a user selection, so
// `didSelectTab:` returns early and JS never gets `onTabSelected`. JS keeps
// the previous tab as focused, and expo-router gives each tab that is not
// focused `pointerEvents: 'none'`. So the visible tab takes no touches.
//
// react-native-screens 4.30.0 fixes this (software-mansion/react-native-
// screens#4862). The patch backports that fix. These tests read the native
// source that the iOS build compiles: the native tabs cannot mount in Jest.
// They pass for 4.29.0 with the patch, and for 4.30.0 or later.
import {readFileSync} from 'fs';
import {dirname, join} from 'path';

const CONTROLLER = join(
  dirname(require.resolve('react-native-screens/package.json')),
  'ios',
  'tabs',
  'host',
  'RNSTabBarController.mm',
);

/** Fails with the repair step when the patched behaviour is not there. */
function expectPatched(ok: boolean, what: string): void {
  if (!ok) {
    throw new Error(
      `${what}. Run \`npx patch-package\`: ` +
        'patches/react-native-screens+4.29.0.patch is not applied.',
    );
  }
}

/** The body of the Objective-C method whose signature contains `signature`. */
function methodBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start === -1) throw new Error(`No method: ${signature}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`No end of the method body: ${signature}`);
}

describe('react-native-screens keeps a user tab selection (QP-08)', () => {
  const source = readFileSync(CONTROLLER, 'utf8');

  it('a mount transaction does not clear a user selection', () => {
    // 4.29.0 cleared `_isHandlingUserTabSelection` here.
    const body = methodBody(source, '- (void)performContainerUpdate');
    expectPatched(
      !/UserTabSelection/.test(body),
      'performContainerUpdate clears the user-selection flag',
    );
  });

  it('didSelectTab: drops only the selections that the controller writes', () => {
    const body = methodBody(source, 'didSelectTab:(UITab *)selectedTab');
    expectPatched(
      /if \(_isApplyingProgrammaticTabSelection\) \{\s*return;\s*\}/.test(
        body,
      ) && !/UserTabSelection/.test(body),
      'didSelectTab: drops a user selection after a mount transaction',
    );
  });

  it('the controller marks its own write of the selected tab', () => {
    const body = methodBody(source, '- (void)applySelectedScreenController:');
    expectPatched(
      /_isApplyingProgrammaticTabSelection = YES;\s*self\.selectedTab = screenController\.tab;\s*_isApplyingProgrammaticTabSelection = NO;/.test(
        body,
      ),
      'applySelectedScreenController: does not mark its own selection',
    );
  });
});
