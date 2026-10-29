// @ai-generated
// Qariah (Sprint 51, GitHub #555): a tap on a surah of a curated playlist
// opens the reciter list of that surah.
import branding from '@/config/branding';
import {
  opensReciterList,
  surahReciterListRoute,
} from '@/utils/systemPlaylistSurahPress';

describe('opensReciterList', () => {
  it('is true for a surah-only playlist with browse-reciters', () => {
    expect(opensReciterList('surah-only', 'browse-reciters')).toBe(true);
  });

  it('keeps the upstream play when the field is absent or play', () => {
    expect(opensReciterList('surah-only', undefined)).toBe(false);
    expect(opensReciterList('surah-only', 'play')).toBe(false);
  });

  it('keeps the play of a fully-curated playlist (its rows name a reciter)', () => {
    expect(opensReciterList('fully-curated', 'browse-reciters')).toBe(false);
  });

  it('is on in the Qariah branding', () => {
    expect(branding.systemPlaylistSurahPress).toBe('browse-reciters');
  });
});

describe('surahReciterListRoute', () => {
  it('opens the Search-stack reciter list with the surah id as a string', () => {
    expect(surahReciterListRoute(67)).toEqual({
      pathname: '/(tabs)/(b.search)/reciter/browse',
      params: {surahId: '67'},
    });
  });
});
