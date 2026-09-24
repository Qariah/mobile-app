import {create} from 'zustand';
import {persist} from 'zustand/middleware';
import {storage} from '@/utils/storage';
import {guardedJSONStorage} from '@/services/storage/hydrationGuardedStorage';

type BrowseViewMode = 'card' | 'list';
type BrowseSortOption = 'asc' | 'desc' | 'revelation';

type ReciterProfileViewMode = 'card' | 'list';
type ReciterProfileSortOption = 'asc' | 'desc' | 'revelation'; // Add revelation option

interface SettingsState {
  askEveryTime: boolean;
  setAskEveryTime: (value: boolean) => void;
  defaultReciterSelection: string | null;
  setDefaultReciterSelection: (value: string | null) => void;
  reciterPreferences: Record<string, string>; // reciterId -> rewayatId
  setReciterPreference: (reciterId: string, rewayatId: string) => void;
  getReciterPreference: (reciterId: string) => string | undefined;
  // Browse All Surahs settings
  browseViewMode: BrowseViewMode;
  setBrowseViewMode: (mode: BrowseViewMode) => void;
  browseSortOption: BrowseSortOption;
  setBrowseSortOption: (option: BrowseSortOption) => void;
  // Reciter Profile settings
  reciterProfileViewMode: ReciterProfileViewMode;
  setReciterProfileViewMode: (mode: ReciterProfileViewMode) => void;
  reciterProfileSortOption: ReciterProfileSortOption;
  setReciterProfileSortOption: (option: ReciterProfileSortOption) => void;
  // Onboarding tracking
  recitersViewOpenCount: number;
  incrementRecitersViewOpenCount: () => void;
  shouldShowNewToQuran: () => boolean;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      askEveryTime: true,
      setAskEveryTime: value => set({askEveryTime: value}),
      defaultReciterSelection: null,
      setDefaultReciterSelection: value =>
        set({defaultReciterSelection: value}),
      reciterPreferences: {},
      setReciterPreference: (reciterId, rewayatId) =>
        set(state => ({
          reciterPreferences: {
            ...state.reciterPreferences,
            [reciterId]: rewayatId,
          },
        })),
      getReciterPreference: (reciterId: string): string | undefined =>
        get().reciterPreferences[reciterId],
      browseViewMode: 'card' as BrowseViewMode, // Default to card view
      setBrowseViewMode: (mode: BrowseViewMode) => set({browseViewMode: mode}),
      browseSortOption: 'asc' as BrowseSortOption, // Default to ascending sort
      setBrowseSortOption: (option: BrowseSortOption) =>
        set({browseSortOption: option}),
      reciterProfileViewMode: 'list' as ReciterProfileViewMode, // Default to list view
      setReciterProfileViewMode: (mode: ReciterProfileViewMode) =>
        set({reciterProfileViewMode: mode}),
      reciterProfileSortOption: 'asc' as ReciterProfileSortOption, // Default to ascending sort
      setReciterProfileSortOption: (option: ReciterProfileSortOption) =>
        set({reciterProfileSortOption: option}),
      recitersViewOpenCount: 0,
      incrementRecitersViewOpenCount: () =>
        set(state => ({
          recitersViewOpenCount: state.recitersViewOpenCount + 1,
        })),
      shouldShowNewToQuran: () => get().recitersViewOpenCount < 5,
    }),
    {
      name: 'settings-storage',
      // `storage` from `@/utils/storage` IS AsyncStorage (`export const storage
      // = AsyncStorage`), so this store carries the same destructive shape as
      // the other 16 — a rejected hydrating read would let the next write
      // persist defaults over `reciterPreferences` (every per-reciter rewaya
      // choice the user has ever made) and `defaultReciterSelection`. It was
      // the last one found precisely because it reaches AsyncStorage through
      // that alias rather than importing it directly. The alias is passed
      // through deliberately so the backend seam in `@/utils/storage` survives.
      // See services/storage/hydrationGuardedStorage.ts and GitHub #329.
      storage: guardedJSONStorage('settings-storage', storage),
    },
  ),
);
