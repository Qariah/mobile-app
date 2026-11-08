// @ai
// DO NOT DROP — guards the TECH_DEBT #397 fix (react-native-worklets 0.13.0 and later).
//
// The defect (Android): the app ran a frame on the main thread 60 times a
// second in the background, also with nothing playing. A Reanimated animation
// that repeats (the Listen tab hero, for example) requests the next frame from
// the worklets `AnimationFrameQueue`. `WorkletsModule` has `onHostPause()`,
// which pauses that queue, but react-native-worklets 0.10.1 never registers
// the module as a lifecycle listener. So the queue never paused, and the UI
// runtime ran the animation in the background until the process died.
//
// react-native-worklets 0.13.0 fixes this (software-mansion/react-native-
// reanimated#10196). The patch backports that fix. These tests read the
// Kotlin source that the Android build compiles: the module cannot load in
// Jest. They pass for 0.10.1 with the patch, and for 0.13.0 or later.
import {existsSync, readFileSync} from 'fs';
import {dirname, join} from 'path';

const ROOT = join(
  dirname(require.resolve('react-native-worklets/package.json')),
  'android',
  'src',
);
const MODULE = join('com', 'swmansion', 'worklets', 'WorkletsModule.kt');
// 0.10.1 has one source set for each networking build; 0.13.0 has one.
const SOURCES = ['networking', 'no-networking', join('main', 'java')]
  .map(set => join(ROOT, set, MODULE))
  .filter(path => existsSync(path));

/** Fails with the repair step when the patched behaviour is not there. */
function expectPatched(ok: boolean, what: string): void {
  if (!ok) {
    throw new Error(
      `${what}. Run \`npx patch-package\`: ` +
        'react-native-worklets must be 0.13.0 or later; Pass D removed the 0.10.1 patch.',
    );
  }
}

/** The body of the Kotlin function whose signature contains `signature`. */
function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start === -1) return '';
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`No end of the function body: ${signature}`);
}

describe('react-native-worklets pauses its frame queue in the background (#397)', () => {
  it('finds the module source', () => {
    expect(SOURCES.length).toBeGreaterThan(0);
  });

  it.each(SOURCES)('registers the module as a lifecycle listener: %s', path => {
    const source = readFileSync(path, 'utf8');
    expectPatched(
      /addLifecycleEventListener\(this\)/.test(
        functionBody(source, 'override fun initialize()'),
      ),
      'initialize() does not register the lifecycle listener',
    );
    expectPatched(
      /removeLifecycleEventListener\(this\)/.test(
        functionBody(source, 'override fun invalidate()'),
      ),
      'invalidate() does not remove the lifecycle listener',
    );
  });

  it.each(SOURCES)('pauses and resumes the frame queue: %s', path => {
    const source = readFileSync(path, 'utf8');
    expectPatched(
      /mAnimationFrameQueue\.pause\(\)/.test(
        functionBody(source, 'override fun onHostPause()'),
      ) &&
        /mAnimationFrameQueue\.resume\(\)/.test(
          functionBody(source, 'override fun onHostResume()'),
        ),
      'the lifecycle callbacks do not pause and resume the frame queue',
    );
  });
});
