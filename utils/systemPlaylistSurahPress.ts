// @ai-generated
// Qariah (Sprint 51, GitHub #555): the tap on a surah of a curated
// (`surah-only`) system playlist. Upstream plays the playlist from that surah
// with one suggested reciter; `branding.systemPlaylistSurahPress:
// 'browse-reciters'` opens the reciter list of the surah instead, so the
// listener chooses a reciter.
import type {SystemPlaylist} from '@/data/systemPlaylists';

export type SystemPlaylistSurahPress = 'play' | 'browse-reciters';

/** True when a tap on a surah row opens the reciter list. Absent → `'play'`. */
export function opensReciterList(
  playlistType: SystemPlaylist['type'],
  press: SystemPlaylistSurahPress | undefined,
): boolean {
  return playlistType === 'surah-only' && press === 'browse-reciters';
}

/**
 * The reciter list of one surah in the Search stack (the stack of the system
 * playlist screen), so back returns to the playlist. The list puts the
 * complete recitations first (#532).
 */
export function surahReciterListRoute(surahId: number) {
  return {
    pathname: '/(tabs)/(b.search)/reciter/browse',
    params: {surahId: String(surahId)},
  } as const;
}
