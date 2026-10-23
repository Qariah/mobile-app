/**
 * @ai TECH_DEBT #271 — a restored track must play after a cold start, for each
 * entry point that can start a play.
 *
 * Device defect (3.2.2 (2579) and 3.2.1 (vc2027), Android): play a surah from
 * a playlist, pause, force-stop, open the app, tap Play in the mini player.
 * The button showed Pause and no audio played. A play from a playlist wrote
 * no recent track, so restoreSession() returned early and loaded no source,
 * but the hydrated player queue still showed the track.
 *
 * The fix: the saved queue is the session (restorePersistedQueue), and
 * playerStore.play() loads the shown track when it has no source.
 *
 * Each test runs the writes that one entry point makes, a progress tick and a
 * pause, then a "restart": the stores hydrate again from storage, and the audio
 * service starts with no player and no source. Then restoreSession() runs, the
 * player arrives, and the user taps Play.
 *
 * These tests use the REAL ExpoAudioService, playerStore, recentlyPlayedStore,
 * downloadStore, URL builder (utils/audioUtils) and restoreSession. The
 * catalog, the app container path, the file check, the native player and the
 * side-effect services are fakes. The L1, L2 and R1-R10 cases come from the
 * adversarial review of the first fix (2026-10-18).
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
  audioCoordinator: {mainWillPlay: jest.fn()},
}));

jest.mock('@/services/analytics/AnalyticsService', () => ({
  analyticsService: {
    trackPlaybackSkipped: jest.fn(),
    trackPlaybackSeeked: jest.fn(),
    trackRateChanged: jest.fn(),
    trackDownloadDeleted: jest.fn(),
  },
}));

// recentlyPlayedStore mirrors explicit plays to QF when signed in.
jest.mock('@/services/userState', () => ({
  enqueueReadingSessionSync: jest.fn(),
}));

// Two reciters with one rewayah each, surahs 1-114.
type FakeRewayat = {id: string; server: string; surah_list: number[]};
type FakeReciter = {id: string; name: string; rewayat: FakeRewayat[]};
const ALL_SURAHS = Array.from({length: 114}, (_, i) => i + 1);
const mockCatalog: FakeReciter[] = [
  {
    id: 'reciter-a',
    name: 'Reciter A',
    rewayat: [
      {
        id: 'rw-a',
        server: 'https://cdn.example.test/rw-a',
        surah_list: ALL_SURAHS,
      },
    ],
  },
  {
    id: 'reciter-b',
    name: 'Reciter B',
    rewayat: [
      {
        id: 'rw-b',
        server: 'https://cdn.example.test/rw-b',
        surah_list: ALL_SURAHS,
      },
    ],
  },
];

jest.mock('@/services/dataService', () => ({
  getAvailableSurahsForRewayat: jest.fn(async (rewayatId: string) => {
    for (const r of mockCatalog) {
      const rw = r.rewayat.find(x => x.id === rewayatId);
      if (rw) return rw.surah_list;
    }
    return [];
  }),
  getSurahById: (id: number) => ({id, name: `Surah ${id}`}),
  getReciterByIdSync: (id: string) => mockCatalog.find(r => r.id === id),
}));

// The app container moved: every download resolves into "container-new".
jest.mock('@/services/downloadService', () => ({
  resolveFilePath: (p: string) =>
    `file:///container-new/Documents/${p.split('/').pop()}`,
  extractFilename: (p: string) => p.split('/').pop(),
  clearAllDownloads: jest.fn(),
  removeDownload: jest.fn(),
}));

jest.mock('@/utils/artworkUtils', () => ({
  getReciterArtwork: (r: {id: string}) => `artwork:${r.id}`,
}));

type FakeRecitation = {id: string; filePath: string};
const mockRecitations: FakeRecitation[] = [];
jest.mock('@/store/uploadsStore', () => ({
  useUploadsStore: {getState: () => ({recitations: mockRecitations})},
}));

jest.mock('@/utils/track', () => ({
  createUserUploadTrack: (recitation: {id: string; filePath: string}) => ({
    id: `upload-${recitation.id}`,
    url: `file:///container-new/Documents/uploads/${recitation.filePath}`,
    title: 'My upload',
    artist: 'My Recitations',
    reciterId: '',
    reciterName: 'My Recitations',
    isUserUpload: true,
    userRecitationId: recitation.id,
  }),
}));

import * as FileSystem from 'expo-file-system/legacy';
import {restoreSession} from '../restoreSession';
import {expoAudioService} from '@/services/audio/ExpoAudioService';
import {usePlayerStore} from '@/services/player/store/playerStore';
import {useRecentlyPlayedStore} from '@/services/player/store/recentlyPlayedStore';
import {
  useDownloadStore,
  type DownloadedSurah,
} from '@/services/player/store/downloadStore';
import {RECITERS, type Reciter} from '@/data/reciterData';
import {SURAHS} from '@/data/surahData';
import type {Track} from '@/types/audio';

/** How the next replace() of the fake player ends. */
type LoadFailure = 'throw' | 'error-status' | 'silent';

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
  failures: LoadFailure[] = [];
  private listeners = new Set<(s: Record<string, unknown>) => void>();

  replace = jest.fn(async (source: {uri: string}) => {
    this.sources.push(source.uri);
    this.isLoaded = false;
    this.currentTime = 0;
    const failure = this.failures.shift();
    if (failure === 'throw') throw new Error('network unreachable');
    // The new source loads (or fails) a moment later, as on a device.
    setTimeout(() => {
      this.emit({isLoaded: false});
      if (failure === 'silent') return;
      if (failure === 'error-status') {
        this.emit({error: 'Source error'});
        return;
      }
      this.isLoaded = true;
      this.duration = 300;
      this.emit({isLoaded: true});
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

  addListener(event: string, cb: (s: Record<string, unknown>) => void) {
    if (event === 'playbackStatusUpdate') this.listeners.add(cb);
    return {
      remove: () => {
        this.listeners.delete(cb);
      },
    };
  }

  emit(status: Record<string, unknown>) {
    for (const cb of [...this.listeners]) cb(status);
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function inject(player: FakeAudioPlayer): void {
  expoAudioService.setPlayer(
    player as unknown as Parameters<typeof expoAudioService.setPlayer>[0],
  );
}

function catalogReciter(id: string): Reciter {
  const r = RECITERS.find(x => x.id === id);
  if (!r) throw new Error(`no reciter ${id}`);
  return r;
}

function surah(id: number) {
  const s = SURAHS.find(x => x.id === id);
  if (!s) throw new Error(`no surah ${id}`);
  return s;
}

/** The remote URL that utils/audioUtils builds from the rewayah server. */
function cdnUrl(rewayatId: string, surahId: number): string {
  return `https://cdn.example.test/${rewayatId}/${String(surahId).padStart(3, '0')}.mp3`;
}

/** The track that utils/track createTrack() builds (playlist, collection). */
function catalogTrack(reciterId: string, surahId: number, url?: string): Track {
  const r = mockCatalog.find(x => x.id === reciterId);
  if (!r) throw new Error(`no reciter ${reciterId}`);
  const rewayatId = r.rewayat[0].id;
  return {
    id: `${reciterId}-${surahId}`,
    url: url ?? cdnUrl(rewayatId, surahId),
    title: `Surah ${surahId}`,
    artist: r.name,
    reciterId,
    reciterName: r.name,
    surahId: String(surahId),
    rewayatId,
    duration: 0,
  };
}

/** A completed download record, as downloadService saves it. */
function download(
  reciterId: string,
  surahId: number,
  rewayatId: string,
  filePath: string,
): DownloadedSurah {
  return {
    reciterId,
    surahId: String(surahId),
    rewayatId,
    filePath,
    status: 'completed',
    downloadDate: 1,
    fileSize: 1,
  };
}

let player: FakeAudioPlayer;

/** The first session: the native player exists. */
function startFirstSession(): void {
  player = new FakeAudioPlayer();
  inject(player);
}

/**
 * The progress write that ExpoAudioProvider.persistCurrentProgress makes while
 * a track plays: the recent-track progress, then the player store position.
 */
function progressTick(position: number, duration = 300): void {
  const store = usePlayerStore.getState();
  const t = store.queue.tracks[store.queue.currentIndex];
  if (!t) return;
  const progress = position / duration;
  if (t.isUserUpload && t.userRecitationId) {
    useRecentlyPlayedStore
      .getState()
      .updateUploadProgress(t.userRecitationId, progress, duration);
  } else if (t.reciterId && t.surahId) {
    useRecentlyPlayedStore
      .getState()
      .updateProgress(t.reciterId, parseInt(t.surahId, 10), progress, duration);
  }
  store.updatePlaybackState({position, duration});
}

/** Force-stop: the stores hydrate again, the service has no source. */
async function restart(): Promise<void> {
  await sleep(10); // Let the persist writes reach storage.
  expoAudioService.reset();
  await usePlayerStore.persist.rehydrate();
  await useRecentlyPlayedStore.persist.rehydrate();
}

/**
 * Force-stop and open the app. The boot runs restoreSession(), and
 * ExpoAudioProvider injects a new player before the 100 ms restore timer.
 */
async function restartAndRestore(
  failures: LoadFailure[] = [],
): Promise<FakeAudioPlayer> {
  await restart();
  await restoreSession();
  const next = new FakeAudioPlayer();
  next.failures = failures;
  inject(next);
  await sleep(150);
  return next;
}

/** The restore load runs before setPlayer and waits for the player. */
async function restartWithoutPlayer(): Promise<void> {
  await restart();
  await restoreSession();
  await sleep(150);
}

/** The track that the mini player shows (FloatingPlayer / MiniPlayer). */
function shownTrack(): Track | undefined {
  const {queue} = usePlayerStore.getState();
  return queue.tracks[queue.currentIndex];
}

/**
 * The defect check. A tap on Play in the mini player must play the source of
 * the track that the mini player shows, from the saved position.
 */
async function expectTapOnPlayPlaysShownTrack(
  p: FakeAudioPlayer,
  savedPosition: number,
): Promise<void> {
  const shownUrl = shownTrack()?.url;
  expect(shownUrl).toBeTruthy();
  // The restore loaded the shown track and seeked to the saved position.
  expect(p.sources).toEqual([shownUrl]);
  expect(expoAudioService.getCurrentUrl()).toBe(shownUrl);
  expect(p.seekTo).toHaveBeenCalledWith(savedPosition);

  await usePlayerStore.getState().play();

  expect(p.play).toHaveBeenCalledTimes(1);
  expect(p.sources).toEqual([shownUrl]); // Play did not need a new load.
  expect(usePlayerStore.getState().playback.state).toBe('playing');
}

/** A playlist play of B:11, a progress tick at 18 s and a pause. */
async function playlistSessionPaused(): Promise<void> {
  startFirstSession();
  await usePlayerStore
    .getState()
    .updateQueue([catalogTrack('reciter-b', 11)], 0);
  progressTick(18);
  await usePlayerStore.getState().pause();
}

const queueIds = () => usePlayerStore.getState().queue.tracks.map(t => t.id);

beforeAll(() => {
  // The in-memory catalog that the app loads before restoreSession().
  RECITERS.splice(0, RECITERS.length, ...(mockCatalog as unknown as Reciter[]));
});

beforeEach(async () => {
  jest.clearAllMocks();
  // The file of a download exists unless a test says otherwise.
  jest.mocked(FileSystem.getInfoAsync).mockReset();
  jest
    .mocked(FileSystem.getInfoAsync)
    .mockResolvedValue({exists: true, isDirectory: false} as never);
  mockRecitations.splice(0);
  expoAudioService.reset();
  usePlayerStore.getState().reset();
  useRecentlyPlayedStore.getState().reset();
  useDownloadStore.setState({downloads: []});
  await sleep(5);
});

describe('restoreSession — TECH_DEBT #271 (the device repro)', () => {
  it('P1: a play from a playlist on a fresh install -> after a restart, a tap on Play plays the shown track', async () => {
    startFirstSession();
    // PlaylistDetail.handleSurahPress: the tapped track first, then the rest.
    const playlist = [
      catalogTrack('reciter-b', 11),
      catalogTrack('reciter-a', 2),
    ];
    await usePlayerStore.getState().updateQueue(playlist, 0);
    await usePlayerStore.getState().play();
    progressTick(18);
    await usePlayerStore.getState().pause();

    // The cause: a playlist play wrote no recent track.
    expect(useRecentlyPlayedStore.getState().recentTracks).toEqual([]);

    const p = await restartAndRestore();

    expect(shownTrack()?.id).toBe('reciter-b-11');
    await expectTapOnPlayPlaysShownTrack(p, 18);
    // The restore keeps the user's session: the playlist queue and its order.
    expect(queueIds()).toEqual(['reciter-b-11', 'reciter-a-2']);
  });
});

describe('restoreSession — the saved queue is the session (each entry point)', () => {
  it('E1: a surah link (app/reciter/[slug]/[surah]) -> the shown track plays', async () => {
    startFirstSession();
    await usePlayerStore
      .getState()
      .updateQueue([catalogTrack('reciter-a', 36)], 0);
    progressTick(42);
    await usePlayerStore.getState().pause();

    const p = await restartAndRestore();

    expect(shownTrack()?.id).toBe('reciter-a-36');
    await expectTapOnPlayPlaysShownTrack(p, 42);
  });

  it('E2: a queue of several surahs after an auto-advance -> the current track plays and the queue stays', async () => {
    startFirstSession();
    await usePlayerStore
      .getState()
      .updateQueue(
        [
          catalogTrack('reciter-a', 1),
          catalogTrack('reciter-b', 112),
          catalogTrack('reciter-a', 113),
        ],
        0,
      );
    await usePlayerStore.getState().skipToNext();
    progressTick(7);
    await usePlayerStore.getState().pause();

    const p = await restartAndRestore();

    expect(usePlayerStore.getState().queue.currentIndex).toBe(1);
    expect(shownTrack()?.id).toBe('reciter-b-112');
    await expectTapOnPlayPlaysShownTrack(p, 7);
    expect(queueIds()).toEqual([
      'reciter-a-1',
      'reciter-b-112',
      'reciter-a-113',
    ]);
  });

  it('E3: Collection > Downloads with a file path from an old app container -> the same file in the current container', async () => {
    startFirstSession();
    useDownloadStore.setState({
      downloads: [download('reciter-a', 18, 'rw-a', 'reciter-a-18.mp3')],
    });
    const oldPath = 'file:///container-old/Documents/reciter-a-18.mp3';
    await usePlayerStore
      .getState()
      .updateQueue([catalogTrack('reciter-a', 18, oldPath)], 0);
    progressTick(60);
    await usePlayerStore.getState().pause();

    const p = await restartAndRestore();

    expect(shownTrack()?.url).toBe(
      'file:///container-new/Documents/reciter-a-18.mp3',
    );
    expect(p.sources).not.toContain(oldPath);
    await expectTapOnPlayPlaysShownTrack(p, 60);
  });

  it('E4: the download was deleted after the play (no file) -> the restore loads the stream', async () => {
    startFirstSession();
    const deletedFile = 'file:///container-new/Documents/reciter-b-55.mp3';
    await usePlayerStore
      .getState()
      .updateQueue([catalogTrack('reciter-b', 55, deletedFile)], 0);
    progressTick(5);
    await usePlayerStore.getState().pause();
    jest
      .mocked(FileSystem.getInfoAsync)
      .mockResolvedValue({exists: false, isDirectory: false} as never);

    const p = await restartAndRestore();

    expect(shownTrack()?.url).toBe(cdnUrl('rw-b', 55));
    await expectTapOnPlayPlaysShownTrack(p, 5);
  });

  it('E5: a reciter profile play (startNewChain) -> the saved queue, not a rebuilt 114-surah list', async () => {
    startFirstSession();
    // ReciterProfile.handleSurahPress: the queue, then startNewChain.
    await usePlayerStore
      .getState()
      .updateQueue(
        [catalogTrack('reciter-a', 67), catalogTrack('reciter-a', 68)],
        0,
      );
    useRecentlyPlayedStore
      .getState()
      .startNewChain(catalogReciter('reciter-a'), surah(67), 0, 0, 'rw-a');
    progressTick(30);
    await usePlayerStore.getState().pause();

    const p = await restartAndRestore();

    expect(queueIds()).toEqual(['reciter-a-67', 'reciter-a-68']);
    await expectTapOnPlayPlaysShownTrack(p, 30);
  });

  it('E6: a playlist play while a recent track of another reciter exists -> the shown track plays and the playlist stays', async () => {
    startFirstSession();
    useRecentlyPlayedStore
      .getState()
      .startNewChain(catalogReciter('reciter-a'), surah(2), 0.1, 300, 'rw-a');
    await usePlayerStore
      .getState()
      .updateQueue(
        [catalogTrack('reciter-b', 11), catalogTrack('reciter-a', 7)],
        0,
      );
    progressTick(18);
    await usePlayerStore.getState().pause();

    const p = await restartAndRestore();

    expect(queueIds()).toEqual(['reciter-b-11', 'reciter-a-7']);
    await expectTapOnPlayPlaysShownTrack(p, 18);
  });

  it('E7: the user cleared the recent tracks (RecitersView) after a play -> the shown track plays', async () => {
    startFirstSession();
    await usePlayerStore
      .getState()
      .updateQueue([catalogTrack('reciter-a', 19)], 0);
    useRecentlyPlayedStore
      .getState()
      .startNewChain(catalogReciter('reciter-a'), surah(19), 0, 0, 'rw-a');
    progressTick(90);
    await usePlayerStore.getState().pause();
    useRecentlyPlayedStore.getState().clearRecentTracks();

    const p = await restartAndRestore();

    expect(shownTrack()?.id).toBe('reciter-a-19');
    await expectTapOnPlayPlaysShownTrack(p, 90);
  });

  it('E8: the head recent track is an upload that the user deleted -> the saved queue plays', async () => {
    startFirstSession();
    await usePlayerStore
      .getState()
      .updateQueue([catalogTrack('reciter-b', 97)], 0);
    useRecentlyPlayedStore
      .getState()
      .startUploadChain(catalogReciter('reciter-a'), surah(1), 0.5, 100, '', {
        userRecitationId: 'deleted-upload',
        uploadTitle: 'Gone',
        uploadArtist: 'My Recitations',
      });
    usePlayerStore
      .getState()
      .updatePlaybackState({position: 12, duration: 300});
    await usePlayerStore.getState().pause();

    const p = await restartAndRestore();

    expect(shownTrack()?.id).toBe('reciter-b-97');
    await expectTapOnPlayPlaysShownTrack(p, 12);
  });

  it('E9: a saved upload track -> it plays from the file of its recitation', async () => {
    startFirstSession();
    mockRecitations.push({id: 'u1', filePath: 'u1.m4a'});
    const upload: Track = {
      id: 'upload-u1',
      url: 'file:///container-old/Documents/uploads/u1.m4a',
      title: 'My upload',
      artist: 'My Recitations',
      reciterId: '',
      reciterName: 'My Recitations',
      isUserUpload: true,
      userRecitationId: 'u1',
    };
    await usePlayerStore.getState().updateQueue([upload], 0);
    progressTick(25);
    await usePlayerStore.getState().pause();

    const p = await restartAndRestore();

    expect(shownTrack()?.url).toBe(
      'file:///container-new/Documents/uploads/u1.m4a',
    );
    expect(shownTrack()?.title).toBe('My upload');
    await expectTapOnPlayPlaysShownTrack(p, 25);
  });

  it('E10: the reciter is no longer in the catalog -> the track keeps its URL and plays', async () => {
    startFirstSession();
    const gone: Track = {
      ...catalogTrack('reciter-a', 3),
      id: 'reciter-gone-3',
      reciterId: 'reciter-gone',
      url: 'https://cdn.example.test/old/003.mp3',
    };
    await usePlayerStore.getState().updateQueue([gone], 0);
    usePlayerStore.getState().updatePlaybackState({position: 4, duration: 300});
    await usePlayerStore.getState().pause();

    const p = await restartAndRestore();

    expect(shownTrack()?.url).toBe('https://cdn.example.test/old/003.mp3');
    await expectTapOnPlayPlaysShownTrack(p, 4);
  });

  it('E11: nothing was played -> no load, and no track to show', async () => {
    const p = await restartAndRestore();
    expect(shownTrack()).toBeUndefined();
    expect(p.replace).not.toHaveBeenCalled();
  });

  it('E12: no saved queue (Settings > Clear cache, a new device) but a recent track -> the recent track rebuilds the queue and plays', async () => {
    startFirstSession();
    useRecentlyPlayedStore
      .getState()
      .startNewChain(catalogReciter('reciter-a'), surah(67), 0.1, 300, 'rw-a');
    await usePlayerStore.getState().cleanup(); // empties the saved queue

    const p = await restartAndRestore();

    expect(usePlayerStore.getState().queue.tracks).toHaveLength(114);
    expect(shownTrack()?.id).toBe('reciter-a:67');
    await expectTapOnPlayPlaysShownTrack(p, 30);
  });

  it('E13: the restored current track gets its title, artist and artwork from the current catalog and language', async () => {
    startFirstSession();
    const stale: Track = {
      ...catalogTrack('reciter-b', 11),
      title: 'Old title',
      artist: 'Old name',
      reciterName: 'Old name',
      artwork: 'old-art',
    };
    await usePlayerStore.getState().updateQueue([stale], 0);
    progressTick(18);
    await usePlayerStore.getState().pause();

    await restartAndRestore();

    expect(shownTrack()).toMatchObject({
      title: 'Surah 11',
      artist: 'Reciter B',
      reciterName: 'Reciter B',
      artwork: 'artwork:reciter-b',
    });
  });

  it('R1: a playlist track whose reciter is BELOW the head recent track -> the restore resumes that track (not the head reciter)', async () => {
    startFirstSession();
    const rs = useRecentlyPlayedStore.getState();
    rs.startNewChain(catalogReciter('reciter-b'), surah(5), 0.5, 300, 'rw-b');
    rs.startNewChain(catalogReciter('reciter-a'), surah(2), 0.1, 300, 'rw-a');
    await usePlayerStore
      .getState()
      .updateQueue(
        [catalogTrack('reciter-b', 11), catalogTrack('reciter-a', 7)],
        0,
      );
    progressTick(18);
    await usePlayerStore.getState().pause();
    expect(useRecentlyPlayedStore.getState().recentTracks[0].reciter.id).toBe(
      'reciter-a',
    );

    const p = await restartAndRestore();

    expect(shownTrack()?.id).toBe('reciter-b-11');
    expect(p.sources).toEqual([cdnUrl('rw-b', 11)]);
    await expectTapOnPlayPlaysShownTrack(p, 18);
  });

  it('R5: the saved position is at the end of the track -> the restore starts it at 0', async () => {
    startFirstSession();
    await usePlayerStore
      .getState()
      .updateQueue([catalogTrack('reciter-b', 11)], 0);
    progressTick(299.5);
    usePlayerStore.getState().updatePlaybackState({state: 'ended'});

    const p = await restartAndRestore();

    expect(p.seekTo).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().playback.position).toBe(0);
  });

  it('R8: a corrupt saved index (out of range) -> no throw, no load, no player shown', async () => {
    startFirstSession();
    await usePlayerStore
      .getState()
      .updateQueue([catalogTrack('reciter-b', 11)], 0);
    usePlayerStore.getState().updateQueueState({currentIndex: 7});

    const p = await restartAndRestore();

    expect(p.replace).not.toHaveBeenCalled();
    expect(shownTrack()).toBeUndefined();
  });

  it('R10: a mixed-rewayah queue keeps each track on its own rewayah', async () => {
    mockCatalog[0].rewayat.push({
      id: 'rw-a2',
      server: 'https://cdn.example.test/rw-a2',
      surah_list: ALL_SURAHS,
    });
    try {
      startFirstSession();
      const a2: Track = {
        ...catalogTrack('reciter-a', 5),
        rewayatId: 'rw-a2',
        url: cdnUrl('rw-a2', 5),
      };
      await usePlayerStore
        .getState()
        .updateQueue([a2, catalogTrack('reciter-b', 7)], 0);
      progressTick(9);
      await usePlayerStore.getState().pause();

      const p = await restartAndRestore();

      expect(usePlayerStore.getState().queue.tracks.map(t => t.url)).toEqual([
        cdnUrl('rw-a2', 5),
        cdnUrl('rw-b', 7),
      ]);
      await expectTapOnPlayPlaysShownTrack(p, 9);
    } finally {
      mockCatalog[0].rewayat.pop();
    }
  });
});

describe('restoreSession — local files (the real URL builder and download store)', () => {
  /** The track that utils/track createDownloadedTrack() builds. */
  function downloadedTrack(
    surahId: number,
    filePath: string,
    rewayatId?: string,
  ): Track {
    return {
      ...catalogTrack('reciter-a', surahId),
      url: `file:///container-new/Documents/${filePath}`,
      rewayatId: rewayatId || 'rw-a',
    };
  }

  async function playFromCollectionDownloads(track: Track): Promise<void> {
    startFirstSession();
    await usePlayerStore.getState().updateQueue([track], 0);
    usePlayerStore
      .getState()
      .updatePlaybackState({position: 40, duration: 300});
    await usePlayerStore.getState().pause();
  }

  it('L1: a download saved with rewayatId "" (SurahOptionsSheet, Loved, PlaylistContextSheet, bulk download) -> the restore keeps the local file', async () => {
    useDownloadStore.setState({
      downloads: [download('reciter-a', 18, '', 'a-18.mp3')],
    });
    await playFromCollectionDownloads(downloadedTrack(18, 'a-18.mp3', ''));

    const p = await restartAndRestore();

    expect(p.sources).toEqual(['file:///container-new/Documents/a-18.mp3']);
  });

  it('L2: the download store has not hydrated when the restore runs -> the restore keeps the local file', async () => {
    useDownloadStore.setState({
      downloads: [download('reciter-a', 18, 'rw-a', 'a-18.mp3')],
    });
    await playFromCollectionDownloads(downloadedTrack(18, 'a-18.mp3', 'rw-a'));
    const saved = useDownloadStore.getState().downloads;

    await restart();
    useDownloadStore.setState({downloads: []}); // not hydrated yet
    await restoreSession();
    useDownloadStore.setState({downloads: saved}); // the hydration lands
    const p = new FakeAudioPlayer();
    inject(p);
    await sleep(150);

    expect(p.sources).toEqual(['file:///container-new/Documents/a-18.mp3']);
  });

  it('L3: the other tracks of a downloads queue keep their local files (Next is not a stream)', async () => {
    useDownloadStore.setState({
      downloads: [
        download('reciter-a', 18, '', 'a-18.mp3'),
        download('reciter-a', 19, '', 'a-19.mp3'),
      ],
    });
    startFirstSession();
    await usePlayerStore.getState().updateQueue(
      [
        downloadedTrack(18, 'a-18.mp3', ''),
        {
          ...downloadedTrack(19, 'a-19.mp3', ''),
          url: 'file:///container-old/Documents/a-19.mp3',
        },
      ],
      0,
    );
    await usePlayerStore.getState().pause();

    const p = await restartAndRestore();
    await usePlayerStore.getState().skipToNext();

    expect(usePlayerStore.getState().queue.tracks.map(t => t.url)).toEqual([
      'file:///container-new/Documents/a-18.mp3',
      'file:///container-new/Documents/a-19.mp3',
    ]);
    expect(p.sources).toEqual([
      'file:///container-new/Documents/a-18.mp3',
      'file:///container-new/Documents/a-19.mp3',
    ]);
    // The file check runs for the current track only.
    expect(FileSystem.getInfoAsync).toHaveBeenCalledTimes(1);
  });
});

describe('playerStore.play() — the shown track has no source (TECH_DEBT #271)', () => {
  it('R3: the restore load throws (offline, a CDN error) -> a tap on Play loads the track and plays it from the saved position', async () => {
    await playlistSessionPaused();
    const p = await restartAndRestore(['throw']);
    expect(expoAudioService.getCurrentUrl()).toBeNull();

    await usePlayerStore.getState().play();

    expect(p.sources).toEqual([cdnUrl('rw-b', 11), cdnUrl('rw-b', 11)]);
    expect(expoAudioService.getCurrentUrl()).toBe(cdnUrl('rw-b', 11));
    expect(p.seekTo).toHaveBeenLastCalledWith(18);
    expect(p.play).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().playback.state).toBe('playing');
  });

  it('R3b: the player reports a load error (a failed stream) -> no source is recorded, and a tap on Play loads it again', async () => {
    await playlistSessionPaused();
    const p = await restartAndRestore(['error-status']);
    expect(expoAudioService.holdsSource(cdnUrl('rw-b', 11))).toBe(false);

    await usePlayerStore.getState().play();

    expect(p.sources).toEqual([cdnUrl('rw-b', 11), cdnUrl('rw-b', 11)]);
    expect(p.play).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().playback.state).toBe('playing');
  });

  it('R3c: a load that times out and reports an error later -> a later tap loads it again', async () => {
    await playlistSessionPaused();
    await restart();
    jest.useFakeTimers();
    try {
      await restoreSession();
      const p = new FakeAudioPlayer();
      p.failures = ['silent'];
      inject(p);
      await jest.advanceTimersByTimeAsync(100 + 5000 + 10);
      // The 5 s wait ended with no answer: the source counts as loaded.
      expect(expoAudioService.getCurrentUrl()).toBe(cdnUrl('rw-b', 11));
      p.emit({error: 'Source error'});
      expect(expoAudioService.getCurrentUrl()).toBeNull();

      const tap = usePlayerStore.getState().play();
      await jest.advanceTimersByTimeAsync(50);
      await tap;

      expect(p.sources).toEqual([cdnUrl('rw-b', 11), cdnUrl('rw-b', 11)]);
      expect(usePlayerStore.getState().playback.state).toBe('playing');
    } finally {
      jest.useRealTimers();
    }
  });

  it('R3d: the load at the tap fails too (still offline) -> no play, Play shows, the loading state ends', async () => {
    await playlistSessionPaused();
    const p = await restartAndRestore(['error-status', 'error-status']);

    await usePlayerStore.getState().play();

    expect(p.play).not.toHaveBeenCalled();
    const state = usePlayerStore.getState();
    expect(state.playback.state).toBe('paused');
    expect(state.loading.trackLoading).toBe(false);
  });

  it('R4: the player store hydrates after the 3 s wait (the #218 gap) -> a tap on Play loads and plays the shown track', async () => {
    await playlistSessionPaused();
    await sleep(10);
    const persistedQueue = usePlayerStore.getState().queue;
    const persistedPlayback = usePlayerStore.getState().playback;
    expoAudioService.reset();
    usePlayerStore.getState().reset();
    const hasHydrated = jest
      .spyOn(usePlayerStore.persist, 'hasHydrated')
      .mockReturnValue(false);
    const onFinish = jest
      .spyOn(usePlayerStore.persist, 'onFinishHydration')
      .mockImplementation(() => () => undefined);
    jest.useFakeTimers();
    try {
      const restore = restoreSession(); // waits 3 s, sees an empty queue
      await jest.advanceTimersByTimeAsync(3000);
      await restore;
    } finally {
      jest.useRealTimers();
      hasHydrated.mockRestore();
      onFinish.mockRestore();
    }
    // The late hydration lands.
    usePlayerStore.setState({
      queue: persistedQueue,
      playback: persistedPlayback,
    });
    const p = new FakeAudioPlayer();
    inject(p);
    expect(shownTrack()?.id).toBe('reciter-b-11');

    await usePlayerStore.getState().play();

    expect(p.sources).toEqual([cdnUrl('rw-b', 11)]);
    expect(p.seekTo).toHaveBeenCalledWith(18);
    expect(p.play).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().playback.state).toBe('playing');
  });
});

describe('restoreSession — the Sprint 45 guarantees on the saved-queue path', () => {
  async function playlistSessionThenRestartWithoutPlayer(): Promise<void> {
    startFirstSession();
    await usePlayerStore
      .getState()
      .updateQueue([catalogTrack('reciter-b', 11)], 0);
    progressTick(18);
    await usePlayerStore.getState().pause();
    await restartWithoutPlayer();
  }

  it('G1: a user pick while the restore load waits -> only the user track loads, no restore seek', async () => {
    await playlistSessionThenRestartWithoutPlayer();
    const pick = catalogTrack('reciter-a', 1);
    const update = usePlayerStore.getState().updateQueue([pick], 0);
    await sleep(10);

    const p = new FakeAudioPlayer();
    inject(p);
    await update;
    await sleep(50);

    expect(p.sources).toEqual([pick.url]);
    expect(p.seekTo).not.toHaveBeenCalledWith(18);
    expect(shownTrack()?.url).toBe(pick.url);
  });

  it('G2: Settings > Clear cache while the restore load waits -> no load, no play, no player shown', async () => {
    await playlistSessionThenRestartWithoutPlayer();
    await usePlayerStore.getState().cleanup();

    const p = new FakeAudioPlayer();
    inject(p);
    await sleep(50);

    expect(p.replace).not.toHaveBeenCalled();
    expect(p.play).not.toHaveBeenCalled();
    expect(shownTrack()).toBeUndefined();
  });

  it('G3: an early tap on Play while the restore load waits -> one load, then play from the saved position', async () => {
    await playlistSessionThenRestartWithoutPlayer();
    const tap = usePlayerStore.getState().play();
    await sleep(10);
    expect(usePlayerStore.getState().playback.state).not.toBe('playing');

    const p = new FakeAudioPlayer();
    inject(p);
    await tap;
    await sleep(50);

    expect(p.sources).toEqual([cdnUrl('rw-b', 11)]);
    expect(p.play).toHaveBeenCalledTimes(1);
    expect(p.replace.mock.invocationCallOrder[0]).toBeLessThan(
      p.play.mock.invocationCallOrder[0],
    );
    expect(p.seekTo).toHaveBeenCalledWith(18);
    expect(usePlayerStore.getState().playback.state).toBe('playing');
  });

  it('G4: a pause during the load that play() starts -> no play when the load ends', async () => {
    await playlistSessionPaused();
    const p = await restartAndRestore(['throw']); // the restore load failed
    p.replace.mockImplementationOnce(async (source: {uri: string}) => {
      p.sources.push(source.uri);
      setTimeout(() => {
        p.emit({isLoaded: false});
        p.emit({isLoaded: true});
      }, 30);
    });

    const tap = usePlayerStore.getState().play();
    await sleep(5);
    await usePlayerStore.getState().pause();
    await tap;

    expect(p.play).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().playback.state).toBe('paused');
    expect(usePlayerStore.getState().loading.trackLoading).toBe(false);
  });

  it('R6: removeFromQueue of the CURRENT track while the restore load waits -> only the next track loads, no restore seek', async () => {
    startFirstSession();
    await usePlayerStore
      .getState()
      .updateQueue(
        [
          catalogTrack('reciter-b', 11),
          catalogTrack('reciter-a', 2),
          catalogTrack('reciter-b', 3),
        ],
        0,
      );
    progressTick(18);
    await usePlayerStore.getState().pause();
    await restartWithoutPlayer();
    const removal = usePlayerStore.getState().removeFromQueue([0]);
    await sleep(10);
    const p = new FakeAudioPlayer();
    inject(p);
    await removal;
    await sleep(50);

    expect(p.sources).toEqual([cdnUrl('rw-a', 2)]);
    expect(p.seekTo).not.toHaveBeenCalledWith(18);
    expect(shownTrack()?.id).toBe('reciter-a-2');
    await usePlayerStore.getState().play();
    expect(p.sources).toEqual([cdnUrl('rw-a', 2)]);
  });

  it('R7: removeFromQueue of a track BEFORE the current one while the restore load waits -> the restore still loads and seeks the current track', async () => {
    startFirstSession();
    await usePlayerStore
      .getState()
      .updateQueue(
        [
          catalogTrack('reciter-a', 2),
          catalogTrack('reciter-b', 11),
          catalogTrack('reciter-b', 3),
        ],
        1,
      );
    progressTick(18);
    await usePlayerStore.getState().pause();
    await restartWithoutPlayer();
    await usePlayerStore.getState().removeFromQueue([0]);
    const p = new FakeAudioPlayer();
    inject(p);
    await sleep(80);

    expect(shownTrack()?.id).toBe('reciter-b-11');
    expect(p.sources).toEqual([cdnUrl('rw-b', 11)]);
    expect(p.seekTo).toHaveBeenCalledWith(18);
  });

  it('R9: the app is killed after Phase 1 of the restore -> the next restore still loads the shown track', async () => {
    startFirstSession();
    await usePlayerStore
      .getState()
      .updateQueue([catalogTrack('reciter-b', 11)], 0);
    progressTick(18);
    await usePlayerStore.getState().pause();
    await restartWithoutPlayer(); // killed before setPlayer: no load

    const p = await restartAndRestore();

    await expectTapOnPlayPlaysShownTrack(p, 18);
  });
});

describe('playerStore.play() — a load of the shown track still runs (second review, 2026-10-18)', () => {
  /** Restart with the saved queue and no restore load: no source yet. */
  async function restartNoSource(
    failures: LoadFailure[] = [],
  ): Promise<FakeAudioPlayer> {
    await restart();
    const p = new FakeAudioPlayer();
    p.failures = failures;
    inject(p);
    return p;
  }

  it('N1: an early tap while the restore load waits, and that load fails -> no play, Play shows', async () => {
    await playlistSessionPaused();
    await restartWithoutPlayer(); // the restore load waits for the player
    const tap = usePlayerStore.getState().play();
    await sleep(10);
    const p = new FakeAudioPlayer();
    p.failures = ['error-status'];
    inject(p);
    await tap;
    await sleep(60);

    expect(expoAudioService.getCurrentUrl()).toBeNull();
    expect(p.play).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().playback.state).toBe('paused');
    expect(usePlayerStore.getState().loading.trackLoading).toBe(false);
  });

  it('N2: a double tap during the load that play() starts -> one load, the seek to the saved position before player.play()', async () => {
    await playlistSessionPaused();
    const p = await restartNoSource();
    const t1 = usePlayerStore.getState().play();
    expect(usePlayerStore.getState().playback.state).toBe('loading');
    const t2 = usePlayerStore.getState().play();
    await Promise.all([t1, t2]);
    await sleep(30);

    expect(p.sources).toEqual([cdnUrl('rw-b', 11)]);
    expect(p.seekTo).toHaveBeenCalledWith(18);
    expect(p.seekTo.mock.invocationCallOrder[0]).toBeLessThan(
      p.play.mock.invocationCallOrder[0],
    );
    expect(usePlayerStore.getState().playback.state).toBe('playing');
    expect(usePlayerStore.getState().loading.trackLoading).toBe(false);
  });

  it('N3: a double tap during the load that play() starts, and the load fails -> no play, Play shows', async () => {
    await playlistSessionPaused();
    const p = await restartNoSource(['error-status']);
    const t1 = usePlayerStore.getState().play();
    const t2 = usePlayerStore.getState().play();
    await Promise.all([t1, t2]);
    await sleep(30);

    expect(p.play).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().playback.state).toBe('paused');
    expect(usePlayerStore.getState().loading.trackLoading).toBe(false);
  });

  // The review's N7 expected 'playing' after updateQueue() alone. updateQueue()
  // settles 'ready' after its autoplay load, here and upstream, and the UI
  // calls play() next. So the checks here are the source and the next play().
  it('N7: an error event of the PREVIOUS source arrives after the new load starts to listen -> the new source counts, and play() does not load it again', async () => {
    startFirstSession();
    await usePlayerStore
      .getState()
      .updateQueue([catalogTrack('reciter-b', 11)], 0);
    expect(expoAudioService.getCurrentUrl()).toBe(cdnUrl('rw-b', 11));
    const replace = player.replace.getMockImplementation();
    if (!replace) throw new Error('no replace mock');
    player.replace.mockImplementationOnce(async (src: {uri: string}) => {
      player.emit({error: 'old source: connection reset'}); // queued for B:11
      return replace(src);
    });

    await usePlayerStore
      .getState()
      .updateQueue([catalogTrack('reciter-a', 2)], 0);
    await sleep(30);
    expect(expoAudioService.getCurrentUrl()).toBe(cdnUrl('rw-a', 2));

    await usePlayerStore.getState().play();
    expect(player.sources).toEqual([cdnUrl('rw-b', 11), cdnUrl('rw-a', 2)]);
    expect(usePlayerStore.getState().playback.state).toBe('playing');
  });

  it('N7b: an error with no sign that the new source loads -> the load counts as failed at the timeout', async () => {
    jest.useFakeTimers();
    try {
      startFirstSession();
      // @ai QP-07: load one track first. The first source of a player ends
      // at once on an error status (no earlier source can send it), so only
      // a later load tests the 500 ms rule for an early error.
      const first = expoAudioService.loadTrack(cdnUrl('rw-a', 2));
      await jest.advanceTimersByTimeAsync(10);
      await first;
      expect(expoAudioService.holdsSource(cdnUrl('rw-a', 2))).toBe(true);

      player.replace.mockImplementationOnce(async (src: {uri: string}) => {
        player.sources.push(src.uri);
        player.emit({error: 'Source error'}); // at once, before isLoaded:false
      });
      const load = expoAudioService.loadTrack(cdnUrl('rw-b', 11));
      const settled = jest.fn(); // @ai
      load.then(settled, settled); // @ai
      await jest.advanceTimersByTimeAsync(100); // @ai
      expect(settled).not.toHaveBeenCalled(); // @ai the error can be old
      await jest.advanceTimersByTimeAsync(4900);
      await load;

      expect(expoAudioService.getCurrentUrl()).toBeNull();
      expect(expoAudioService.holdsSource(cdnUrl('rw-b', 11))).toBe(false);
      expect(expoAudioService.getPlaybackState()).toBe('error'); // @ai
    } finally {
      jest.useRealTimers();
    }
  });

  it('M1: the load that play() starts times out, plays, then reports an error -> Play shows again, and the next Play loads the track', async () => {
    await playlistSessionPaused();
    const p = await restartNoSource(['silent']);
    jest.useFakeTimers();
    try {
      const tap = usePlayerStore.getState().play();
      await jest.advanceTimersByTimeAsync(5000 + 20);
      await tap;
      // The 5 s wait ended with no answer: the source counts as held.
      expect(usePlayerStore.getState().playback.state).toBe('playing');

      p.emit({error: 'Source error'}); // the late error

      expect(expoAudioService.getCurrentUrl()).toBeNull();
      expect(usePlayerStore.getState().playback.state).toBe('paused');
      const next = usePlayerStore.getState().play();
      await jest.advanceTimersByTimeAsync(50);
      await next;
      expect(p.sources).toEqual([cdnUrl('rw-b', 11), cdnUrl('rw-b', 11)]);
      expect(usePlayerStore.getState().playback.state).toBe('playing');
    } finally {
      jest.useRealTimers();
    }
  });

  it('M4: a seek during the load that play() starts -> the user seek wins over the saved position', async () => {
    await playlistSessionPaused();
    const p = await restartNoSource();
    const tap = usePlayerStore.getState().play();
    await usePlayerStore.getState().seekTo(100);
    await tap;
    await sleep(20);

    expect(p.currentTime).toBe(100);
    expect(p.seekTo).not.toHaveBeenLastCalledWith(18);
    expect(usePlayerStore.getState().playback.state).toBe('playing');
  });
});

// @ai-start QP-07 / PLY-04 (Sprint 50). On the test iPhone (Release build), a
// tap on Play in the restored mini player at once after a cold start showed
// Play for more than 3 s, then Pause (3 of 3 on the baseline build). On iOS,
// expo-audio sends no isLoaded:false after replace(). It sends one
// isLoaded:true when the item is ready, and no other status while the player
// has never played. The restore load is the first source of a new player, and
// waitForLoaded() ignored an isLoaded:true in its first 500 ms, so a source
// that was ready sooner waited for the 5 s load timeout. The tap waits for
// that load (TECH_DEBT #271), so it played about 5 s late.

/** A load as iOS reports it: only isLoaded:true, `readyAfterMs` later. */
function iosShaped(p: FakeAudioPlayer, readyAfterMs: number): FakeAudioPlayer {
  p.replace.mockImplementation(async (source: {uri: string}) => {
    p.sources.push(source.uri);
    p.isLoaded = false;
    p.currentTime = 0;
    setTimeout(() => {
      p.isLoaded = true;
      p.duration = 300;
      p.emit({isLoaded: true});
    }, readyAfterMs);
  });
  return p;
}

describe('restoreSession — QP-07: a tap on Play right after a cold start (iOS load status)', () => {
  // Fake timers from the restore on: the 100 ms restore timer, the 200 ms
  // load and the 5 s load timeout run on the test clock, not on the machine.
  it('Q1: a tap during the restore load plays when that load ends, not after the 5 s load timeout', async () => {
    await playlistSessionPaused();
    await restart();
    jest.useFakeTimers();
    try {
      await restoreSession();
      const p = iosShaped(new FakeAudioPlayer(), 200);
      inject(p);
      // The 100 ms restore timer fires: the restore load runs until 300 ms.
      await jest.advanceTimersByTimeAsync(150);

      const shownUrl = shownTrack()?.url ?? '';
      expect(p.sources).toEqual([shownUrl]);
      expect(expoAudioService.runningLoad(shownUrl)).not.toBeNull();
      expect(p.play).not.toHaveBeenCalled();

      const tap = usePlayerStore.getState().play();
      // To 350 ms: after the restore load ends, before the 500 ms window ends
      // and long before the 5 s load timeout.
      await jest.advanceTimersByTimeAsync(200);

      expect(p.play).toHaveBeenCalledTimes(1);
      expect(usePlayerStore.getState().playback.state).toBe('playing');
      expect(p.sources).toEqual([shownUrl]); // The tap used the restore load.
      expect(p.seekTo).toHaveBeenCalledWith(18);
      await tap;
    } finally {
      jest.useRealTimers();
    }
  });

  it('Q2: a tap before the restore load starts loads the shown track and plays when that load ends', async () => {
    await playlistSessionPaused();
    await restart();
    jest.useFakeTimers();
    try {
      await restoreSession();
      const p = iosShaped(new FakeAudioPlayer(), 200);
      inject(p);

      const tap = usePlayerStore.getState().play();
      // To 250 ms: the load of the tap ends at 200 ms.
      await jest.advanceTimersByTimeAsync(250);

      const shownUrl = shownTrack()?.url ?? '';
      expect(p.play).toHaveBeenCalledTimes(1);
      expect(usePlayerStore.getState().playback.state).toBe('playing');
      // One load: the restore skipped its load, and the play owns the load.
      expect(p.sources).toEqual([shownUrl]);
      expect(p.seekTo).toHaveBeenCalledWith(18);
      await tap;
    } finally {
      jest.useRealTimers();
    }
  });
});
// @ai-end
