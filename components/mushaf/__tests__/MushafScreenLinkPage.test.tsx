// @ai-generated
/**
 * Qariah (Sprint 47 Task 10, TECH_DEBT #281): a link to the open Mushaf
 * reader (app/mushaf.tsx). A warm qariah://mushaf?page=N, or a link route's
 * dismissTo, gives the reader route new params without a remount; the screen
 * then asks the open viewer to turn (mushafNavigationStore.requestId rises).
 * A surah-only link (qariah://quran/86) also names its surah, so the header
 * shows At-Tariq on page 591, where At-Tariq and Al-A'la start.
 * Lives outside app/ because every file there is bundled as a route.
 */
import React, {act} from 'react';
import TestRenderer from 'react-test-renderer';

const mockRoute: {params: Record<string, string>} = {params: {}};

jest.mock('expo-router', () => ({
  Stack: {Toolbar: () => null},
  useLocalSearchParams: () => mockRoute.params,
  useRoute: () => mockRoute,
}));

jest.mock('expo-screen-orientation', () => ({
  unlockAsync: jest.fn(),
  lockAsync: jest.fn(),
  OrientationLock: {PORTRAIT_UP: 1},
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({theme: {colors: {background: '#fff', text: '#111'}}}),
}));

jest.mock('@/hooks/useGlassProps', () => ({USE_GLASS: false}));

// The viewer is not under test: the request it reads is.
jest.mock('@/components/mushaf/main', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/services/mushaf/DigitalKhattDataService', () => ({
  digitalKhattDataService: {
    initialized: true,
    rewayah: 'hafs',
    getSurahStartPages: () => ({1: 1, 86: 591, 87: 591}),
    switchRewayah: jest.fn(() => Promise.resolve()),
    subscribeCacheChanges: () => () => undefined,
    getCacheVersion: () => 0,
  },
}));

jest.mock('@/services/mushaf/MushafPreloadService', () => ({
  mushafPreloadService: {
    state: 'ready',
    subscribe: () => () => undefined,
    initialize: () => Promise.resolve(),
  },
}));

jest.mock('@/services/mushaf/MushafSessionStore', () => ({
  mushafSessionStore: {setLastScreenWasMushaf: jest.fn()},
}));

jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {show: jest.fn()},
}));

jest.mock('@/utils/toastUtils', () => ({showToast: jest.fn()}));

// mushafPlayerStore's playback dependencies (not exercised here)
jest.mock('expo-audio', () => ({createAudioPlayer: jest.fn()}));
jest.mock('@/services/audio/AudioCoordinator', () => ({
  audioCoordinator: {mushafWillPlay: jest.fn(), sourceDidStop: jest.fn()},
}));
jest.mock('@/data/reciterData', () => ({RECITERS: []}));
jest.mock('@/services/timestamps/TimestampService', () => ({
  timestampService: {getTimestampsForSurah: async () => null},
}));
jest.mock('@/services/timestamps/TimestampFetchService', () => ({
  timestampFetchService: {hasSurah: () => true, hasSource: () => true},
}));

jest.mock('@/services/mushaf/MushafVerseMapService', () => ({
  mushafVerseMapService: {
    getOrderedVerseKeysForPage: () => [],
    isShownVerseUnitsPending: () => false,
  },
  selectionForAnchor: () => null,
  whenShownVerseUnitsResolved: () => Promise.resolve(),
}));

import MushafScreen from '@/app/mushaf';
import {useMushafNavigationStore} from '@/store/mushafNavigationStore';

declare const global: {IS_REACT_ACT_ENVIRONMENT?: boolean};
global.IS_REACT_ACT_ENVIRONMENT = true;

let renderer: TestRenderer.ReactTestRenderer | null = null;
let errorSpy: jest.SpyInstance;

/** The reader route gets params: at mount, or from a link (a new object). */
function route(params: Record<string, string>): void {
  mockRoute.params = params;
  act(() => {
    if (renderer) renderer.update(<MushafScreen />);
    else renderer = TestRenderer.create(<MushafScreen />);
  });
}

const request = () => useMushafNavigationStore.getState();

beforeEach(() => {
  jest.useFakeTimers();
  useMushafNavigationStore.setState({
    targetPage: null,
    targetVerseKey: null,
    targetSurahId: null,
    requestId: 0,
  });
  // react-test-renderer prints a deprecation notice under React 19.
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  errorSpy.mockRestore();
  jest.useRealTimers();
});

it('the mount asks for nothing: the viewer opens on the page itself', () => {
  route({page: '50'});
  expect(request().requestId).toBe(0);
});

it('a page link to the open reader asks the viewer for that page', () => {
  route({page: '50'});
  route({page: '100'});
  expect(request()).toMatchObject({
    requestId: 1,
    targetPage: 100,
    targetSurahId: null,
  });
});

it('a second link to the same page asks again (the reader may have turned)', () => {
  route({page: '50'});
  route({page: '50'});
  expect(request().requestId).toBe(1);
});

it('a surah link asks for its first page and names the surah', () => {
  route({page: '50'});
  route({surah: '86'});
  expect(request()).toMatchObject({
    requestId: 1,
    targetPage: 591,
    targetSurahId: 86,
  });
});

it('an ayah link (with its page) asks for the page and no surah', () => {
  route({page: '50'});
  route({surah: '86', ayah: '1', page: '591'});
  expect(request()).toMatchObject({
    requestId: 1,
    targetPage: 591,
    targetSurahId: null,
  });
});
