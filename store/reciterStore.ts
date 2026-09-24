import {create} from 'zustand';
import {persist} from 'zustand/middleware';
import {Reciter} from '@/data/reciterData';
import {RECITERS} from '@/data/reciterData';
import {HAFS_REWAYAT_NAME} from '@/data/rewayat';
import {guardedJSONStorage} from '@/services/storage/hydrationGuardedStorage';

// Helper function to get the Hafs A'n Assem rewayat from a reciter
function getHafsRewayat(reciter: Reciter) {
  return reciter.rewayat.find(r => r.name === HAFS_REWAYAT_NAME);
}

// Qariah: prefer reciters with a complete (114-surah) recitation as the default.
// Avoids picking an alphabetically-first Hafs reciter whose catalog only covers
// a handful of surahs (e.g. Maryam Amir, who has Hafs but only ~5 surahs).
function hasCompleteQuran(reciter: Reciter) {
  return reciter.rewayat.some(
    r => r.surah_list?.filter(id => id !== null).length === 114,
  );
}

// Lazy-computed default reciter — avoids .find() scans at module load time
let _defaultReciter: Reciter | null = null;
function getDefaultReciter(): Reciter {
  if (_defaultReciter) return _defaultReciter;

  // RECITERS is empty on first launch before API data loads — return placeholder
  if (RECITERS.length === 0) {
    return {id: '', name: '', date: null, image_url: null, rewayat: []};
  }

  const misharyAlafasi = RECITERS.find(
    reciter =>
      reciter.name === 'Mishary Alafasi' &&
      reciter.rewayat.some(r => r.name === HAFS_REWAYAT_NAME),
  );

  // Qariah: prefer a Hafs reciter who has a COMPLETE Quran (114 surahs).
  const anyCompleteHafsReciter = RECITERS.find(
    reciter =>
      hasCompleteQuran(reciter) &&
      reciter.rewayat.some(r => r.name === HAFS_REWAYAT_NAME),
  );

  const anyHafsReciter = RECITERS.find(reciter =>
    reciter.rewayat.some(r => r.name === HAFS_REWAYAT_NAME),
  );

  const reciter =
    misharyAlafasi || anyCompleteHafsReciter || anyHafsReciter || RECITERS[0];

  // Ensure the default rewayat is Hafs if available
  const hafsRewayat = getHafsRewayat(reciter);
  if (hafsRewayat) {
    _defaultReciter = {
      ...reciter,
      rewayat: [
        hafsRewayat,
        ...reciter.rewayat.filter(r => r.id !== hafsRewayat.id),
      ],
    };
  } else {
    _defaultReciter = reciter;
  }

  return _defaultReciter;
}

interface ReciterState {
  defaultReciter: Reciter;
  isInitialized: boolean;
  setDefaultReciter: (reciter: Reciter) => void;
  refreshDefaultReciter: () => void;
}

export const useReciterStore = create<ReciterState>()(
  persist(
    set => ({
      defaultReciter: getDefaultReciter(),
      isInitialized: false,
      refreshDefaultReciter: () => {
        _defaultReciter = null;
        set({defaultReciter: getDefaultReciter()});
      },
      setDefaultReciter: reciter => {
        // When setting a new default reciter, ensure Hafs is the first rewayat if available
        const hafsRewayat = getHafsRewayat(reciter);
        if (hafsRewayat) {
          reciter = {
            ...reciter,
            rewayat: [
              hafsRewayat,
              ...reciter.rewayat.filter(r => r.id !== hafsRewayat.id),
            ],
          };
        }
        set({defaultReciter: reciter});
      },
    }),
    {
      name: 'reciter-storage',
      partialize: state => ({defaultReciter: state.defaultReciter}),
      storage: guardedJSONStorage('reciter-storage'),
      // Qariah: if the persisted default reciter doesn't have a complete Quran
      // (legacy installs picked Maryam Amir, who only has ~5 surahs), reset to
      // a sensible default. Runs once on app launch after rehydration.
      onRehydrateStorage: () => state => {
        if (!state) return;
        const current = state.defaultReciter;
        if (current && current.id && !hasCompleteQuran(current)) {
          _defaultReciter = null;
          state.defaultReciter = getDefaultReciter();
        }
      },
    },
  ),
);
