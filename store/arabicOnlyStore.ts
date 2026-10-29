// @ai-generated
// Qariah (#680): the reading aids that the user had before "Arabic text only"
// turned them off. Turning the switch off gives them back. The set is
// persisted, so it survives a restart, and it is one set for the three places
// that open Mushaf Settings (the reader, the full player and Settings).
//
// A Qariah store, not a field of upstream's mushafSettingsStore, so the fork
// adds no field or migration to an upstream persisted store.
import {create} from 'zustand';
import {persist} from 'zustand/middleware';
import {guardedJSONStorage} from '@/services/storage/hydrationGuardedStorage';

/** The reading aids that the "Arabic text only" switch hides. */
export interface ReadingAids {
  showTranslation: boolean;
  showTransliteration: boolean;
  showWBW: boolean;
}

interface ArabicOnlyState {
  /** The aids before the switch turned on; null when nothing is saved. */
  savedAids: ReadingAids | null;
  setSavedAids: (aids: ReadingAids | null) => void;
}

export const ARABIC_ONLY_STORE_NAME = 'qariah-arabic-only-store';

export const useArabicOnlyStore = create<ArabicOnlyState>()(
  persist(
    set => ({
      savedAids: null,
      setSavedAids: aids => set({savedAids: aids}),
    }),
    {
      name: ARABIC_ONLY_STORE_NAME,
      storage: guardedJSONStorage(ARABIC_ONLY_STORE_NAME),
      version: 1,
    },
  ),
);
