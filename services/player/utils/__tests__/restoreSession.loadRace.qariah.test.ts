// @ai-generated
// Qariah-only cases for restoreSession, moved out of upstream's suite
// (restoreSession.loadRace.test.ts) so that file stays close to upstream
// (2026-10-24 divergence audit, batch C1). The mocks are the same as in that
// suite.
import {
  isRestoreSeekPending,
  loadAudioInBackground,
  pendingRestoreLoad,
} from '../restoreSession';

let mockOpId = 0;
const mockLoadTrack = jest.fn<Promise<void>, [string]>();
const mockSeekTo = jest.fn<Promise<void>, [number]>();
// @ai Qariah: the restore also checks that it still owns the player (the
// shown track and the service load generation, TECH_DEBT #218). The queue
// shows the restored track, and each loadTrack() moves the generation once,
// as the real service does.
let mockLoadGeneration = 0;

jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: {
    getState: () => ({queue: {tracks: [{url: 'u1'}], currentIndex: 0}}),
  },
  currentPlayOpId: () => mockOpId,
}));
jest.mock('@/services/audio/ExpoAudioService', () => ({
  expoAudioService: {
    loadTrack: (url: string) => {
      mockLoadGeneration += 1;
      return mockLoadTrack(url);
    },
    seekTo: (sec: number) => mockSeekTo(sec),
    getLoadGeneration: () => mockLoadGeneration,
  },
}));
jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  useRecentlyPlayedStore: {},
}));
jest.mock('@/services/dataService', () => ({}));
jest.mock('@/utils/audioUtils', () => ({}));
jest.mock('@/utils/artworkUtils', () => ({}));
jest.mock('@/store/uploadsStore', () => ({useUploadsStore: {}}));
jest.mock('@/utils/track', () => ({}));

// @ai TECH_DEBT #285: the loaded source reports position 0 until the seek
// lands. While the restore owns the player, ExpoAudioProvider must not save
// that position, so isRestoreSeekPending() covers the load and the seek.
describe('isRestoreSeekPending', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockOpId = 0;
    mockLoadGeneration = 0;
    mockLoadTrack.mockReset();
    mockLoadTrack.mockResolvedValue(undefined);
    mockSeekTo.mockReset();
    mockSeekTo.mockResolvedValue(undefined);
  });
  afterEach(() => jest.useRealTimers());

  it('is true during the load and the seek, and false once the seek lands', async () => {
    let seekDone: () => void = () => undefined;
    mockSeekTo.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          seekDone = resolve;
        }),
    );
    expect(isRestoreSeekPending()).toBe(false);
    loadAudioInBackground('u1', 30);
    expect(isRestoreSeekPending()).toBe(true);
    jest.advanceTimersByTime(100);
    // The load ran (generation + 1) and the seek waits.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockSeekTo).toHaveBeenCalledWith(30);
    expect(isRestoreSeekPending()).toBe(true);
    seekDone();
    await pendingRestoreLoad();
    expect(isRestoreSeekPending()).toBe(false);
  });

  it('is false with no saved position (no seek)', async () => {
    loadAudioInBackground('u1', 0);
    expect(isRestoreSeekPending()).toBe(false);
    jest.advanceTimersByTime(100);
    await pendingRestoreLoad();
  });

  it('is false at once when a newer play claims an op', async () => {
    loadAudioInBackground('u1', 30);
    mockOpId += 1;
    expect(isRestoreSeekPending()).toBe(false);
    jest.advanceTimersByTime(100);
    await pendingRestoreLoad();
  });

  it('is false at once when a newer load moves the generation', async () => {
    let loadDone: () => void = () => undefined;
    mockLoadTrack.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          loadDone = resolve;
        }),
    );
    loadAudioInBackground('u1', 30);
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(isRestoreSeekPending()).toBe(true);
    // A user pick of the same surah starts its own load.
    mockLoadGeneration += 1;
    expect(isRestoreSeekPending()).toBe(false);
    loadDone();
    await pendingRestoreLoad();
    expect(mockSeekTo).not.toHaveBeenCalled();
  });
});
