// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): the app side of the tap routes
// (`tapRouter.ts`): the catalog lookups, the play, the session resume and the
// boot's session restore. `useQariahNotifications.ts` requires this module on
// the first tap, so the player and the catalog modules stay off the hook's
// import path.
import {getReciterByIdSync, getReciterBySlug} from '@/services/dataService';
import {waitForSessionRestored} from '@/services/car/sessionGate';
import {whenMushafRestoreHandled} from '@/services/mushafRestoreSignal';
import {usePlayerStore} from '@/services/player/store/playerStore';
import {useRecentlyPlayedStore} from '@/services/player/store/recentlyPlayedStore';
import {closePlayerSheet, expandPlayerSheet} from '@/services/player/sheetRef';
import {playRecitation} from '@/services/player/utils/playRecitation';
import {
  MUSHAF_RESTORE_WAIT_MS,
  SESSION_WAIT_MS,
  waitUntilReady,
  type OpenTapDeps,
  type TapRouterNavigation,
} from './tapRouter';

/**
 * Resumes the last session and opens the player. The player's queue (the
 * boot restored it) plays as the widget Play button does
 * (`handleWidgetCommand` `setPlayback`: the held source, at the saved
 * position); with no queue, the most recent entry of the recently played list
 * resumes at its saved position. `false` when there is nothing to resume.
 */
export async function resumeLastSession(): Promise<boolean> {
  const store = usePlayerStore.getState();
  if (store.queue.tracks[store.queue.currentIndex]) {
    const {handleWidgetCommand} =
      require('@/services/widgets/handleWidgetCommand') as typeof import('@/services/widgets/handleWidgetCommand');
    await handleWidgetCommand({type: 'setPlayback', playing: true});
    expandPlayerSheet();
    return true;
  }
  const recent = useRecentlyPlayedStore.getState().recentTracks[0];
  if (!recent || recent.isUserUpload) return false;
  const {resumeRecent} =
    require('@/services/player/utils/resumeRecent') as typeof import('@/services/player/utils/resumeRecent');
  await resumeRecent({
    reciterId: recent.reciter.id,
    surahId: recent.surah.id,
    rewayatId: recent.rewayatId,
    startPosition: recent.progress * recent.duration,
    recentIndex: 0,
    updateQueue: (tracks, index, start) =>
      usePlayerStore.getState().updateQueue(tracks, index, start),
  });
  expandPlayerSheet();
  return true;
}

/** The deps of `openNotificationTap` for the app. */
export function appTapDeps(
  router: TapRouterNavigation,
  isNavigationReady: () => boolean,
): OpenTapDeps {
  return {
    router,
    waitForNavigation: () => waitUntilReady(isNavigationReady),
    waitForSession: () => waitForSessionRestored(SESSION_WAIT_MS),
    waitForMushafRestore: () =>
      whenMushafRestoreHandled(MUSHAF_RESTORE_WAIT_MS),
    byId: getReciterByIdSync,
    bySlug: getReciterBySlug,
    playRecitation,
    resumeLastSession,
    closePlayer: () => {
      if (usePlayerStore.getState().sheetMode === 'full') closePlayerSheet();
    },
  };
}
