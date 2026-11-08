// @ai Sprint 52: the held queue (#749) in upstream's player files.
//
// qariah-main's fix f0b0d1d7e made the player sheet and the tablet controls
// column read the held queue (`selectForegroundQueue`), so a track change in
// the background does not re-render the player. Pass D replaced both files
// with upstream's PlayerHost / PlayerBody and the tablet Now Playing parts.
// This test keeps those replacements on the held queue.
import {readFileSync} from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');

const HELD_QUEUE_READERS = [
  'components/player/v2/PlayerHost.tsx',
  'components/player/v2/PlayerBody.tsx',
  'components/player/v2/tablet/useNowPlayingMeta.ts',
  'components/player/v2/tablet/PlayerParts.tsx',
];

describe.each(HELD_QUEUE_READERS)('%s', file => {
  const source = readFileSync(path.join(ROOT, file), 'utf8');

  it('reads the held queue, not the live queue', () => {
    expect(source).toContain('usePlayerStore(selectForegroundQueue)');
    expect(source).not.toMatch(
      /usePlayerStore\(\s*\(?s\)?\s*=>\s*s\.queue\s*\)/,
    );
  });
});
