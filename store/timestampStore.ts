import {create} from 'zustand';
import type {AyahTimestamp, AyahTrackingState} from '@/types/timestamps';
import {timestampService} from '@/services/timestamps/TimestampService';
import {timestampFetchService} from '@/services/timestamps/TimestampFetchService';
import {RECITERS} from '@/data/reciterData';

interface TimestampState {
  currentAyah: AyahTrackingState | null;
  currentSurahTimestamps: AyahTimestamp[] | null;
  currentTimestampKey: string | null;
  isLocked: boolean;

  // Follow Along registry
  supportedRewayatIds: Set<string>;
  supportedReciterIds: Set<string>;
  registryLoaded: boolean;
  followAlongEnabled: boolean;

  setCurrentAyah: (state: AyahTrackingState) => void;
  setIsLocked: (isLocked: boolean) => void;
  clearCurrentAyah: () => void;
  loadTimestampsForSurah: (
    rewayatId: string,
    surahNumber: number,
  ) => Promise<void>;
  clearCurrentTimestamps: () => void;
  loadFollowAlongRegistry: () => void;
  toggleFollowAlong: () => void;
}

export const useTimestampStore = create<TimestampState>()((set, get) => ({
  currentAyah: null,
  currentSurahTimestamps: null,
  currentTimestampKey: null,
  isLocked: true,

  // Follow Along registry defaults
  supportedRewayatIds: new Set<string>(),
  supportedReciterIds: new Set<string>(),
  registryLoaded: false,
  followAlongEnabled: true,

  setIsLocked: isLocked => set({isLocked}),

  setCurrentAyah: ayahState => set({currentAyah: ayahState}),

  clearCurrentAyah: () => set({currentAyah: null}),

  loadTimestampsForSurah: async (rewayatId, surahNumber) => {
    const key = `${rewayatId}-${surahNumber}`;
    if (get().currentTimestampKey === key) return;

    const timestamps = await timestampService.getTimestampsForSurah(
      rewayatId,
      surahNumber,
    );
    set({
      currentSurahTimestamps: timestamps,
      currentTimestampKey: key,
      currentAyah: null,
    });
  },

  clearCurrentTimestamps: () =>
    set({
      currentSurahTimestamps: null,
      currentTimestampKey: null,
      currentAyah: null,
    }),

  loadFollowAlongRegistry: () => {
    const rewayatIds = new Set<string>();
    const reciterIds = new Set<string>();

    for (const reciter of RECITERS) {
      for (const rewayat of reciter.rewayat) {
        // Sprint 41 (RFC-019 fast-follow) — derive support from
        // timestampFetchService.hasSource, which ORs the fork-supplied
        // bundled coverage (branding.timestampLocalSurahList) with the R2
        // `has_timestamps` flag, mirroring
        // mushafPlayerStore.computeAvailableReciters. Reading the raw
        // catalog flag here left the registry permanently empty for Qariah
        // (every rewayat ships has_timestamps: false), hiding Zaynab
        // Talha's local coverage from the Follow-Along badge, the
        // FollowAlongSheet suggestions, and the verse-actions gating.
        // hasSource is synchronous + guards the fork-supplied provider
        // internally; degrade to the pre-RFC-019 flag check anyway so a
        // throwing seam can never fail registry load.
        let supported: boolean;
        try {
          supported = timestampFetchService.hasSource(rewayat.id);
        } catch {
          supported = Boolean(rewayat.has_timestamps);
        }
        if (supported) {
          rewayatIds.add(rewayat.id);
          reciterIds.add(reciter.id);
        }
      }
    }

    console.log(
      `[FollowAlong] Registry loaded: ${rewayatIds.size} rewayat, ${reciterIds.size} reciters`,
    );

    set({
      supportedRewayatIds: rewayatIds,
      supportedReciterIds: reciterIds,
      registryLoaded: true,
    });
  },

  toggleFollowAlong: () =>
    set(state => ({followAlongEnabled: !state.followAlongEnabled})),
}));
