// @ai
// DO NOT DROP — guards patches/expo-router+58.0.28.patch.
//
// The defect (iOS 26, the Mushaf toolbar of app/mushaf.tsx): VoiceOver read
// the buttons as "go to end", "Ya-Sin 36:10" and "go to start", not as
// "Previous ayah", "Pause" and "Next ayah". The JS passed the labels, and
// Jest saw them on the props, but expo-router 58.0.28 set them on the
// RouterToolbarItemView's own UIView label. The UIBarButtonItem takes its
// label from `routerAccessibilityLabel` and `routerAccessibilityHint`
// (RouterToolbarItemView.applyCommonProperties), and no prop set those. The
// combined device check of 2026-11-12 found it on the test iPhone, on the PR
// build and on the qariah-main build 4487.
//
// The patch makes each prop set the router value too. These tests read the
// Swift source that the iOS build compiles: expo-router ships no
// ExpoRouter.xcframework, so its podspec compiles the source.
import {existsSync, readFileSync} from 'fs';
import {dirname, join} from 'path';

const IOS = join(dirname(require.resolve('expo-router/package.json')), 'ios');
const MODULE = join(IOS, 'Toolbar', 'RouterToolbarModule.swift');
const ITEM_VIEW = join(IOS, 'Toolbar', 'RouterToolbarItemView.swift');

/** The body of the Swift `Prop("<name>") { ... }` block, braces included. */
function propBody(source: string, name: string): string {
  const start = source.indexOf(`Prop("${name}")`);
  if (start === -1) throw new Error(`No prop: ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`Unclosed prop: ${name}`);
}

function expectPatched(ok: boolean, what: string): void {
  if (!ok) {
    throw new Error(
      `${what}. Run \`npx patch-package\`; when expo-router changes version, ` +
        'check whether upstream sets routerAccessibilityLabel, then regenerate or drop the patch.',
    );
  }
}

describe('expo-router toolbar accessibility label patch', () => {
  const moduleSource = readFileSync(MODULE, 'utf8');

  it('sets the bar button label from the accessibilityLabel prop', () => {
    expectPatched(
      /view\.routerAccessibilityLabel\s*=\s*accessibilityLabel/.test(
        propBody(moduleSource, 'accessibilityLabel'),
      ),
      'The accessibilityLabel prop does not set routerAccessibilityLabel',
    );
  });

  it('sets the bar button hint from the accessibilityHint prop', () => {
    expectPatched(
      /view\.routerAccessibilityHint\s*=\s*accessibilityHint/.test(
        propBody(moduleSource, 'accessibilityHint'),
      ),
      'The accessibilityHint prop does not set routerAccessibilityHint',
    );
  });

  it('still reads the router values when it builds the bar button', () => {
    const itemView = readFileSync(ITEM_VIEW, 'utf8');
    expect(itemView).toMatch(
      /item\.accessibilityLabel\s*=\s*routerAccessibilityLabel/,
    );
    expect(itemView).toMatch(
      /item\.accessibilityHint\s*=\s*routerAccessibilityHint/,
    );
  });

  it('compiles from source on iOS, so the patch is in the build', () => {
    expect(existsSync(join(IOS, 'ExpoRouter.xcframework'))).toBe(false);
  });
});
