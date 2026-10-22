import {create} from 'zustand';

interface MushafNavigationState {
  targetPage: number | null;
  targetVerseKey: string | null;
  // @ai Qariah (Sprint 47 Task 10): the surah a link asked for, when the
  // page was resolved from it (the header names it on a shared page).
  targetSurahId: number | null;
  requestId: number;
  navigateToVerse: (verseKey: string, page: number) => void;
  // @ai Qariah (Sprint 47 Task 10, TECH_DEBT #281): a page with no verse to
  // select — a link to the open reader (hooks/useReaderLinkPage.ts).
  navigateToPage: (page: number, surahId?: number) => void;
  clear: () => void;
}

export const useMushafNavigationStore = create<MushafNavigationState>(set => ({
  targetPage: null,
  targetVerseKey: null,
  targetSurahId: null, // @ai
  requestId: 0,
  navigateToVerse: (verseKey, page) =>
    set(s => ({
      targetPage: page,
      targetVerseKey: verseKey,
      targetSurahId: null, // @ai
      requestId: s.requestId + 1,
    })),
  // @ai-start
  navigateToPage: (page, surahId) =>
    set(s => ({
      targetPage: page,
      targetVerseKey: null,
      targetSurahId: surahId ?? null,
      requestId: s.requestId + 1,
    })),
  // @ai-end
  clear: () =>
    set({targetPage: null, targetVerseKey: null, targetSurahId: null}), // @ai: targetSurahId
}));
