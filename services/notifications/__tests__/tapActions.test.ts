// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): "continue listening" resumes the last
// session: the restored queue, else the most recent entry.
const mockPlayer = {
  sheetMode: 'hidden' as string,
  queue: {tracks: [] as unknown[], currentIndex: 0},
  updateQueue: jest.fn(async () => undefined),
};
const mockRecent = {recentTracks: [] as unknown[]};

jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: {getState: () => mockPlayer},
}));
jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  useRecentlyPlayedStore: {getState: () => mockRecent},
}));
jest.mock('@/services/player/sheetRef', () => ({
  expandPlayerSheet: jest.fn(),
  closePlayerSheet: jest.fn(),
}));
jest.mock('@/services/player/utils/playRecitation', () => ({
  playRecitation: jest.fn(),
}));
jest.mock('@/services/player/utils/resumeRecent', () => ({
  resumeRecent: jest.fn(async () => undefined),
}));
jest.mock('@/services/widgets/handleWidgetCommand', () => ({
  handleWidgetCommand: jest.fn(async () => undefined),
}));
jest.mock('@/services/dataService', () => ({
  getReciterByIdSync: jest.fn(),
  getReciterBySlug: jest.fn(),
}));
jest.mock('@/services/car/sessionGate', () => ({
  waitForSessionRestored: jest.fn(async () => undefined),
}));
jest.mock('@/services/closeSheetsBeforeLink', () => ({
  closeOpenSheets: jest.fn(async () => undefined),
}));

import {appTapDeps, resumeLastSession} from '../tapActions';

const {expandPlayerSheet} = jest.requireMock('@/services/player/sheetRef') as {
  expandPlayerSheet: jest.Mock;
};
const {resumeRecent} = jest.requireMock(
  '@/services/player/utils/resumeRecent',
) as {resumeRecent: jest.Mock};
const {handleWidgetCommand} = jest.requireMock(
  '@/services/widgets/handleWidgetCommand',
) as {handleWidgetCommand: jest.Mock};

beforeEach(() => {
  jest.clearAllMocks();
  mockPlayer.queue = {tracks: [], currentIndex: 0};
  mockRecent.recentTracks = [];
});

describe('resumeLastSession', () => {
  it('plays the restored queue as the widget Play button does, and opens the player', async () => {
    mockPlayer.queue = {tracks: [{id: 'r:18'}], currentIndex: 0};
    await expect(resumeLastSession()).resolves.toBe(true);
    expect(handleWidgetCommand).toHaveBeenCalledWith({
      type: 'setPlayback',
      playing: true,
    });
    expect(resumeRecent).not.toHaveBeenCalled();
    expect(expandPlayerSheet).toHaveBeenCalled();
  });

  it('with no queue, resumes the most recent entry at its saved position', async () => {
    mockRecent.recentTracks = [
      {
        reciter: {id: 'r1'},
        surah: {id: 18},
        rewayatId: 'w1',
        progress: 0.5,
        duration: 600,
      },
    ];
    await expect(resumeLastSession()).resolves.toBe(true);
    expect(resumeRecent).toHaveBeenCalledWith(
      expect.objectContaining({
        reciterId: 'r1',
        surahId: 18,
        rewayatId: 'w1',
        startPosition: 300,
        recentIndex: 0,
      }),
    );
    expect(expandPlayerSheet).toHaveBeenCalled();
  });

  it('gives false with nothing to resume (or an upload)', async () => {
    await expect(resumeLastSession()).resolves.toBe(false);
    mockRecent.recentTracks = [{isUserUpload: true}];
    await expect(resumeLastSession()).resolves.toBe(false);
    expect(expandPlayerSheet).not.toHaveBeenCalled();
  });
});

describe('appTapDeps', () => {
  it('closes the player only when the full sheet shows', () => {
    const {closePlayerSheet} = jest.requireMock(
      '@/services/player/sheetRef',
    ) as {closePlayerSheet: jest.Mock};
    const deps = appTapDeps({push: jest.fn(), navigate: jest.fn()}, () => true);
    mockPlayer.sheetMode = 'hidden';
    deps.closePlayer();
    expect(closePlayerSheet).not.toHaveBeenCalled();
    mockPlayer.sheetMode = 'full';
    deps.closePlayer();
    expect(closePlayerSheet).toHaveBeenCalledTimes(1);
  });

  it('closes the sheets as a link does (TECH_DEBT #261)', async () => {
    const {closeOpenSheets} = jest.requireMock(
      '@/services/closeSheetsBeforeLink',
    ) as {closeOpenSheets: jest.Mock};
    const deps = appTapDeps({push: jest.fn(), navigate: jest.fn()}, () => true);
    await deps.closeSheets();
    expect(closeOpenSheets).toHaveBeenCalledTimes(1);
  });
});
