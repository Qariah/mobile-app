/**
 * @ai TECH_DEBT #276: a queued track gets its URL rebuilt when it loads.
 *
 * The contract: loadTrackAtIndex asks the registered resolver for the URL,
 * writes a new URL into the queue BEFORE it calls loadTrack() (no await in
 * between, so play() never sees a load that is not running yet), and loads
 * the new URL. No resolver, a null answer or a throw keeps the queued URL.
 */

const mockLoadTrack = jest.fn((_url: string) => Promise.resolve());
jest.mock('@/services/audio/ExpoAudioService', () => ({
  expoAudioService: {
    loadTrack: (url: string) => mockLoadTrack(url),
    play: jest.fn(() => Promise.resolve(true)),
    pause: jest.fn(() => Promise.resolve()),
    seekTo: jest.fn(() => Promise.resolve()),
    getDuration: jest.fn(() => 120),
    getIsLoaded: jest.fn(() => true),
    holdsSource: jest.fn(() => true),
    runningLoad: jest.fn(() => null),
    getCurrentTime: jest.fn(() => 0),
    getPosition: jest.fn(() => 0),
    getIsPlaying: jest.fn(() => false),
    setRate: jest.fn(),
    cleanup: jest.fn(),
  },
}));
jest.mock('@/services/audio/AudioCoordinator', () => ({
  audioCoordinator: {mainWillPlay: jest.fn()},
}));
jest.mock('@/services/analytics/AnalyticsService', () => ({
  analyticsService: {
    trackPlaybackSkipped: jest.fn(),
    trackPlaybackSeeked: jest.fn(),
    trackRateChanged: jest.fn(),
  },
}));
jest.mock('@/services/diagnostics/diagnostics', () => ({
  diagBreadcrumb: jest.fn(),
}));
jest.mock('@/services/diagnostics/playbackHealth', () => ({
  notePlaybackAutoPlayLoad: jest.fn(),
}));
// The real module starts a module-level interval that keeps Jest from exiting.
jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
}));

import {usePlayerStore, setTrackUrlResolver} from '../playerStore';
import type {Track} from '@/types/audio';

function makeTrack(id: string, url = `https://old.example.com/${id}.mp3`) {
  return {
    id,
    url,
    title: `Track ${id}`,
    artist: 'Reciter',
    reciterId: 'r1',
    reciterName: 'Reciter',
    surahId: id,
    rewayatId: 'hafs',
  } as Track;
}

const queueUrls = () => usePlayerStore.getState().queue.tracks.map(t => t.url);

describe('playerStore: the URL of a queued track is rebuilt at load (TECH_DEBT #276)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePlayerStore.getState().reset();
    setTrackUrlResolver(null);
  });
  afterAll(() => setTrackUrlResolver(null));

  it('no resolver: the queued URL loads, as before', async () => {
    await usePlayerStore.getState().updateQueue([makeTrack('1')], 0);
    expect(mockLoadTrack).toHaveBeenCalledWith('https://old.example.com/1.mp3');
  });

  it('a new URL goes into the queue before loadTrack() runs, and loads', async () => {
    setTrackUrlResolver(t => `https://new.example.com/${t.id}.mp3`);
    const urlsAtLoad: string[][] = [];
    mockLoadTrack.mockImplementationOnce(() => {
      urlsAtLoad.push(queueUrls());
      return Promise.resolve();
    });

    await usePlayerStore
      .getState()
      .updateQueue([makeTrack('1'), makeTrack('2')], 0);

    expect(mockLoadTrack).toHaveBeenCalledWith('https://new.example.com/1.mp3');
    expect(urlsAtLoad).toEqual([
      ['https://new.example.com/1.mp3', 'https://old.example.com/2.mp3'],
    ]);

    // Next rebuilds the next track the same way.
    await usePlayerStore.getState().skipToNext();
    expect(mockLoadTrack).toHaveBeenLastCalledWith(
      'https://new.example.com/2.mp3',
    );
    expect(queueUrls()).toEqual([
      'https://new.example.com/1.mp3',
      'https://new.example.com/2.mp3',
    ]);
  });

  it('a null answer keeps the queued URL and writes nothing', async () => {
    setTrackUrlResolver(() => null);
    await usePlayerStore.getState().updateQueue([makeTrack('1')], 0);
    const tracks = usePlayerStore.getState().queue.tracks;

    await usePlayerStore.getState().skipToPrevious();

    expect(mockLoadTrack).toHaveBeenCalledWith('https://old.example.com/1.mp3');
    expect(usePlayerStore.getState().queue.tracks).toBe(tracks);
  });

  it('a resolver that throws keeps the queued URL', async () => {
    setTrackUrlResolver(() => {
      throw new Error('catalog not ready');
    });
    await usePlayerStore.getState().updateQueue([makeTrack('1')], 0);
    expect(mockLoadTrack).toHaveBeenCalledWith('https://old.example.com/1.mp3');
    expect(queueUrls()).toEqual(['https://old.example.com/1.mp3']);
  });
});
