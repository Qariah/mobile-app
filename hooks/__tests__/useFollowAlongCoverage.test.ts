// @ai-generated
// Qariah (#847): the "Follow Along" chip and row use the player's rule, so
// they never claim follow-along that the player cannot show. The player
// offers follow-along for a rewayah in the registry (loadFollowAlongRegistry,
// from timestampFetchService.hasSource) and shows the verses of a surah when
// timestampFetchService.hasSurah is true.
import {act, renderHook} from '@testing-library/react-native';
import {
  RECITERS,
  markRecitersUpdated,
  type Reciter,
  type Rewayat,
} from '@/data/reciterData';
import {timestampFetchService} from '@/services/timestamps/TimestampFetchService';
import {useTimestampStore} from '@/store/timestampStore';
import {
  playerSurahCoverage,
  useFollowAlongSurahs,
} from '../useFollowAlongCoverage';
import {
  FOLLOW_ALONG_MIN_QARIAHS,
  selectFollowAlongRecitations,
} from '@/components/listen/followAlongRow';

// The SQLite cache pulls in expo-sqlite (native); the rule needs none of it.
jest.mock('@/services/timestamps/TimestampDatabaseService', () => ({
  timestampDatabaseService: {writeTimestamps: jest.fn()},
}));

// Zaynab Talha, Hafs: the one rewayah with bundled timings (all 114 surahs).
const BUNDLED_REWAYAT_ID = 'f543c610-837d-5fc5-825f-0b51752aa3a4';

function rewayah(
  id: string,
  surahs: number[],
  timings: Pick<Rewayat, 'has_timestamps' | 'timestamps_surah_list'>,
): Rewayat {
  return {
    id,
    reciter_id: `${id}-reciter`,
    name: "Hafs A'n Assem",
    style: 'murattal',
    server: 'https://example.invalid/audio',
    surah_total: surahs.length,
    surah_list: surahs,
    source_type: 'test',
    created_at: '2026-01-01',
    ...timings,
  };
}

function reciter(id: string, rewayat: Rewayat[]): Reciter {
  return {id, name: id, date: null, image_url: null, rewayat};
}

// Each case of the rule, as the catalog gives it.
const listed = reciter('listed', [
  rewayah('rw-listed', [1, 36, 50, 70], {
    has_timestamps: true,
    timestamps_surah_list: [36, 70, 99], // 99 is not a listed surah
  }),
]);
const allListed = reciter('all-listed', [
  rewayah('rw-all', [1, 2, 3], {
    has_timestamps: true,
    timestamps_surah_list: [],
  }),
]);
const noList = reciter('no-list', [
  rewayah('rw-no-list', [5, 6], {has_timestamps: true}),
]);
const flagOff = reciter('flag-off', [
  rewayah('rw-flag-off', [1, 2], {
    has_timestamps: false,
    timestamps_surah_list: [1, 2],
  }),
]);
const bundled = reciter('bundled', [
  rewayah(BUNDLED_REWAYAT_ID, [1, 2, 114], {has_timestamps: false}),
]);
const noTimings = reciter('no-timings', [rewayah('rw-none', [1, 2], {})]);

const CATALOG = [listed, allListed, noList, flagOff, bundled, noTimings];

function fill(reciters: Reciter[]) {
  act(() => {
    RECITERS.splice(0, RECITERS.length, ...reciters);
    markRecitersUpdated();
  });
}

function loadRegistry() {
  act(() => {
    useTimestampStore.getState().loadFollowAlongRegistry();
  });
}

describe('the follow-along rule of the chip and the row', () => {
  const saved = [...RECITERS];
  beforeEach(() => {
    fill(CATALOG);
    loadRegistry();
  });
  afterAll(() => {
    RECITERS.splice(0, RECITERS.length, ...saved);
  });

  it('agrees with the player on every surah of the catalog', () => {
    const {supportedRewayatIds} = useTimestampStore.getState();
    const covers = playerSurahCoverage(supportedRewayatIds);
    for (const r of CATALOG) {
      for (const rw of r.rewayat) {
        for (let surah = 1; surah <= 114; surah++) {
          const player =
            supportedRewayatIds.has(rw.id) &&
            timestampFetchService.hasSurah(rw.id, surah);
          expect(covers(rw.id, surah)).toBe(player);
        }
      }
    }
  });

  it('marks only the surahs of timestamps_surah_list that the rewayah lists', () => {
    const {result} = renderHook(() => useFollowAlongSurahs('rw-listed'));
    expect([...result.current]).toEqual([36, 70]);
  });

  it('marks every listed surah when timestamps_surah_list is empty or missing', () => {
    expect([
      ...renderHook(() => useFollowAlongSurahs('rw-all')).result.current,
    ]).toEqual([1, 2, 3]);
    expect([
      ...renderHook(() => useFollowAlongSurahs('rw-no-list')).result.current,
    ]).toEqual([5, 6]);
  });

  it('marks no surah when has_timestamps is false or absent', () => {
    expect(
      renderHook(() => useFollowAlongSurahs('rw-flag-off')).result.current.size,
    ).toBe(0);
    expect(
      renderHook(() => useFollowAlongSurahs('rw-none')).result.current.size,
    ).toBe(0);
  });

  it('marks the surahs of the bundled timings although has_timestamps is false', () => {
    expect([
      ...renderHook(() => useFollowAlongSurahs(BUNDLED_REWAYAT_ID)).result
        .current,
    ]).toEqual([1, 2, 114]);
  });

  it('marks no surah of a rewayah that the registry does not have yet', () => {
    act(() => {
      useTimestampStore.setState({supportedRewayatIds: new Set<string>()});
    });
    const {result} = renderHook(() => useFollowAlongSurahs('rw-listed'));
    expect(result.current.size).toBe(0);
    // The registry loads: the chips come.
    loadRegistry();
    expect([
      ...renderHook(() => useFollowAlongSurahs('rw-listed')).result.current,
    ]).toEqual([36, 70]);
  });

  it('marks no surah with no rewayah id, or an id the catalog does not have', () => {
    expect(
      renderHook(() => useFollowAlongSurahs(undefined)).result.current.size,
    ).toBe(0);
    expect(
      renderHook(() => useFollowAlongSurahs('rw-unknown')).result.current.size,
    ).toBe(0);
  });

  it('computes again when the catalog is filled again', () => {
    const {result} = renderHook(() => useFollowAlongSurahs('rw-listed'));
    expect([...result.current]).toEqual([36, 70]);
    fill([
      reciter('listed', [
        rewayah('rw-listed', [1, 36, 50, 70], {
          has_timestamps: true,
          timestamps_surah_list: [1, 50],
        }),
      ]),
    ]);
    expect([...result.current]).toEqual([1, 50]);
  });

  it('gives the Listen row only the surahs that the player can follow', () => {
    const {supportedRewayatIds} = useTimestampStore.getState();
    const cards = selectFollowAlongRecitations(
      playerSurahCoverage(supportedRewayatIds),
    );
    // listed, all-listed, no-list and bundled: 4 qariahs, one card each, the
    // first covered surah in catalog order (no seed).
    expect(cards.map(c => [c.reciter.id, c.surah])).toEqual([
      ['listed', 36],
      ['all-listed', 1],
      ['no-list', 5],
      ['bundled', 1],
    ]);
    expect(cards.length).toBeGreaterThanOrEqual(FOLLOW_ALONG_MIN_QARIAHS);
  });

  it('gives the Listen row no card while fewer than 3 qariahs have follow-along', () => {
    // The live catalog today: only the bundled timings.
    fill([bundled, flagOff, noTimings]);
    loadRegistry();
    const {supportedRewayatIds} = useTimestampStore.getState();
    expect(
      selectFollowAlongRecitations(playerSurahCoverage(supportedRewayatIds)),
    ).toEqual([]);
  });
});
