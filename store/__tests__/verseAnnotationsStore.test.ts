// @ai #276 — regression tests for the multi-surah annotation load that backs
// the mushaf bookmark-highlight fix: merge across surahs, cache-key no-ops,
// subset no-op (a per-surah load must not narrow a page-level superset), and
// serialization of concurrent loads (the old `loading` guard dropped them).
import {useVerseAnnotationsStore} from '../verseAnnotationsStore';
import {verseAnnotationService} from '@/services/verse-annotations/VerseAnnotationService';
import type {
  VerseBookmark,
  VerseHighlight,
  VerseNote,
} from '@/types/verse-annotations';

jest.mock('@/services/verse-annotations/VerseAnnotationService', () => ({
  verseAnnotationService: {
    getAnnotationsForSurah: jest.fn(),
  },
}));

const mockGetAnnotations =
  verseAnnotationService.getAnnotationsForSurah as jest.Mock;

interface SurahAnnotations {
  bookmarks: VerseBookmark[];
  notes: VerseNote[];
  highlights: VerseHighlight[];
}

function bookmark(verseKey: string): VerseBookmark {
  const [surah, ayah] = verseKey.split(':').map(Number);
  return {
    id: `bm-${verseKey}`,
    verseKey,
    surahNumber: surah,
    ayahNumber: ayah,
    createdAt: 0,
  };
}

function annotations(
  partial: Partial<SurahAnnotations> = {},
): SurahAnnotations {
  return {bookmarks: [], notes: [], highlights: [], ...partial};
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return {promise, resolve};
}

function resetStore() {
  useVerseAnnotationsStore.setState({
    loadedSurah: null,
    loadedKey: null,
    bookmarkedVerseKeys: new Set<string>(),
    notedVerseKeys: new Set<string>(),
    highlights: {},
    loading: false,
  });
}

describe('verseAnnotationsStore multi-surah loading (#276)', () => {
  beforeEach(() => {
    resetStore();
    mockGetAnnotations.mockReset();
    mockGetAnnotations.mockResolvedValue(annotations());
  });

  it('merges annotations across every surah on a multi-surah page', async () => {
    mockGetAnnotations.mockImplementation((surah: number) => {
      if (surah === 112)
        return Promise.resolve(annotations({bookmarks: [bookmark('112:1')]}));
      if (surah === 114)
        return Promise.resolve(
          annotations({
            bookmarks: [bookmark('114:3')],
            highlights: [
              {
                id: 'hl-114:2',
                verseKey: '114:2',
                surahNumber: 114,
                ayahNumber: 2,
                color: 'green',
                createdAt: 0,
              },
            ],
          }),
        );
      return Promise.resolve(annotations());
    });

    await useVerseAnnotationsStore
      .getState()
      .loadAnnotationsForSurahs([112, 113, 114]);

    const state = useVerseAnnotationsStore.getState();
    expect(state.loadedKey).toBe('112,113,114');
    expect(state.loadedSurah).toBe(112);
    expect(state.bookmarkedVerseKeys.has('112:1')).toBe(true);
    expect(state.bookmarkedVerseKeys.has('114:3')).toBe(true);
    expect(state.highlights['114:2']).toBe('green');
    expect(state.loading).toBe(false);
  });

  it('no-ops on an exact key match instead of refetching', async () => {
    const store = useVerseAnnotationsStore.getState();
    await store.loadAnnotationsForSurahs([1, 2]);
    expect(mockGetAnnotations).toHaveBeenCalledTimes(2);

    await store.loadAnnotationsForSurahs([2, 1, 2]);
    expect(mockGetAnnotations).toHaveBeenCalledTimes(2);
  });

  it('per-surah load is a subset no-op against a page-level superset', async () => {
    mockGetAnnotations.mockImplementation((surah: number) =>
      Promise.resolve(
        surah === 114
          ? annotations({bookmarks: [bookmark('114:3')]})
          : annotations(),
      ),
    );
    const store = useVerseAnnotationsStore.getState();
    await store.loadAnnotationsForSurahs([112, 113, 114]);

    // ContinuousMushafView-style per-surah call must NOT narrow the store
    // back to one surah — that would unpaint sibling-surah bookmarks.
    await store.loadAnnotationsForSurah(113);
    const state = useVerseAnnotationsStore.getState();
    expect(state.loadedKey).toBe('112,113,114');
    expect(state.bookmarkedVerseKeys.has('114:3')).toBe(true);

    // A surah outside the loaded set still reloads.
    await store.loadAnnotationsForSurah(50);
    expect(useVerseAnnotationsStore.getState().loadedKey).toBe('50');
  });

  it('serializes a load requested while another is in flight (no drop)', async () => {
    const gate = deferred<SurahAnnotations>();
    let firstCall = true;
    mockGetAnnotations.mockImplementation((surah: number) => {
      if (firstCall) {
        firstCall = false;
        return gate.promise;
      }
      return Promise.resolve(
        surah === 2
          ? annotations({bookmarks: [bookmark('2:255')]})
          : annotations(),
      );
    });

    const store = useVerseAnnotationsStore.getState();
    const first = store.loadAnnotationsForSurahs([1]);
    const second = store.loadAnnotationsForSurahs([1, 2]);

    gate.resolve(annotations({bookmarks: [bookmark('1:5')]}));
    await Promise.all([first, second]);

    // The old `if (loading) return` guard dropped the second call outright;
    // it must now run after the first and win with the superset key.
    const state = useVerseAnnotationsStore.getState();
    expect(state.loadedKey).toBe('1,2');
    expect(state.bookmarkedVerseKeys.has('2:255')).toBe(true);
  });

  it('leaves the previous key intact when a load fails', async () => {
    const store = useVerseAnnotationsStore.getState();
    await store.loadAnnotationsForSurahs([1]);
    expect(useVerseAnnotationsStore.getState().loadedKey).toBe('1');

    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockGetAnnotations.mockRejectedValueOnce(new Error('db closed'));
    await store.loadAnnotationsForSurahs([2]);
    consoleError.mockRestore();

    const state = useVerseAnnotationsStore.getState();
    expect(state.loadedKey).toBe('1');
    expect(state.loading).toBe(false);

    // And the next load still works (in-flight slot was released).
    await store.loadAnnotationsForSurahs([2]);
    expect(useVerseAnnotationsStore.getState().loadedKey).toBe('2');
  });

  it('optimistic bookmark mutations update the set immediately', () => {
    const store = useVerseAnnotationsStore.getState();
    store.addBookmark('1:5');
    expect(useVerseAnnotationsStore.getState().isBookmarked('1:5')).toBe(true);
    store.removeBookmark('1:5');
    expect(useVerseAnnotationsStore.getState().isBookmarked('1:5')).toBe(false);
  });
});
