// @ai
// DO NOT DROP — guards the Qariah hunk of patches/expo-audio+57.0.5.patch in
// ios/AudioPlayer.swift (issue #763, Sentry QARIAHV2-7B).
//
// The defect (iOS, production 3.2.3 (3772), 10 users in 3 days): "App
// Hanging for at least 3000 ms". On each tick of the periodic time observer,
// expo-audio 57.0.5 sends a status, and the status reads
// `currentOffsetFromLive`, which calls `AVPlayerItem.currentDate()` on the
// main thread. `currentDate()` is a synchronous call to the media server, and
// it blocks until the item has loaded. So while a new recitation loads, the
// main thread waits on the network. expo-audio 55 (production 1718) did not
// read `currentDate()`; expo-audio 56 added it.
//
// expo-audio 58.0.7 fixes this (expo/expo#50724): it reads `currentDate()`
// only for a ready, live item (an indefinite duration), and the status of a
// time-observer tick uses the tick's time instead of reading `currentTime()`
// again. Qariah plays files, not live streams, so the app never reads
// `currentDate()` now. The patch does the same for 57.0.5. These tests read
// the native source that the iOS build compiles (package.json builds
// expo-audio from source). They pass for 57.0.5 with the patch, and for 58.
import {readFileSync} from 'fs';
import {dirname, join} from 'path';

const AUDIO_PLAYER = join(
  dirname(require.resolve('expo-audio/package.json')),
  'ios',
  'AudioPlayer.swift',
);

/** Fails with the repair step when the patched behaviour is not there. */
function expectPatched(ok: boolean, what: string): void {
  if (!ok) {
    throw new Error(
      `${what}. Run \`npx patch-package\`: ` +
        'patches/expo-audio+57.0.5.patch is not applied.',
    );
  }
}

/** The braced body that follows the first match of `head`. */
function bodyAfter(source: string, head: string): string {
  const start = source.indexOf(head);
  if (start === -1) throw new Error(`Not found: ${head}`);
  const open = source.indexOf('{', start + head.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`Unbalanced braces after ${head}`);
}

describe('expo-audio iOS live offset (issue #763)', () => {
  // Without the `//` comments: a comment can name `currentDate()` too.
  const source = readFileSync(AUDIO_PLAYER, 'utf8').replace(/\/\/.*$/gm, '');

  it('reads currentDate() only for a ready, live item', () => {
    const getter = bodyAfter(source, 'var currentOffsetFromLive: Double? {');
    const call = getter.search(/\.currentDate\(\)/);
    expectPatched(
      call !== -1,
      'currentOffsetFromLive no longer reads currentDate()',
    );
    const guard = getter.slice(0, call);
    expectPatched(
      /\.status\s*==\s*\.readyToPlay/.test(guard),
      'currentOffsetFromLive reads currentDate() before the item is ready',
    );
    expectPatched(
      /\.duration\.isIndefinite/.test(guard),
      'currentOffsetFromLive reads currentDate() for an item that is not live',
    );
  });

  it('uses the time of the tick in the status of a time-observer tick', () => {
    const update = bodyAfter(source, 'func updateStatus(with dict:');
    expectPatched(
      /currentStatus\(\s*knownCurrentTime:\s*dict\["currentTime"\]/.test(
        update,
      ),
      'updateStatus() reads currentTime again instead of the known time',
    );
    const status = bodyAfter(source, 'func currentStatus(knownCurrentTime');
    expectPatched(
      /"currentTime":\s*knownCurrentTime\s*\?\?\s*currentTime/.test(status),
      'currentStatus() ignores knownCurrentTime',
    );
  });
});
