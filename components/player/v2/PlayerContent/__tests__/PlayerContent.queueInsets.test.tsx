// @ai
// TECH_DEBT #307 — the wiring of the #295 queue insets in PlayerContent.
//
// PlayerContent measures the floating header and the floating controls with
// `onLayout`, and passes the two edges to QueueList:
//   contentPaddingTop    = insets.top + moderateScale(4) + headerHeight
//   contentPaddingBottom = moderateScale(20) + controlsHeight
// QueueList.removeButton.test.tsx tests the padding that QueueList applies. No
// other test renders PlayerContent, so a change to the measured heights could
// bring #295 back (the queue under the header and the controls) and pass.
//
// This test RENDERS PlayerContent, opens the queue, sends `layout` events to
// the header and the controls, and reads the props that QueueList receives.
// QueueList, QuranView and the other children are stubs; the stores, the
// hooks, reanimated, gesture-handler and the bottom sheet are stubs too.
//
// How the test finds the two overlays: PlayerContent has no testID on them.
// The header stub (`mock-header`) and the track-info stub (`mock-track-info`)
// are the children of the header overlay and of the controls overlay. The
// test walks up from each stub to the nearest host view with an `onLayout`
// handler. That is the overlay view itself.

import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react-native';
import type {ReactTestInstance} from 'react-test-renderer';
import {moderateScale} from 'react-native-size-matters';

const mockInsets = {top: 47, bottom: 34, left: 0, right: 0};

const mockQueueList = jest.fn();
const mockQuranView = jest.fn();

const mockPlayerState = {
  queue: {
    tracks: [
      {
        id: 't1',
        url: 'https://example.invalid/t1.mp3',
        title: 'Al-Fatiha',
        artist: 'Reciter',
        reciterId: 'r1',
        surahId: '1',
      },
    ],
    currentIndex: 0,
  },
  isImmersive: false,
  sheetMode: 'expanded',
};

const mockActions = {
  updateQueue: jest.fn(),
  removeFromQueue: jest.fn(),
  play: jest.fn(),
  seekTo: jest.fn(),
  toggleImmersive: jest.fn(),
  setImmersive: jest.fn(),
  setSheetMode: jest.fn(),
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock('@/services/diagnostics/diagnostics', () => ({
  diagBreadcrumb: jest.fn(),
}));

jest.mock('expo-glass-effect', () => ({GlassView: () => null}));
jest.mock('@/hooks/useGlassProps', () => ({
  USE_GLASS: false,
  useGlassColorScheme: () => 'light',
}));
jest.mock('@/components/FrostedView', () => ({FrostedView: () => null}));

// The animated view is a plain View, so `onLayout` reaches a host view.
jest.mock('react-native-reanimated', () => {
  const {View: MockView} = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: {View: MockView},
    runOnJS: (fn: unknown) => fn,
    useSharedValue: (v: number) => ({value: v}),
    useAnimatedStyle: () => ({}),
    withTiming: (v: number) => v,
  };
});

jest.mock('react-native-gesture-handler', () => {
  const chain: Record<string, () => unknown> = {};
  for (const name of [
    'onStart',
    'onChange',
    'onEnd',
    'onFinalize',
    'shouldCancelWhenOutside',
    'runOnJS',
  ]) {
    chain[name] = () => chain;
  }
  return {
    Gesture: {Pan: () => chain},
    GestureDetector: ({children}: {children: React.ReactNode}) => children,
  };
});

jest.mock('@gorhom/bottom-sheet', () => ({
  useBottomSheetGestureHandlers: () => ({
    handlePanGestureHandler: {
      handleOnStart: jest.fn(),
      handleOnChange: jest.fn(),
      handleOnEnd: jest.fn(),
      handleOnFinalize: jest.fn(),
    },
  }),
  useBottomSheetInternal: () => ({
    animatedPosition: {value: 0},
    animatedLayoutState: {get: () => ({containerHeight: 0})},
  }),
}));

jest.mock('@/hooks/usePlayerActions', () => ({
  usePlayerActions: () => mockActions,
}));

jest.mock('@/services/player/store/playerStore', () => {
  const usePlayerStore = (selector: (s: typeof mockPlayerState) => unknown) =>
    selector(mockPlayerState);
  usePlayerStore.getState = () => mockPlayerState;
  return {usePlayerStore};
});

jest.mock('@/store/verseSelectionStore', () => ({
  useVerseSelectionStore: {getState: () => ({clearSelection: jest.fn()})},
}));

jest.mock('@/store/mushafSettingsStore', () => ({
  useMushafSettingsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      showTranslation: false,
      showTransliteration: false,
      arabicFontSize: 28,
      translationFontSize: 16,
      transliterationFontSize: 14,
    }),
}));

jest.mock('@/store/timestampStore', () => {
  const state = {followAlongEnabled: false, isLocked: false};
  const useTimestampStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useTimestampStore.getState = () => ({
    currentSurahTimestamps: null,
    setCurrentAyah: jest.fn(),
  });
  return {useTimestampStore};
});

jest.mock('@/utils/timestampUtils', () => ({findAyahTimestamp: jest.fn()}));
jest.mock('@/hooks/useTimestampLoader', () => ({
  useTimestampLoader: jest.fn(),
}));
jest.mock('@/hooks/useAyahTracker', () => ({useAyahTracker: jest.fn()}));
jest.mock('@/hooks/useFollowAlong', () => ({
  useRewayatFollowAlong: () => false,
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({theme: {colors: {text: '#111111'}}}),
}));
jest.mock('@/hooks/useReadingThemeColors', () => ({
  useReadingThemeColors: () => ({background: '#ffffff'}),
}));

jest.mock('@/i18n/format', () => ({
  getTrackArtistDisplay: (track: {artist: string}) => track.artist,
}));

// The children. QueueList and QuranView record the props they receive.
jest.mock('../QueueList', () => {
  const {View} = require('react-native');
  return {
    QueueList: (props: Record<string, unknown>) => {
      mockQueueList(props);
      return <View testID="mock-queue-list" />;
    },
  };
});
jest.mock('../QuranView', () => {
  const {View} = require('react-native');
  return {
    QuranView: (props: Record<string, unknown>) => {
      mockQuranView(props);
      return <View testID="mock-quran-view" />;
    },
  };
});
jest.mock('../Header', () => {
  const {View} = require('react-native');
  return {Header: () => <View testID="mock-header" />};
});
jest.mock('../TrackInfo', () => {
  const {View} = require('react-native');
  return {TrackInfo: () => <View testID="mock-track-info" />};
});
jest.mock('../PlaybackControls', () => ({PlaybackControls: () => null}));
jest.mock('../UploadPlaceholder', () => ({UploadPlaceholder: () => null}));
jest.mock('../ControlButtons', () => {
  const {Pressable} = require('react-native');
  return {
    ControlButtons: ({onQueuePress}: {onQueuePress: () => void}) => (
      <Pressable testID="mock-queue-toggle" onPress={onQueuePress} />
    ),
  };
});

import PlayerContent from '../index';

// The defaults and the offsets that index.tsx owns (not exported).
const DEFAULT_HEADER_HEIGHT = 100;
const DEFAULT_CONTROLS_HEIGHT = 250;

/** The host view that carries `onLayout` above a stub: the overlay itself. */
function overlayOf(testID: string): ReactTestInstance {
  let node: ReactTestInstance | null = screen.getByTestId(testID);
  while (node) {
    if (
      typeof node.type === 'string' &&
      typeof node.props.onLayout === 'function'
    ) {
      return node;
    }
    node = node.parent;
  }
  throw new Error(`No host view with onLayout above "${testID}"`);
}

function layout(overlay: ReactTestInstance, height: number) {
  fireEvent(overlay, 'layout', {
    nativeEvent: {layout: {x: 0, y: 0, width: 360, height}},
  });
}

function renderPlayerContent() {
  render(
    <PlayerContent
      onSpeedPress={jest.fn()}
      onSleepTimerPress={jest.fn()}
      onMushafLayoutPress={jest.fn()}
      onOptionsPress={jest.fn()}
      onFollowAlongPress={jest.fn()}
    />,
  );
}

function openQueue() {
  fireEvent.press(screen.getByTestId('mock-queue-toggle'));
}

/** The props of the latest QueueList render. */
function queueProps() {
  const calls = mockQueueList.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as {
    contentPaddingTop: number;
    contentPaddingBottom: number;
  };
}

beforeEach(() => {
  mockQueueList.mockClear();
  mockQuranView.mockClear();
});

describe('PlayerContent — the queue insets (TECH_DEBT #295, #307)', () => {
  it('shows the queue only after the queue button is pressed', () => {
    renderPlayerContent();
    expect(screen.queryByTestId('mock-queue-list')).toBeNull();
    expect(screen.getByTestId('mock-quran-view')).toBeTruthy();

    openQueue();
    expect(screen.getByTestId('mock-queue-list')).toBeTruthy();
    expect(screen.queryByTestId('mock-quran-view')).toBeNull();
  });

  it('finds two different overlays by their children', () => {
    renderPlayerContent();
    const header = overlayOf('mock-header');
    const controls = overlayOf('mock-track-info');
    expect(header).not.toBe(controls);
  });

  it('uses the default heights before any layout event', () => {
    renderPlayerContent();
    openQueue();

    const props = queueProps();
    expect(props.contentPaddingTop).toBe(
      mockInsets.top + moderateScale(4) + DEFAULT_HEADER_HEIGHT,
    );
    expect(props.contentPaddingBottom).toBe(
      moderateScale(20) + DEFAULT_CONTROLS_HEIGHT,
    );
  });

  it('follows the measured header and controls heights', () => {
    renderPlayerContent();
    openQueue();

    layout(overlayOf('mock-header'), 88);
    layout(overlayOf('mock-track-info'), 301);

    const props = queueProps();
    expect(props.contentPaddingTop).toBe(
      mockInsets.top + moderateScale(4) + 88,
    );
    expect(props.contentPaddingBottom).toBe(moderateScale(20) + 301);
  });

  it('keeps a height measured before the queue opened', () => {
    renderPlayerContent();
    layout(overlayOf('mock-header'), 64);
    layout(overlayOf('mock-track-info'), 322);

    openQueue();

    const props = queueProps();
    expect(props.contentPaddingTop).toBe(
      mockInsets.top + moderateScale(4) + 64,
    );
    expect(props.contentPaddingBottom).toBe(moderateScale(20) + 322);
  });

  it('moves each edge only with its own overlay', () => {
    renderPlayerContent();
    openQueue();

    layout(overlayOf('mock-header'), 70);
    let props = queueProps();
    expect(props.contentPaddingTop).toBe(
      mockInsets.top + moderateScale(4) + 70,
    );
    // The controls are not measured yet: the bottom edge keeps the default.
    expect(props.contentPaddingBottom).toBe(
      moderateScale(20) + DEFAULT_CONTROLS_HEIGHT,
    );

    layout(overlayOf('mock-track-info'), 280);
    props = queueProps();
    expect(props.contentPaddingBottom).toBe(moderateScale(20) + 280);
    // The top edge keeps the header height.
    expect(props.contentPaddingTop).toBe(
      mockInsets.top + moderateScale(4) + 70,
    );
  });
});
