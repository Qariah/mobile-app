// @ai-generated
// TECH_DEBT #339: the iPad players had unnamed buttons, so VoiceOver read
// "button" and the iPhone test driver could not find them. Sprint 50 Task 20
// named the phone player only. These tests find each iPad control by the
// label of the phone player (the same i18n key) and check its testID.
// jsdom cannot build the iOS accessibility tree, so the tests lock the props
// that the platform reads.
//
// TECH_DEBT #356: the last test checks that the reciter column gives
// ReciterImage the catalog photo, as the mini players do since #262.

import React from 'react';
import {Platform} from 'react-native';
import {render} from '@testing-library/react-native';

const mockState = {
  playback: {state: 'paused', position: 30, rate: 1},
  queue: {
    tracks: [
      {id: 't1', reciterId: 'r1', surahId: '1', artist: 'Reciter'},
      {id: 't2', reciterId: 'r1', surahId: '2', artist: 'Reciter'},
    ],
    currentIndex: 0,
  },
  loading: {trackLoading: false},
  isImmersive: false,
  sheetMode: 'full',
  settings: {
    repeatMode: 'none' as 'none' | 'queue' | 'track',
    sleepTimerEnd: null as number | null,
  },
};

jest.mock('@/services/player/store/playerStore', () => {
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  const usePlayerStore = selector => selector(mockState);
  usePlayerStore.getState = () => mockState;
  return {usePlayerStore};
});

jest.mock('@/services/player/store/progressStore', () => ({
  useProgress: () => ({
    position: 30,
    duration: 300,
    seekPosition: null,
    setPosition: jest.fn(),
  }),
}));

jest.mock('@/hooks/usePlayerActions', () => ({
  usePlayerActions: () => ({
    play: jest.fn(),
    pause: jest.fn(),
    skipToNext: jest.fn(),
    skipToPrevious: jest.fn(),
    seekTo: jest.fn(),
    updateSettings: jest.fn(),
    setSheetMode: jest.fn(),
    updateQueue: jest.fn(),
    removeFromQueue: jest.fn(),
    toggleImmersive: jest.fn(),
    setImmersive: jest.fn(),
  }),
}));

let mockLoved = false;
jest.mock('@/hooks/useLoved', () => ({
  useLoved: () => ({
    isTrackLoved: () => mockLoved,
    toggleTrackLoved: jest.fn(),
    isLovedWithRewayat: () => false,
  }),
}));

jest.mock('@/store/ambientStore', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  useAmbientStore: selector => selector({isEnabled: false}),
}));

jest.mock('@/store/timestampStore', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  useTimestampStore: selector =>
    selector({followAlongEnabled: true, isLocked: true}),
}));

jest.mock('@/store/mushafSettingsStore', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  useMushafSettingsStore: selector =>
    selector({
      showTranslation: false,
      showTransliteration: false,
      arabicFontSize: 24,
      translationFontSize: 16,
      transliterationFontSize: 16,
    }),
}));

jest.mock('@/store/verseSelectionStore', () => ({
  useVerseSelectionStore: {getState: () => ({clearSelection: jest.fn()})},
}));

jest.mock('@/hooks/useFollowAlong', () => ({
  useRewayatFollowAlong: () => true,
}));

jest.mock('@/hooks/useTimestampLoader', () => ({
  useTimestampLoader: jest.fn(),
}));
jest.mock('@/hooks/useAyahTracker', () => ({useAyahTracker: jest.fn()}));

jest.mock('@/hooks/useCurrentTrackRewayah', () => ({
  useCurrentTrackResolvedRewayah: () => null,
}));

jest.mock('@/services/rewayah/RewayahIdentity', () => ({
  getShortLabel: () => '',
}));

jest.mock('@/components/player/v2/recitationStyle', () => ({
  getRecitationStyleLabel: () => 'Murattal',
}));

let mockImageUrl: string | null = null;
jest.mock('@/services/dataService', () => ({
  getReciterById: () => Promise.resolve(null),
  getReciterByIdSync: () => ({
    id: 'r1',
    name: 'Reciter',
    date: null,
    image_url: mockImageUrl,
    rewayat: [
      {id: 'w1', name: 'Hafs A Asim', style: 'murattal', surah_list: [1]},
      {id: 'w2', name: 'Warsh A Nafi', style: 'murattal', surah_list: [1]},
    ],
  }),
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        text: '#111111',
        textSecondary: '#666666',
        background: '#ffffff',
        card: '#eeeeee',
      },
    },
    isDarkMode: false,
  }),
}));

jest.mock('@/hooks/useReadingThemeColors', () => ({
  useReadingThemeColors: () => ({background: '#ffffff'}),
}));

let mockOrientation: 'portrait' | 'landscape' = 'landscape';
jest.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => ({isTablet: true, orientation: mockOrientation}),
}));

jest.mock('@/hooks/useReciterNavigation', () => ({
  useReciterNavigation: () => ({navigateToReciterProfile: jest.fn()}),
}));

jest.mock('@/hooks/useSettings', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  useSettings: selector =>
    selector({reciterProfileSortOption: 'asc', reciterProfileViewMode: 'list'}),
}));

jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  useRecentlyPlayedStore: selector => selector({startNewChain: jest.fn()}),
}));

jest.mock('@/services/player/store/downloadSelectors', () => ({
  useDownloadQueries: () => ({isDownloaded: () => false}),
}));

// The real modules load the download store and Sentry, which leaves a timer.
jest.mock('@/utils/audioUtils', () => ({generateSmartAudioUrl: jest.fn()}));
jest.mock('@/utils/artworkUtils', () => ({getReciterArtwork: jest.fn()}));

jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {show: jest.fn()},
}));

jest.mock('@/components/reciter-profile/components/SurahList', () => ({
  SurahList: () => null,
}));

jest.mock('@/components/player/v2/PlayerContent/Header', () => ({
  Header: () => null,
}));
jest.mock('@/components/player/v2/PlayerContent/QueueList', () => ({
  QueueList: () => null,
}));
jest.mock('@/components/player/v2/PlayerContent/QuranView', () => ({
  QuranView: () => null,
}));
jest.mock('@/components/player/v2/PlayerContent/UploadPlaceholder', () => ({
  UploadPlaceholder: () => null,
}));

// The mock keeps the props, so a test can read the photo URL.
jest.mock('@/components/ReciterImage', () => {
  const {View} = require('react-native');
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  const ReciterImage = props => <View testID="reciter-image" {...props} />;
  return {ReciterImage};
});

jest.mock('@/components/Icons', () => {
  const {View} = require('react-native');
  return {
    HeartIcon: View,
    MicrophoneIcon: View,
    PreviousIcon: View,
    NextIcon: View,
    PlayIcon: View,
    PauseIcon: View,
    SeekBackwardIcon: View,
    SeekForwardIcon: View,
    TimerIcon: View,
    RepeatIcon: View,
    RepeatOneIcon: View,
    QueueIcon: View,
    AmbientIcon: View,
  };
});

jest.mock('@expo/vector-icons', () => {
  const {View} = require('react-native');
  return {Ionicons: View, Feather: View};
});

jest.mock('expo-glass-effect', () => {
  const {View} = require('react-native');
  return {GlassView: View, isLiquidGlassAvailable: () => false};
});

jest.mock('@/hooks/useGlassProps', () => ({
  USE_GLASS: false,
  useGlassColorScheme: () => 'light',
}));

jest.mock('@/components/FrostedView', () => {
  const {View} = require('react-native');
  return {FrostedView: View};
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('react-native-reanimated', () => {
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: {View},
    runOnJS: (fn: unknown) => fn,
    useSharedValue: (value: number) => ({value}),
    useAnimatedStyle: () => ({}),
    withSpring: (value: number) => value,
    withTiming: (value: number) => value,
  };
});

jest.mock('react-native-gesture-handler', () => {
  // Gesture.Pan() returns a builder: every call returns the builder.
  const builder: Record<string, unknown> = new Proxy(
    {},
    {get: () => () => builder},
  );
  return {
    Gesture: {Pan: () => builder},
    // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
    GestureDetector: ({children}) => children,
  };
});

jest.mock('@gorhom/bottom-sheet', () => ({
  useBottomSheetGestureHandlers: () => ({handlePanGestureHandler: {}}),
  useBottomSheetInternal: () => ({
    animatedPosition: {value: 0},
    animatedLayoutState: {get: () => ({containerHeight: 0})},
  }),
}));

// The mock keeps the props, so a test can read them.
jest.mock('@react-native-community/slider', () => {
  const {View} = require('react-native');
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  const Slider = props => <View {...props} />;
  return {__esModule: true, default: Slider};
});

jest.mock('@/i18n/qariahIosLanguage', () => ({
  invertLtrNativeSlider: false,
}));

import TabletPlayer from '@/components/player/v2/TabletPlayer';
import {TabletPlayerControlsColumn} from '../TabletPlayerControlsColumn';
import {TabletPlayerReciterColumn} from '../TabletPlayerReciterColumn';

const handlers = {
  onSpeedPress: jest.fn(),
  onSleepTimerPress: jest.fn(),
  onMushafLayoutPress: jest.fn(),
  onAmbientPress: jest.fn(),
  onOptionsPress: jest.fn(),
  onFollowAlongPress: jest.fn(),
};

const players = [
  {
    name: 'TabletPlayer (landscape sidebar)',
    orientation: 'landscape' as const,
    element: () => <TabletPlayer {...handlers} measuredParentWidth={1366} />,
  },
  {
    name: 'TabletPlayer (portrait dock)',
    orientation: 'portrait' as const,
    element: () => <TabletPlayer {...handlers} measuredParentWidth={1024} />,
  },
  {
    name: 'TabletPlayerControlsColumn',
    orientation: 'portrait' as const,
    element: () => (
      <TabletPlayerControlsColumn
        {...handlers}
        showQueue={false}
        onQueueToggle={jest.fn()}
      />
    ),
  },
];

// The labels of the phone player (Sprint 50 Task 20), by testID.
const CONTROLS: Array<[string, string]> = [
  ['player-skip-back', 'Skip back 15 seconds'],
  ['player-previous', 'Previous'],
  ['player-play-pause', 'Play'],
  ['player-next', 'Next'],
  ['player-skip-forward', 'Skip forward 15 seconds'],
  ['player-mushaf-settings', 'Mushaf settings'],
  ['player-speed', 'Playback Speed'],
  ['player-repeat', 'Repeat'],
  ['player-sleep-timer', 'Sleep Timer'],
  ['player-ambient', 'Ambient Sounds'],
  ['player-locate-verse', 'Follow Along'],
  ['player-queue-button', 'Queue'],
  ['player-love', 'Add to loved'],
  ['player-progress', 'Playback position'],
];

describe.each(players)(
  '$name: labels of the phone player (TECH_DEBT #339)',
  ({element, orientation}) => {
    beforeEach(() => {
      mockOrientation = orientation;
      mockLoved = false;
      mockState.playback.state = 'paused';
      mockState.playback.rate = 1;
      mockState.settings.repeatMode = 'none';
      mockState.settings.sleepTimerEnd = null;
    });

    it.each(CONTROLS)('finds %s by the label "%s"', (testID, label) => {
      const {getByLabelText} = render(element());
      const control = getByLabelText(label);
      expect(control.props.testID).toBe(testID);
      expect(control.props.accessibilityRole).toBe(
        testID === 'player-progress' ? 'adjustable' : 'button',
      );
    });

    it('gives play/pause, love, repeat and speed their state', () => {
      mockState.playback.state = 'playing';
      mockLoved = true;
      mockState.settings.repeatMode = 'track';
      mockState.playback.rate = 1.5;
      const {getByTestId} = render(element());
      expect(getByTestId('player-play-pause').props.accessibilityLabel).toBe(
        'Pause',
      );
      expect(getByTestId('player-love').props.accessibilityLabel).toBe(
        'Remove from loved',
      );
      expect(getByTestId('player-repeat').props.accessibilityValue).toEqual({
        text: 'Current recitation',
      });
      expect(getByTestId('player-speed').props.accessibilityValue).toEqual({
        text: '1.5x',
      });
    });

    it('marks the sleep timer and Follow Along as selected when they are on', () => {
      mockState.settings.sleepTimerEnd = Date.now() + 60_000;
      const {getByTestId} = render(element());
      expect(
        getByTestId('player-sleep-timer').props.accessibilityState,
      ).toMatchObject({selected: true});
      expect(
        getByTestId('player-locate-verse').props.accessibilityState,
      ).toMatchObject({selected: true});
    });

    it('makes the slider the adjustable element on iOS, as the phone does', () => {
      const platformOS = Platform.OS;
      Platform.OS = 'ios';
      try {
        const {getByTestId} = render(element());
        const slider = getByTestId('player-progress');
        expect(slider.props.accessible).toBe(true);
        expect(slider.props.accessibilityValue).toEqual({
          text: '0:30 of 5:00',
        });
      } finally {
        Platform.OS = platformOS;
      }
    });
  },
);

describe('TabletPlayerReciterColumn labels (TECH_DEBT #339)', () => {
  it('names the button that opens the reciter profile', () => {
    const {getByLabelText} = render(
      <TabletPlayerReciterColumn reciterId="r1" initialRewayatId="w1" />,
    );
    // #535: the English label says Qariah.
    const button = getByLabelText('Go to Qariah');
    expect(button.props.testID).toBe('player-open-reciter-profile');
    expect(button.props.accessibilityRole).toBe('button');
  });

  it('gives each rewayah chip the button role and its selected state', () => {
    const {getByRole} = render(
      <TabletPlayerReciterColumn reciterId="r1" initialRewayatId="w2" />,
    );
    // The chip text is the label: the name of the rewayah and the style.
    expect(
      getByRole('button', {name: 'Hafs A Asim · Murattal', selected: false}),
    ).toBeTruthy();
    expect(
      getByRole('button', {name: 'Warsh A Nafi · Murattal', selected: true}),
    ).toBeTruthy();
  });
});

describe('TabletPlayerReciterColumn photo (TECH_DEBT #356)', () => {
  afterEach(() => {
    mockImageUrl = null;
  });

  it('gives ReciterImage the catalog photo of the reciter', () => {
    mockImageUrl = 'https://example.test/reciters/r1/photo.jpg?v=1';
    const {getByTestId} = render(<TabletPlayerReciterColumn reciterId="r1" />);
    const image = getByTestId('reciter-image');
    expect(image.props.imageUrl).toBe(mockImageUrl);
    expect(image.props.reciterName).toBe('Reciter');
  });

  it('gives no URL for a reciter with no photo, so the fallback stays', () => {
    const {getByTestId} = render(<TabletPlayerReciterColumn reciterId="r1" />);
    expect(getByTestId('reciter-image').props.imageUrl).toBeUndefined();
  });
});
