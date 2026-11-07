// @ai-generated
// Qariah: a queued track shows the catalog's Arabic reciter name in Arabic
// (Sprint 47 Tier-2, the mini player, the full player and the lock screen).
jest.mock('../language', () => ({currentLanguage: 'en'}));

import {RECITERS, markRecitersUpdated, type Reciter} from '@/data/reciterData';
import {getReciterDisplayName, getTrackArtistDisplay} from '../format';
import {
  getCatalogArabicReciterName,
  getReciterIdForRewayat,
} from '../qariahReciterNames';

const ZAYNAB_ID = '00000000-0000-4000-8000-00000000z001';

function catalogReciter(id: string, name: string, nameArabic?: string) {
  return {
    id,
    name,
    name_arabic: nameArabic,
    date: null,
    image_url: null,
    rewayat: [],
    surah: 0,
    is_full: false,
  } as Reciter;
}

describe('catalog Arabic reciter names', () => {
  beforeEach(() => {
    RECITERS.splice(
      0,
      RECITERS.length,
      catalogReciter(ZAYNAB_ID, 'Zaynab Talha', 'زينب طلحة'),
      catalogReciter('no-arabic', 'Plain Name'),
    );
    markRecitersUpdated();
  });

  afterAll(() => {
    RECITERS.splice(0, RECITERS.length);
    markRecitersUpdated();
  });

  it('finds the reciter of a recitation id (the Mushaf player, #311)', () => {
    RECITERS.splice(0, RECITERS.length, {
      ...catalogReciter(ZAYNAB_ID, 'Zaynab Talha', 'زينب طلحة'),
      rewayat: [{id: 'rw-zaynab-hafs'}],
    } as unknown as Reciter);
    markRecitersUpdated();
    expect(getReciterIdForRewayat('rw-zaynab-hafs')).toBe(ZAYNAB_ID);
    expect(getReciterIdForRewayat('rw-unknown')).toBeNull();
    expect(
      getReciterDisplayName(
        {
          id: getReciterIdForRewayat('rw-zaynab-hafs') ?? undefined,
          name: 'Zaynab Talha',
        },
        'ar',
      ),
    ).toBe('زينب طلحة');
  });

  it('finds the name_arabic of a catalog reciter by id', () => {
    expect(getCatalogArabicReciterName(ZAYNAB_ID)).toBe('زينب طلحة');
    expect(getCatalogArabicReciterName('no-arabic')).toBeNull();
    expect(getCatalogArabicReciterName('unknown')).toBeNull();
  });

  it('shows the Arabic name of a queued track in Arabic only', () => {
    const track = {artist: 'Zaynab Talha', reciterId: ZAYNAB_ID};
    expect(getTrackArtistDisplay(track, 'ar')).toBe('زينب طلحة');
    expect(getTrackArtistDisplay(track, 'en')).toBe('Zaynab Talha');
  });

  it('keeps upload names and names without Arabic', () => {
    expect(
      getTrackArtistDisplay(
        {artist: 'My Upload', reciterId: ZAYNAB_ID, isUserUpload: true},
        'ar',
      ),
    ).toBe('My Upload');
    expect(
      getTrackArtistDisplay(
        {artist: 'Plain Name', reciterId: 'no-arabic'},
        'ar',
      ),
    ).toBe('Plain Name');
  });

  it('sees a catalog refresh', () => {
    RECITERS.splice(
      0,
      RECITERS.length,
      catalogReciter(ZAYNAB_ID, 'Zaynab Talha', 'زينب'),
    );
    markRecitersUpdated();
    expect(getReciterDisplayName({id: ZAYNAB_ID, name: 'x'}, 'ar')).toBe(
      'زينب',
    );
  });
});
