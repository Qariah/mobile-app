import {create} from 'zustand';

interface MushafNavigationState {
  targetPage: number | null;
  targetVerseKey: string | null;
  // @ai Qariah: the surah a link asked for (the header names it on a shared page).
  targetSurahId: number | null;
  requestId: number;
  navigateToVerse: (verseKey: string, page: number) => void;
  // @ai Qariah (TECH_DEBT #281): a page with no verse to select (a link to the open reader).
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
