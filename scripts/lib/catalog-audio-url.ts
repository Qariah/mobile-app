// @ai-generated
// Qariah (TECH_DEBT #346): the audio URL that scripts/verify-catalog-urls.ts checks.
//
// The verifier must check the URL the app plays. The app builds it with
// `recitationAudioUrl` (utils/recitationAudioUrl.ts): a partial upload with
// `audio_path: 'suffixed'` has its own file name, and every other row keeps
// `{server}/{surah-padded}.mp3`. This function calls that builder, so the
// verifier and the app cannot differ on the `audio_path` rule.
//
// One difference stays on purpose: the verifier tolerates a `server` with a
// final slash. The inherited Bayaan fallback catalog has one on most rows. The
// app does NOT trim it: it requests `server//018.mp3`, a different URL. So the
// verifier prints a warning for each such row (`serverProblem`), and
// data/__tests__/catalog-contract.test.ts fails a Qariah catalog row that has
// a final slash.
import type {Rewayat} from '../../data/reciterData';
import {recitationAudioUrl} from '../../utils/recitationAudioUrl';

export type ServerProblem = 'missing' | 'final-slash';

/**
 * What is wrong with the `server` of a catalog row, or null when it is fine.
 * `missing` is a failure of the row. `final-slash` is a warning: the verifier
 * checks `server/018.mp3`, and the app requests `server//018.mp3`.
 */
export function serverProblem(
  rewayat: Partial<Pick<Rewayat, 'server'>> | null | undefined,
): ServerProblem | null {
  const server = rewayat?.server;
  if (typeof server !== 'string' || server.trim() === '') return 'missing';
  return server.endsWith('/') ? 'final-slash' : null;
}

export function catalogAudioUrl(
  rewayat: Pick<Rewayat, 'server' | 'surah_metadata'>,
  surah: number,
): string {
  if (serverProblem(rewayat) === 'missing') {
    throw new Error('the row has no server URL');
  }
  const server = rewayat.server.endsWith('/')
    ? rewayat.server.slice(0, -1)
    : rewayat.server;
  return recitationAudioUrl(
    {server, surah_metadata: rewayat.surah_metadata},
    surah,
  );
}
