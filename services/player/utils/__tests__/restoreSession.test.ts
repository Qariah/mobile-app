/**
 * @ai Boot-order regression and race tests for the cold-start session restore.
 * See planning/boot-restore-player-order-plan.md.
 *
 * On a cold start, restoreSession() schedules the restore load on a timer.
 * ExpoAudioProvider injects the player (setPlayer) only after the app is ready.
 * When the load ran first, loadTrack() threw "Player not set", the restored
 * track stayed unloaded, and a tap on play played nothing.
 *
 * These tests use the REAL ExpoAudioService, the REAL playerStore and the REAL
 * restoreSession. Only the native player, the catalog and side-effect services
 * are fakes.
 */

jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/services/diagnostics/playbackHealth', () => ({
  notePlaybackLoad: jest.fn(),
  notePlaybackPaused: jest.fn(),
  notePlaybackPlayRequested: jest.fn(),
  notePlaybackAutoPlayLoad: jest.fn(),
}));

jest.mock('@/services/diagnostics/diagnostics', () => ({
  diagBreadcrumb: jest.fn(),
}));

// The real module starts a module-level interval (AsyncExpiringMap) that keeps
// Jest from exiting. The storage layer calls only these two functions.
jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
}));

jest.mock('@/services/audio/AudioCoordinator', () => ({
  audioCoordinator: {
    mainWillPlay: jest.fn(),
    sourceDidStop: jest.fn(),
  },
}));

jest.mock('@/services/audio/LockScreenService', () => ({
  lockScreenService: {
    clearMainPlayer: jest.fn(),
  },
}));

jest.mock('@/services/analytics/AnalyticsService', () => ({
  analyticsService: {
    trackPlaybackSkipped: jest.fn(),
    trackPlaybackSeeked: jest.fn(),
    trackRateChanged: jest.fn(),
  },
}));

const RESTORE_REWAYAT = 'rewayat-1';
const mockRecent = {
  reciter: {id: 'reciter-1', name: 'Test Reciter'},
  surah: {id: 44, name: 'Ad-Dukhan'},
  rewayatId: RESTORE_REWAYAT,
  progress: 0.5,
  duration: 60,
};

jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  useRecentlyPlayedStore: {
    getState: () => ({recentTracks: [mockRecent]}),
  },
}));

jest.mock('@/services/dataService', () => ({
  getAvailableSurahsForRewayat: jest.fn(async () => [44, 45]),
  getSurahById: (id: number) => ({id, name: `Surah ${id}`}),
}));

jest.mock('@/utils/audioUtils', () => ({
  generateSmartAudioUrl: (_r: unknown, surahId: string) =>
    `https://cdn.example.test/restore-${surahId}.mp3`,
}));

jest.mock('@/utils/artworkUtils', () => ({
  getReciterArtwork: () => undefined,
}));

jest.mock('@/store/uploadsStore', () => ({
  useUploadsStore: {getState: () => ({recitations: []})},
}));

jest.mock('@/utils/track', () => ({
  createUserUploadTrack: jest.fn(),
}));

import {restoreSession} from '../restoreSession';
import {expoAudioService} from '@/services/audio/ExpoAudioService';
import {usePlayerStore} from '@/services/player/store/playerStore';
import type {Track} from '@/types/audio';

const RESTORE_URL = 'https://cdn.example.test/restore-44.mp3';
const USER_URL = 'https://cdn.example.test/user-pick.mp3';
/** progress 0.5 × duration 60. */
const RESTORE_POSITION = 30;

/** The slice of expo-audio's AudioPlayer that ExpoAudioService uses. */
class FakeAudioPlayer {
  isLoaded = false;
  playing = false;
  isBuffering = false;
  currentTime = 0;
  duration = 0;
  playbackRate = 1;
  volume = 1;
  muted = false;
  sources: string[] = [];
  private listeners = new Set<(s: {isLoaded: boolean}) => void>();

  replace = jest.fn(async (source: {uri: string}) => {
    this.sources.push(source.uri);
    this.isLoaded = false;
    this.currentTime = 0;
    // The new source loads a moment later, as on a device.
    setTimeout(() => {
      this.isLoaded = true;
      this.duration = 60;
      this.emit(false);
      this.emit(true);
    }, 5);
  });

  play = jest.fn(async () => {
    this.playing = true;
  });

  pause = jest.fn(async () => {
    this.playing = false;
  });

  seekTo = jest.fn(async (sec: number) => {
    this.currentTime = sec;
  });

  setPlaybackRate = jest.fn();

  addListener(event: string, cb: (s: {isLoaded: boolean}) => void) {
    if (event === 'playbackStatusUpdate') this.listeners.add(cb);
    return {
      remove: () => {
        this.listeners.delete(cb);
      },
    };
  }

  private emit(isLoaded: boolean) {
    for (const cb of [...this.listeners]) cb({isLoaded});
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function inject(player: FakeAudioPlayer): void {
  expoAudioService.setPlayer(
    player as unknown as Parameters<typeof expoAudioService.setPlayer>[0],
  );
}

function userTrack(): Track {
  return {
    id: 'user:1',
    url: USER_URL,
    title: 'User pick',
    artist: 'Other Reciter',
    reciterId: 'reciter-2',
    reciterName: 'Other Reciter',
    surahId: '1',
  } as unknown as Track;
}

describe('restoreSession vs setPlayer boot order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    expoAudioService.reset();
    usePlayerStore.getState().reset();
  });

  it('T4: a restore load that runs before setPlayer loads the restored track once the player arrives', async () => {
    await restoreSession();
    // The restore timer (100 ms) fires while no player exists.
    await sleep(150);
    expect(expoAudioService.hasPlayer()).toBe(false);

    const player = new FakeAudioPlayer();
    inject(player);
    await sleep(50);

    expect(player.replace).toHaveBeenCalledWith({uri: RESTORE_URL});
    expect(expoAudioService.getCurrentUrl()).toBe(RESTORE_URL);
    expect(player.seekTo).toHaveBeenCalledWith(RESTORE_POSITION);

    // A tap on play now plays the loaded source.
    await usePlayerStore.getState().play();
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.sources).toEqual([RESTORE_URL]);
  });

  // Safety tests (not regressions): they pass on the unfixed code too, where
  // the load throws at once. They prove the wait does not re-open the #266
  // stop race or the cleanup path.
  it('S-a1 (safety): stop() while a load waits for the player -> no play(), no crash when the wait ends', async () => {
    const update = usePlayerStore.getState().updateQueue([userTrack()], 0);
    await sleep(10);

    await usePlayerStore.getState().stop();

    const player = new FakeAudioPlayer();
    inject(player);
    await update;
    await sleep(50);

    expect(player.play).not.toHaveBeenCalled();
    const state = usePlayerStore.getState();
    expect(state.playback.state).toBe('stopped');
    expect(state.queue.tracks).toHaveLength(0);
  });

  it('S-a2 (safety): playerStore.cleanup() while a load waits for the player -> no replace(), no play(), no crash when the wait ends', async () => {
    const update = usePlayerStore.getState().updateQueue([userTrack()], 0);
    await sleep(10);

    await usePlayerStore.getState().cleanup();

    const player = new FakeAudioPlayer();
    inject(player);
    await expect(update).resolves.toBeUndefined();
    await sleep(50);

    // cleanup() ends the waiting load's claim (load generation), so its
    // source never reaches the player.
    expect(player.replace).not.toHaveBeenCalled();
    expect(player.play).not.toHaveBeenCalled();
  });

  it('R-b: a user pick while the restore load waits -> the user track ends up loaded and playing, not the restored one', async () => {
    await restoreSession();
    await sleep(150); // The restore load now waits for the player.

    // The user picks another track before the player exists.
    const update = usePlayerStore.getState().updateQueue([userTrack()], 0);
    await sleep(10);

    const player = new FakeAudioPlayer();
    inject(player);
    await update;
    await sleep(50);

    // The stale restore load never reaches replace(): the only source handed
    // to the native player is the user's.
    expect(player.replace).not.toHaveBeenCalledWith({uri: RESTORE_URL});
    expect(player.sources).toEqual([USER_URL]);
    expect(expoAudioService.getCurrentUrl()).toBe(USER_URL);
    expect(player.play).toHaveBeenCalledTimes(1);
    // The restore seek must not move the user's track.
    expect(player.seekTo).not.toHaveBeenCalledWith(RESTORE_POSITION);
    expect(player.currentTime).toBe(0);
    const state = usePlayerStore.getState();
    expect(state.queue.tracks[state.queue.currentIndex]?.url).toBe(USER_URL);
  });

  // @ai Same-URL case (second review of PR #422, L3). The user picks the SAME
  // surah as the restore, so a URL-only guard stays true. Before the fix, the
  // restore still loaded and seeked over the user's play, and the service
  // state went from 'playing' back to 'ready'. restoreStillOwnsPlayer() now
  // also checks the load generation.
  it('R-c1: a same-URL user pick before the restore timer fires -> one load, play after it, no restore seek, state stays playing', async () => {
    await restoreSession();
    // Before the 100 ms restore timer: the user picks the restored surah.
    const update = usePlayerStore.getState().updateQueue([sameTrack()], 0);
    await sleep(150); // The restore timer fires while the user's load waits.

    const player = new FakeAudioPlayer();
    inject(player);
    await update;
    await sleep(80);

    expect(player.sources).toEqual([RESTORE_URL]);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.replace.mock.invocationCallOrder[0]).toBeLessThan(
      player.play.mock.invocationCallOrder[0],
    );
    expect(player.seekTo).not.toHaveBeenCalledWith(RESTORE_POSITION);
    expect(expoAudioService.getPlaybackState()).toBe('playing');
  });

  it('R-c2: a same-URL user pick while the restore load waits -> one load, no restore seek, state stays playing', async () => {
    await restoreSession();
    await sleep(150); // The restore load now waits for the player.

    const update = usePlayerStore.getState().updateQueue([sameTrack()], 0);
    await sleep(10);

    const player = new FakeAudioPlayer();
    inject(player);
    await update;
    await sleep(80);

    expect(player.sources).toEqual([RESTORE_URL]);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.seekTo).not.toHaveBeenCalledWith(RESTORE_POSITION);
    expect(player.currentTime).toBe(0);
    expect(expoAudioService.getPlaybackState()).toBe('playing');
  });
});

/** The same surah and URL that the restore puts at the head of the queue. */
function sameTrack(): Track {
  return {
    id: 'reciter-1:44',
    url: RESTORE_URL,
    title: 'Surah 44',
    artist: 'Test Reciter',
    reciterId: 'reciter-1',
    reciterName: 'Test Reciter',
    surahId: '44',
    rewayatId: RESTORE_REWAYAT,
  } as unknown as Track;
}
