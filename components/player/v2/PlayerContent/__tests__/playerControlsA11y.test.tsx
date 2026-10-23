// @ai-generated
// Sprint 50 Task 20: the icon buttons of the full player had no label, so
// VoiceOver and TalkBack read "button" (or only "15" for the skip buttons),
// and the iPhone test driver could not find them. Each control now has a
// role, a label (through i18n) and a testID. jsdom cannot build the iOS
// accessibility tree, so these tests lock the props that the platform reads.

import React from 'react';
import {Platform} from 'react-native';
import {render, fireEvent, act} from '@testing-library/react-native';

const mockState = {
  playback: {state: 'paused', position: 30, rate: 1},
  queue: {tracks: [{id: 't1'}, {id: 't2'}], currentIndex: 0},
  loading: {trackLoading: false},
  settings: {
    repeatMode: 'none' as 'none' | 'queue' | 'track',
    sleepTimerEnd: null as number | null,
  },
};

const mockActions = {
  play: jest.fn(),
  pause: jest.fn(),
  skipToNext: jest.fn(),
  skipToPrevious: jest.fn(),
  seekTo: jest.fn(),
  updateSettings: jest.fn(),
};

jest.mock('@/services/player/store/playerStore', () => {
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  const usePlayerStore = selector => selector(mockState);
  usePlayerStore.getState = () => mockState;
  return {usePlayerStore};
});

const mockSetPosition = jest.fn();
jest.mock('@/services/player/store/progressStore', () => ({
  useProgress: () => ({
    position: 30,
    duration: 300,
    seekPosition: null,
    setPosition: mockSetPosition,
  }),
}));

jest.mock('@/hooks/usePlayerActions', () => ({
  usePlayerActions: () => mockActions,
}));

jest.mock('@/store/ambientStore', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  useAmbientStore: selector => selector({isEnabled: false}),
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {colors: {text: '#111111', textSecondary: '#666666'}},
    isDarkMode: false,
  }),
}));

jest.mock('react-native-size-matters', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  moderateScale: value => value,
}));

jest.mock('@/components/Icons', () => {
  const {View} = require('react-native');
  return {
    PlayIcon: View,
    PauseIcon: View,
    PreviousIcon: View,
    NextIcon: View,
    SeekForwardIcon: View,
    SeekBackwardIcon: View,
    TimerIcon: View,
    RepeatIcon: View,
    RepeatOneIcon: View,
    QueueIcon: View,
    AmbientIcon: View,
    HeartIcon: View,
    MicrophoneIcon: View,
  };
});

jest.mock('@expo/vector-icons', () => {
  const {View} = require('react-native');
  return {Ionicons: View, Entypo: View, Feather: View};
});

// Header and TrackInfo (the close, "more" and love buttons).
let mockLoved = false;
const mockToggleTrackLoved = jest.fn();

jest.mock('@/hooks/useLoved', () => ({
  useLoved: () => ({
    isTrackLoved: () => mockLoved,
    toggleTrackLoved: mockToggleTrackLoved,
  }),
}));

jest.mock('expo-symbols', () => {
  const {View} = require('react-native');
  return {SymbolView: View};
});

// TrackInfo takes its Pressable from gesture-handler; the RN one has the
// same press and accessibility props.
jest.mock('react-native-gesture-handler', () => {
  const {Pressable} = require('react-native');
  return {Pressable};
});

jest.mock('react-native-reanimated', () => {
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: {View},
    useSharedValue: (value: number) => ({value}),
    useAnimatedStyle: () => ({}),
    withSpring: (value: number) => value,
  };
});

jest.mock('@shopify/react-native-skia', () => {
  const {View} = require('react-native');
  const paint = {setColorFilter: () => undefined};
  return {
    Canvas: View,
    Paragraph: View,
    Group: View,
    BlendMode: {SrcIn: 0},
    useFonts: () => null,
    Skia: {
      Paint: () => paint,
      Color: () => 0,
      ColorFilter: {MakeBlend: () => ({})},
    },
  };
});

jest.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => ({isTablet: false}),
}));

jest.mock('@/hooks/useReciterNavigation', () => ({
  useReciterNavigation: () => ({navigateToReciterProfile: jest.fn()}),
}));

jest.mock('@/components/ReciterImage', () => {
  const {View} = require('react-native');
  return {ReciterImage: View};
});

jest.mock('@/services/dataService', () => ({
  formatAyahRange: () => '',
  getReciterById: () => Promise.resolve(null),
  getSurahMetadataSync: () => undefined,
}));

jest.mock('@/store/reciterStore', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  useReciterStore: selector => selector({isInitialized: false}),
}));

jest.mock('@/services/rewayah/RewayahIdentity', () => ({
  getShortLabel: () => '',
}));

jest.mock('@/hooks/useCurrentTrackRewayah', () => ({
  useCurrentTrackResolvedRewayah: () => null,
}));

jest.mock('@/components/player/v2/recitationStyle', () => ({
  getRecitationStyleLabel: () => '',
}));

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

import {Controls} from '../PlaybackControls/Controls';
import {ProgressBar} from '../PlaybackControls/ProgressBar';
import {ControlButtons} from '../ControlButtons';
import {Header} from '../Header';
import {TrackInfo} from '../TrackInfo';

function controlButtons(
  overrides: Partial<React.ComponentProps<typeof ControlButtons>> = {},
) {
  return (
    <ControlButtons
      onSpeedPress={jest.fn()}
      onSleepTimerPress={jest.fn()}
      onQueuePress={jest.fn()}
      showQueue={false}
      onMushafLayoutPress={jest.fn()}
      onFollowAlongPress={jest.fn()}
      followAlongActive={false}
      followAlongAvailable
      {...overrides}
    />
  );
}

describe('full player controls: labels for screen readers (Sprint 50 Task 20)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.playback.state = 'paused';
    mockState.playback.rate = 1;
    mockLoved = false;
    mockState.settings.repeatMode = 'none';
    mockState.settings.sleepTimerEnd = null;
  });

  it.each([
    ['player-skip-back', 'Skip back 15 seconds'],
    ['player-previous', 'Previous'],
    ['player-play-pause', 'Play'],
    ['player-next', 'Next'],
    ['player-skip-forward', 'Skip forward 15 seconds'],
  ])('labels the playback button %s "%s"', (testID, label) => {
    const {getByTestId} = render(<Controls />);
    const button = getByTestId(testID);
    expect(button.props.accessibilityLabel).toBe(label);
    expect(button.props.accessibilityRole).toBe('button');
  });

  it('labels play/pause with its state', async () => {
    mockState.playback.state = 'playing';
    const {getByTestId} = render(<Controls />);
    expect(getByTestId('player-play-pause').props.accessibilityLabel).toBe(
      'Pause',
    );

    // A pause tap: the store state changes, and the label follows the icon.
    mockActions.pause.mockImplementation(async () => {
      mockState.playback.state = 'paused';
    });
    await act(async () => {
      fireEvent.press(getByTestId('player-play-pause'));
    });
    expect(mockActions.pause).toHaveBeenCalledTimes(1);
    expect(getByTestId('player-play-pause').props.accessibilityLabel).toBe(
      'Play',
    );
  });

  it.each([
    ['player-mushaf-settings', 'Mushaf settings'],
    ['player-repeat', 'Repeat'],
    ['player-sleep-timer', 'Sleep Timer'],
    ['player-locate-verse', 'Follow Along'],
    ['player-queue-button', 'Queue'],
    ['player-speed', 'Playback Speed'],
  ])('labels the button %s "%s"', (testID, label) => {
    const {getByTestId} = render(controlButtons());
    const button = getByTestId(testID);
    expect(button.props.accessibilityLabel).toBe(label);
    expect(button.props.accessibilityRole).toBe('button');
  });

  it('labels the ambient button when the player shows it', () => {
    const {getByTestId, queryByTestId, rerender} = render(controlButtons());
    expect(queryByTestId('player-ambient')).toBeNull();
    rerender(controlButtons({onAmbientPress: jest.fn()}));
    expect(getByTestId('player-ambient').props.accessibilityLabel).toBe(
      'Ambient Sounds',
    );
  });

  it.each([
    ['none', 'Off'],
    ['queue', 'Queue'],
    ['track', 'Current recitation'],
  ] as const)('gives the repeat mode %s as the value "%s"', (mode, value) => {
    mockState.settings.repeatMode = mode;
    const {getByTestId} = render(controlButtons());
    expect(getByTestId('player-repeat').props.accessibilityValue).toEqual({
      text: value,
    });
  });

  it('marks the sleep timer and Follow Along as selected when they are on', () => {
    const {getByTestId, rerender} = render(controlButtons());
    expect(
      getByTestId('player-sleep-timer').props.accessibilityState,
    ).toMatchObject({selected: false});
    expect(
      getByTestId('player-locate-verse').props.accessibilityState,
    ).toMatchObject({selected: false});

    mockState.settings.sleepTimerEnd = Date.now() + 60_000;
    rerender(controlButtons({followAlongActive: true}));
    expect(
      getByTestId('player-sleep-timer').props.accessibilityState,
    ).toMatchObject({selected: true});
    expect(
      getByTestId('player-locate-verse').props.accessibilityState,
    ).toMatchObject({selected: true});

    // Follow Along that the reciter does not support is not on.
    rerender(
      controlButtons({followAlongActive: true, followAlongAvailable: false}),
    );
    expect(
      getByTestId('player-locate-verse').props.accessibilityState,
    ).toMatchObject({selected: false});
  });

  it('labels the progress slider as an adjustable control', () => {
    const {getByTestId} = render(<ProgressBar />);
    const slider = getByTestId('player-progress');
    expect(slider.props.accessibilityLabel).toBe('Playback position');
    expect(slider.props.accessibilityRole).toBe('adjustable');
  });

  describe('the progress slider on iOS', () => {
    const platformOS = Platform.OS;
    beforeEach(() => {
      Platform.OS = 'ios';
    });
    afterEach(() => {
      Platform.OS = platformOS;
    });

    it('is the accessibility element and says the position', () => {
      // On Fabric the label sits on the slider wrapper; without `accessible`
      // VoiceOver focuses the UISlider inside, which has no label.
      const {getByTestId} = render(<ProgressBar />);
      const slider = getByTestId('player-progress');
      expect(slider.props.accessible).toBe(true);
      expect(slider.props.accessibilityValue).toEqual({text: '0:30 of 5:00'});
      expect(slider.props.accessibilityActions).toEqual([
        {name: 'increment'},
        {name: 'decrement'},
      ]);
    });

    it('moves 15 s for a swipe up or down, inside the track', async () => {
      const {getByTestId} = render(<ProgressBar />);
      const slider = getByTestId('player-progress');
      const swipe = (actionName: string) =>
        act(async () => {
          await slider.props.onAccessibilityAction({nativeEvent: {actionName}});
        });

      await swipe('increment');
      expect(mockActions.seekTo).toHaveBeenLastCalledWith(45);
      expect(mockSetPosition).toHaveBeenLastCalledWith(45);
      await swipe('decrement');
      expect(mockActions.seekTo).toHaveBeenLastCalledWith(15);
      await swipe('activate');
      expect(mockActions.seekTo).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps the native slider behavior on Android', () => {
    const platformOS = Platform.OS;
    Platform.OS = 'android';
    try {
      const {getByTestId} = render(<ProgressBar />);
      const slider = getByTestId('player-progress');
      expect(slider.props.accessibilityLabel).toBe('Playback position');
      expect(slider.props.accessible).toBeUndefined();
      expect(slider.props.accessibilityActions).toBeUndefined();
    } finally {
      Platform.OS = platformOS;
    }
  });

  it('gives the speed button the speed as its value', () => {
    mockState.playback.rate = 1.5;
    const {getByTestId} = render(controlButtons());
    expect(getByTestId('player-speed').props.accessibilityValue).toEqual({
      text: '1.5x',
    });
  });

  it.each([
    ['player-close', 'Close'],
    ['player-more', 'More options'],
  ])('labels the header button %s "%s"', (testID, label) => {
    const {getByTestId} = render(<Header onOptionsPress={jest.fn()} />);
    const button = getByTestId(testID);
    expect(button.props.accessibilityLabel).toBe(label);
    expect(button.props.accessibilityRole).toBe('button');
  });

  it('labels the love button with what a tap does', () => {
    const {getByTestId, rerender} = render(<TrackInfo />);
    const love = getByTestId('player-love');
    expect(love.props.accessibilityLabel).toBe('Add to loved');
    expect(love.props.accessibilityRole).toBe('button');
    fireEvent.press(love);
    expect(mockToggleTrackLoved).toHaveBeenCalledTimes(1);

    mockLoved = true;
    rerender(<TrackInfo />);
    expect(getByTestId('player-love').props.accessibilityLabel).toBe(
      'Remove from loved',
    );
  });
});
