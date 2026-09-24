import {create} from 'zustand';
import {verseAnnotationService} from '@/services/verse-annotations/VerseAnnotationService';
import type {HighlightColor} from '@/types/verse-annotations';

interface VerseAnnotationsState {
  loadedSurah: number | null;
  /**
   * Cache key for the loaded surah set (e.g. '1' or '112,113,114' — sorted,
   * comma-joined). Multi-surah loads exist because a single mushaf page can
   * span several surahs (the norm in Juz 'Amma); a per-surah cache would
   * blind the page renderer to bookmarks in the page's later surahs. @ai #276
   */
  loadedKey: string | null;
  bookmarkedVerseKeys: Set<string>;
  notedVerseKeys: Set<string>;
  highlights: Record<string, HighlightColor>;
  loading: boolean;

  loadAnnotationsForSurah: (surahNumber: number) => Promise<void>;
  loadAnnotationsForSurahs: (surahNumbers: number[]) => Promise<void>;

  // Optimistic mutations
  addBookmark: (verseKey: string) => void;
  removeBookmark: (verseKey: string) => void;
  addNote: (verseKey: string) => void;
  removeNote: (verseKey: string) => void;
  setHighlight: (verseKey: string, color: HighlightColor) => void;
  removeHighlight: (verseKey: string) => void;

  // Query helpers
  isBookmarked: (verseKey: string) => boolean;
  hasNote: (verseKey: string) => boolean;
  getHighlightColor: (verseKey: string) => HighlightColor | null;
}

// @ai #276 — serializes loads instead of dropping them. The old
// `if (loading) return` guard silently discarded the second caller's surah
// set when two surfaces raced (e.g. ContinuousMushafView's per-surah load vs
// main.tsx's page-level multi-surah load), leaving the store on the wrong key.
let inFlightLoad: Promise<void> | null = null;

export const useVerseAnnotationsStore = create<VerseAnnotationsState>()(
  (set, get) => ({
    loadedSurah: null,
    loadedKey: null,
    bookmarkedVerseKeys: new Set<string>(),
    notedVerseKeys: new Set<string>(),
    highlights: {},
    loading: false,

    loadAnnotationsForSurah: async (surahNumber: number) => {
      // Subset no-op: if this surah is already part of the loaded set (a
      // page-level multi-surah load), don't narrow the store back down to
      // one surah — that would unpaint sibling-surah bookmarks. @ai #276
      const key = get().loadedKey;
      if (key && key.split(',').some(s => Number(s) === surahNumber)) return;
      await get().loadAnnotationsForSurahs([surahNumber]);
    },

    loadAnnotationsForSurahs: async (surahNumbers: number[]) => {
      const surahs = [...new Set(surahNumbers)].sort((a, b) => a - b);
      if (surahs.length === 0) return;
      const key = surahs.join(',');
      if (get().loadedKey === key) return;

      // Wait out any in-flight load, then re-check — the load we waited on
      // may have populated this exact key.
      while (inFlightLoad) {
        await inFlightLoad;
      }
      if (get().loadedKey === key) return;

      const load = (async () => {
        set({loading: true});

        try {
          const results = await Promise.all(
            surahs.map(n => verseAnnotationService.getAnnotationsForSurah(n)),
          );

          const bookmarkedVerseKeys = new Set<string>();
          const notedVerseKeys = new Set<string>();
          const highlightsRecord: Record<string, HighlightColor> = {};
          for (const {bookmarks, notes, highlights} of results) {
            bookmarks.forEach(b => bookmarkedVerseKeys.add(b.verseKey));
            notes.forEach(n => notedVerseKeys.add(n.verseKey));
            highlights.forEach(h => {
              highlightsRecord[h.verseKey] = h.color;
            });
          }

          set({
            loadedSurah: surahs[0],
            loadedKey: key,
            bookmarkedVerseKeys,
            notedVerseKeys,
            highlights: highlightsRecord,
            loading: false,
          });
        } catch (error) {
          console.error(
            '[VerseAnnotationsStore] Failed to load annotations:',
            error,
          );
          set({loading: false});
        }
      })();

      inFlightLoad = load;
      try {
        await load;
      } finally {
        if (inFlightLoad === load) inFlightLoad = null;
      }
    },

    // Optimistic mutations
    addBookmark: (verseKey: string) => {
      const newSet = new Set(get().bookmarkedVerseKeys);
      newSet.add(verseKey);
      set({bookmarkedVerseKeys: newSet});
    },

    removeBookmark: (verseKey: string) => {
      const newSet = new Set(get().bookmarkedVerseKeys);
      newSet.delete(verseKey);
      set({bookmarkedVerseKeys: newSet});
    },

    addNote: (verseKey: string) => {
      const newSet = new Set(get().notedVerseKeys);
      newSet.add(verseKey);
      set({notedVerseKeys: newSet});
    },

    removeNote: (verseKey: string) => {
      const newSet = new Set(get().notedVerseKeys);
      newSet.delete(verseKey);
      set({notedVerseKeys: newSet});
    },

    setHighlight: (verseKey: string, color: HighlightColor) => {
      set({highlights: {...get().highlights, [verseKey]: color}});
    },

    removeHighlight: (verseKey: string) => {
      const newHighlights = {...get().highlights};
      delete newHighlights[verseKey];
      set({highlights: newHighlights});
    },

    // Query helpers (O(1))
    isBookmarked: (verseKey: string) => get().bookmarkedVerseKeys.has(verseKey),

    hasNote: (verseKey: string) => get().notedVerseKeys.has(verseKey),

    getHighlightColor: (verseKey: string) => get().highlights[verseKey] ?? null,
  }),
);
