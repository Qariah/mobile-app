/**
 * RFC-019 local-timestamp seam — Bucket A standing regression test.
 *
 * Sprint 41 adopted upstream's `branding.timestampLocalProvider` +
 * `branding.timestampLocalSurahList` pair (Bayaan #305), retiring the
 * hand-patched `'local'` source branch `TimestampFetchService` carried since
 * Sprint 8. That branch was silently dropped once before (Sprint 26's
 * wholesale absorption; restored via 93821ea) — this suite pins the behavior
 * so a future wholesale take of the service OR an accidental unwiring of the
 * branding pair fails CI instead of silently emptying the Mushaf Player
 * Settings reciter dropdown.
 *
 * `config/branding.js` is CJS whose RFC-019 fields lazy-`require()` the
 * bundled registry at call time (Sprint 24 rule #2), so importing it here is
 * safe in the jest/node env.
 */
import branding from '@/config/branding';
import type {AyahTimestamp} from '@/types/timestamps';
import {timestampFetchService} from '../TimestampFetchService';
import {timestampDatabaseService} from '../TimestampDatabaseService';
import {useTimestampStore} from '@/store/timestampStore';
import {RECITERS, type Reciter, type Rewayat} from '@/data/reciterData';

// The SQLite cache pulls in expo-sqlite (native); replace it with a recording
// fake so `fetchAndCache`'s 'local' write path is observable in jest.
jest.mock('../TimestampDatabaseService', () => ({
  timestampDatabaseService: {
    writeTimestamps: jest.fn().mockResolvedValue(undefined),
  },
}));

// Zaynab Talha — Hafs A'n Assem. The one bundled-timings rewayat
// (assets/data/timings/index.ts): 114 surahs, 6,234 ayat.
const ZAYNAB_REWAYAT_ID = 'f543c610-837d-5fc5-825f-0b51752aa3a4';
const UNKNOWN_REWAYAT_ID = '00000000-0000-0000-0000-000000000000';

const mockedWrite = timestampDatabaseService.writeTimestamps as jest.Mock;

// Bind the optional seam pair once; the first assertion below turns a missing
// wiring into a named failure instead of a TypeError mid-suite.
const provider = branding.timestampLocalProvider;
const surahList = branding.timestampLocalSurahList;

function requireProvider(): NonNullable<typeof provider> {
  if (!provider) throw new Error('branding.timestampLocalProvider not wired');
  return provider;
}

function requireSurahList(): NonNullable<typeof surahList> {
  if (!surahList) {
    throw new Error('branding.timestampLocalSurahList not wired');
  }
  return surahList;
}

describe('RFC-019 branding seam (timestampLocalProvider + timestampLocalSurahList)', () => {
  it('branding wires both fields as functions', () => {
    expect(typeof provider).toBe('function');
    expect(typeof surahList).toBe('function');
  });

  it("coverage list reports all 114 surahs for Zaynab's rewayat", () => {
    const list = requireSurahList()(ZAYNAB_REWAYAT_ID) ?? [];
    expect(list).toHaveLength(114);
    // Exact allow-list semantics: every surah 1–114 present, ascending.
    expect(list[0]).toBe(1);
    expect(list[113]).toBe(114);
    expect(new Set(list).size).toBe(114);
  });

  it('provider resolves >0 well-shaped timestamps for surah 1', () => {
    const timings = requireProvider()(ZAYNAB_REWAYAT_ID, 1) ?? [];
    expect(timings.length).toBeGreaterThan(0);
    // Same first-element shape contract TimestampFetchService validates.
    const first: AyahTimestamp = timings[0];
    expect(typeof first.surahNumber).toBe('number');
    expect(typeof first.ayahNumber).toBe('number');
    expect(typeof first.timestampFrom).toBe('number');
    expect(typeof first.timestampTo).toBe('number');
    expect(typeof first.durationMs).toBe('number');
  });

  it('coverage list and provider agree (RFC-019 contract: every listed surah has data)', () => {
    const list = requireSurahList()(ZAYNAB_REWAYAT_ID) ?? [];
    expect(list.length).toBeGreaterThan(0);
    for (const surah of list) {
      const timings = requireProvider()(ZAYNAB_REWAYAT_ID, surah);
      expect(timings && timings.length > 0).toBe(true);
    }
  });

  it('reports no local coverage for an unknown rewayat', () => {
    expect(requireSurahList()(UNKNOWN_REWAYAT_ID)).toBeNull();
    expect(requireProvider()(UNKNOWN_REWAYAT_ID, 1)).toBeNull();
  });
});

describe('TimestampFetchService through the RFC-019 seam', () => {
  beforeEach(() => {
    mockedWrite.mockClear();
    // Any network fetch on the local path is a regression — fail loudly.
    global.fetch = jest.fn(() =>
      Promise.reject(new Error('unexpected network fetch on local path')),
    ) as unknown as typeof fetch;
  });

  it("hasSource is true for Zaynab's rewayat (gates the Mushaf Player Settings reciter dropdown — mushafPlayerStore.computeAvailableReciters)", () => {
    expect(timestampFetchService.hasSource(ZAYNAB_REWAYAT_ID)).toBe(true);
  });

  it('hasSource is false for a rewayat with neither local nor R2 coverage', () => {
    expect(timestampFetchService.hasSource(UNKNOWN_REWAYAT_ID)).toBe(false);
  });

  it('hasSurah answers from the exact local allow-list', () => {
    expect(timestampFetchService.hasSurah(ZAYNAB_REWAYAT_ID, 1)).toBe(true);
    expect(timestampFetchService.hasSurah(ZAYNAB_REWAYAT_ID, 114)).toBe(true);
    expect(timestampFetchService.hasSurah(ZAYNAB_REWAYAT_ID, 115)).toBe(false);
  });

  it("fetchAndCache resolves surah 1 from the bundle, caches it as source 'local', and never touches the network", async () => {
    const result = await timestampFetchService.fetchAndCache(
      ZAYNAB_REWAYAT_ID,
      1,
    );

    expect(result).not.toBeNull();
    const timings = result ?? [];
    expect(timings.length).toBeGreaterThan(0);
    expect(timings[0].surahNumber).toBe(1);

    expect(mockedWrite).toHaveBeenCalledTimes(1);
    const [rewayatId, surahNumber, written, source] = mockedWrite.mock
      .calls[0] as [string, number, unknown[], string];
    expect(rewayatId).toBe(ZAYNAB_REWAYAT_ID);
    expect(surahNumber).toBe(1);
    expect(written).toBe(result);
    expect(source).toBe('local');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetchAndCache returns null (no cache write, no fetch) for a rewayat with no coverage anywhere', async () => {
    const result = await timestampFetchService.fetchAndCache(
      UNKNOWN_REWAYAT_ID,
      1,
    );
    expect(result).toBeNull();
    expect(mockedWrite).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('Follow-Along registry (store/timestampStore) through the seam', () => {
  // Sprint 41 fast-follow (stage-2 review finding): loadFollowAlongRegistry
  // used to read the raw catalog `has_timestamps` flag — false for every
  // rewayat in Qariah's catalog — so the registry was permanently empty and
  // the Follow-Along badge / FollowAlongSheet / verse-actions gating never
  // saw Zaynab Talha's bundled coverage. It must derive support from
  // timestampFetchService.hasSource (local coverage OR R2 flag), the way
  // mushafPlayerStore.computeAvailableReciters does.
  const FIXTURE_RECITER_ID = 'fixture-zaynab-talha';
  const R2_FLAGGED_REWAYAT_ID = 'fixture-r2-flagged-rewayat';
  const NO_COVERAGE_REWAYAT_ID = 'fixture-no-coverage-rewayat';

  const makeRewayat = (
    id: string,
    hasTimestamps: boolean | undefined,
  ): Rewayat => ({
    id,
    reciter_id: FIXTURE_RECITER_ID,
    name: "Hafs A'n Assem",
    style: 'murattal',
    server: 'https://example.invalid/audio',
    surah_total: 114,
    surah_list: [1],
    source_type: 'catalog',
    created_at: '2026-01-01',
    has_timestamps: hasTimestamps,
  });

  // Minimal catalog fixture: Zaynab's real bundled rewayat id with the flag
  // FALSE (the live-catalog shape), one R2-flagged rewayat (flag-only path
  // must keep working), one with neither (must stay excluded).
  const fixtureReciter: Reciter = {
    id: FIXTURE_RECITER_ID,
    name: 'Zaynab Talha (fixture)',
    date: null,
    image_url: null,
    rewayat: [
      makeRewayat(ZAYNAB_REWAYAT_ID, false),
      makeRewayat(R2_FLAGGED_REWAYAT_ID, true),
      makeRewayat(NO_COVERAGE_REWAYAT_ID, false),
    ],
  };

  beforeAll(() => {
    RECITERS.push(fixtureReciter);
  });

  afterAll(() => {
    const idx = RECITERS.indexOf(fixtureReciter);
    if (idx !== -1) RECITERS.splice(idx, 1);
  });

  it("registry includes Zaynab's locally-covered rewayat despite has_timestamps: false (regression: raw-flag read left the registry empty)", () => {
    useTimestampStore.getState().loadFollowAlongRegistry();
    const {supportedRewayatIds, supportedReciterIds, registryLoaded} =
      useTimestampStore.getState();

    expect(registryLoaded).toBe(true);
    expect(supportedRewayatIds.has(ZAYNAB_REWAYAT_ID)).toBe(true);
    expect(supportedReciterIds.has(FIXTURE_RECITER_ID)).toBe(true);
  });

  it('still honors the R2 has_timestamps flag and still excludes rewayat with no coverage anywhere', () => {
    useTimestampStore.getState().loadFollowAlongRegistry();
    const {supportedRewayatIds} = useTimestampStore.getState();

    expect(supportedRewayatIds.has(R2_FLAGGED_REWAYAT_ID)).toBe(true);
    expect(supportedRewayatIds.has(NO_COVERAGE_REWAYAT_ID)).toBe(false);
  });
});
