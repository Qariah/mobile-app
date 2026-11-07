// @ai
// DO NOT DROP — guards the Qariah hunk of patches/expo-audio+57.0.5.patch
// (TECH_DEBT #371).
//
// The defect (iOS, test iPhone on iOS 27): after Settings -> Storage ->
// "Clear cache", Control Center kept an empty "Qariah" Now Playing card.
// Clear cache clears the main player's lock screen entry
// (`lockScreenService.clearMainPlayer()` -> `clearLockScreenControls`), and
// expo-audio then sets `nowPlayingInfo` to nil and calls
// `disableRemoteCommands()`. In expo-audio 57.0.5, `enableRemoteCommands()`
// adds BLOCK targets, and `disableRemoteCommands()` calls
// `removeTarget(self)`, which does not remove a block target. So the play,
// pause, seek and skip handlers stayed registered, and iOS kept the app as
// the Now Playing app with no information. Each activation also added one
// more set of handlers.
//
// expo-audio 58 fixes this (expo/expo#46020): it keeps each target by token
// and removes it by token. The patch does the same for 57.0.5. These tests
// read the native source that the iOS build compiles (package.json builds
// expo-audio from source). They pass for 57.0.5 with the patch, and for 58.
import {readFileSync} from 'fs';
import {dirname, join} from 'path';

const MEDIA_CONTROLLER = join(
  dirname(require.resolve('expo-audio/package.json')),
  'ios',
  'MediaController.swift',
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

/** The body of the Swift function `name`, braces included. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`func ${name}(`);
  if (start === -1) throw new Error(`No function: ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`Unbalanced braces in ${name}`);
}

describe('expo-audio iOS remote command targets (TECH_DEBT #371)', () => {
  const source = readFileSync(MEDIA_CONTROLLER, 'utf8');

  it('removes the remote command targets by token', () => {
    const remove = functionBody(source, 'removeRemoteCommandTargets');
    expectPatched(
      /\.removeTarget\((?!self\))\w+\)/.test(remove),
      'removeRemoteCommandTargets() does not remove the targets by token',
    );
  });

  it('removes the targets when the lock screen controls are cleared', () => {
    const disable = functionBody(source, 'disableRemoteCommands');
    expectPatched(
      disable.includes('removeRemoteCommandTargets()'),
      'disableRemoteCommands() leaves the block targets registered',
    );
  });

  it('keeps every target that enableRemoteCommands() adds', () => {
    const enable = functionBody(source, 'enableRemoteCommands');
    // A statement that starts with `remoteCommandCenter.<command>.addTarget {`
    // throws the token away, so nothing can remove that target later.
    const discarded = enable.match(
      /^\s*remoteCommandCenter\.\w+\.addTarget\s*\{/gm,
    );
    expectPatched(
      discarded === null,
      `enableRemoteCommands() discards ${discarded?.length} target token(s)`,
    );
    expectPatched(
      enable.includes('removeRemoteCommandTargets()'),
      'enableRemoteCommands() adds a second set of targets on each activation',
    );
  });
});
