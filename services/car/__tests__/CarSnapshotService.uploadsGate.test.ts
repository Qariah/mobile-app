// @ai
// Qariah (Sprint 46, Pass B review M1): the car snapshot service starts at
// every cold start. With user uploads off it must not load the uploads, because
// that opens the uploads DB in the boot window (the S38.2 skip,
// services/qariahInitConfig.ts).

const mockFlags: Record<string, boolean> = {userUploads: false};
jest.mock('@/config/featureFlags', () => ({
  isFeatureEnabled: (flag: string) => mockFlags[flag] ?? false,
}));
const mockWriteSnapshot = jest.fn();
jest.mock('@/modules/bayaan-car', () => ({
  BayaanCar: {
    isAvailable: true,
    writeSnapshot: (json: string) => mockWriteSnapshot(json),
    addConnectionListener: () => () => undefined,
  },
}));
jest.mock('@/config/branding', () => ({}));
let mockSessionGate: () => Promise<void> = () => Promise.resolve();
jest.mock('@/services/car/sessionGate', () => ({
  waitForSessionRestored: () => mockSessionGate(),
}));
jest.mock('@/data/reciterData', () => ({RECITERS: []}));
jest.mock('@/data/surahData', () => ({SURAHS: []}));
jest.mock('@/data/systemPlaylists', () => ({getSystemPlaylists: () => []}));
jest.mock('@/data/juzData', () => ({SURAH_TO_JUZ: {}}));
jest.mock('@/utils/reciterImages', () => ({reciterImages: {}}));
jest.mock('@/utils/artworkUtils', () => ({formatReciterName: jest.fn()}));

function mockStore(state: object) {
  return {getState: () => state, subscribe: () => () => undefined};
}
jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  useRecentlyPlayedStore: mockStore({recentTracks: []}),
}));
jest.mock('@/services/player/store/lovedStore', () => ({
  useLovedStore: mockStore({tracks: []}),
}));
jest.mock('@/services/player/store/downloadStore', () => ({
  useDownloadStore: mockStore({downloads: []}),
}));
jest.mock('@/services/player/store/favoriteRecitersStore', () => ({
  useFavoriteRecitersStore: mockStore({favoriteReciterIds: []}),
}));
jest.mock('@/store/playlistsStore', () => ({
  usePlaylistsStore: mockStore({playlists: [], getPlaylistItems: jest.fn()}),
}));
jest.mock('@/store/reciterStore', () => ({
  useReciterStore: mockStore({defaultReciter: {id: ''}}),
}));
const mockLoadRecitations = jest.fn(() => Promise.resolve());
jest.mock('@/store/uploadsStore', () => ({
  useUploadsStore: mockStore({
    // The store's initial state: nothing loaded yet.
    loading: true,
    isLoading: false,
    recitations: [],
    customReciters: [],
    loadRecitations: () => mockLoadRecitations(),
    loadCustomReciters: () => Promise.resolve(),
  }),
}));
jest.mock('@/services/analytics/LocalAggregationStore', () => ({
  localAggregationStore: {getDailyAggregate: () => null},
}));
const mockBuild = jest.fn();
jest.mock('@/services/car/snapshot/buildCarSnapshot', () => ({
  buildCarSnapshot: () => ({
    _built: mockBuild(),
    version: 1,
    generatedAt: '',
    topReciterId: null,
    home: {sections: []},
    library: [],
    lists: {},
    reciters: [],
    surahs: [],
    juz: [],
    downloadedKeys: [],
  }),
}));

import {startCarSnapshotService} from '../CarSnapshotService';

describe('startCarSnapshotService and the uploads DB', () => {
  beforeEach(() => mockLoadRecitations.mockClear());

  it('does not load the uploads when user uploads are off', async () => {
    mockFlags.userUploads = false;
    const service = startCarSnapshotService();
    await service.ready;
    service.stop();
    expect(mockLoadRecitations).not.toHaveBeenCalled();
  });

  it('loads the uploads when user uploads are on (upstream behaviour)', async () => {
    mockFlags.userUploads = true;
    const service = startCarSnapshotService();
    await service.ready;
    service.stop();
    expect(mockLoadRecitations).toHaveBeenCalledTimes(1);
  });
});

describe('startCarSnapshotService first write (Sprint 46 review)', () => {
  it('waits for the restored session before it builds the snapshot', async () => {
    mockFlags.userUploads = false;
    mockBuild.mockClear();
    let restore: () => void = () => undefined;
    mockSessionGate = () =>
      new Promise<void>(resolve => {
        restore = resolve;
      });

    const service = startCarSnapshotService();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockBuild).not.toHaveBeenCalled();

    restore();
    await service.ready;
    service.stop();
    // writeCarSnapshotNow() skips the native write when nothing changed since
    // the earlier tests, so count the builds.
    expect(mockBuild).toHaveBeenCalledTimes(1);
    mockSessionGate = () => Promise.resolve();
  });
});
