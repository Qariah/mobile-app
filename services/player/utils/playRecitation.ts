// @ai-generated
// Qariah (Sprint 48): play one recitation (one surah of one rewayah of one
// reciter) and open the player. The same sequence as
// `handleRecitationPress` in components/browse/BrowseReciters.tsx, which is
// upstream code and stays as it is.
import type {Reciter, Rewayat} from '@/data/reciterData';
import {getSurahById} from '@/services/dataService';
import {createTracksForReciter} from '@/utils/track';
import {usePlayerStore} from '@/services/player/store/playerStore';
import {useRecentlyPlayedStore} from '@/services/player/store/recentlyPlayedStore';
import {useSettings} from '@/hooks/useSettings';
import {expandPlayerSheet} from '@/services/player/sheetRef';

/**
 * Queues the surah of this rewayah, plays it, starts a new "Continue
 * Listening" chain and expands the player sheet. A partial recording plays
 * its file from the start; the player's ayah list starts at the range
 * (`branding.initialPlayerVerseKey`), so nothing more is needed here.
 */
export async function playRecitation(
  reciter: Reciter,
  rewayah: Rewayat,
  surahId: number,
): Promise<void> {
  try {
    const surah = getSurahById(surahId);
    if (!surah) return;
    const rewayatId = rewayah.id ?? reciter.rewayat[0]?.id;
    if (rewayatId) {
      useSettings.getState().setReciterPreference(reciter.id, rewayatId);
    }
    const tracks = await createTracksForReciter(reciter, [surah], rewayatId);
    await usePlayerStore.getState().updateQueue(tracks, 0);
    await usePlayerStore.getState().play();
    await useRecentlyPlayedStore
      .getState()
      .startNewChain(reciter, surah, 0, 0, rewayatId);
    expandPlayerSheet();
  } catch (error) {
    console.error('Error playing recitation:', error);
  }
}
