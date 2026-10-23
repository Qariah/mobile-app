// @ai-generated
// Qariah (Sprint 50, Task 15, TECH_DEBT #236): the uploads screen
// app/(tabs)/(c.collection)/collection/uploads.tsx checks the `userUploads`
// feature flag. The check must not run before the hooks of the screen. React
// does not always throw for that defect: a component that calls no hook in an
// update render drops the effect list of the previous render, so the cleanup
// of its effects never runs. The test renders the screen with the flag on,
// with the flag off, and through a change in both directions. It checks that
// nothing throws and that the cleanup of a hook effect runs when the flag goes
// off. It lives outside app/ because every file there is bundled as a route.
import React from 'react';
import {render} from '@testing-library/react-native';
import {Text} from 'react-native';

const mockFlags: {userUploads: boolean} = {userUploads: true};
const mockHookCleanup = jest.fn();

jest.mock('@/config/featureFlags', () => {
  const actual = jest.requireActual('@/config/featureFlags');
  return {
    ...actual,
    isFeatureEnabled: (key: string) =>
      key === 'userUploads'
        ? mockFlags.userUploads
        : actual.isFeatureEnabled(key),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({back: jest.fn()}),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('@/hooks/useTheme', () => ({
  // The mock hook has an effect, as a real hook can have one, and it records
  // the cleanup of that effect.
  useTheme: () => {
    const ReactActual = jest.requireActual('react');
    ReactActual.useEffect(() => mockHookCleanup, []);
    return {
      theme: {
        isDarkMode: false,
        colors: {
          background: '#fff',
          card: '#fff',
          text: '#111',
          textSecondary: '#666',
        },
        fonts: {medium: 'Medium', regular: 'Regular'},
      },
    };
  },
}));
jest.mock('@/hooks/useGlassProps', () => ({USE_GLASS: false}));
jest.mock('@/hooks/useCollectionNativeHeader', () => ({
  useCollectionNativeHeader: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({Feather: () => null}));
jest.mock('@/components/Icons', () => ({
  MicrophoneIcon: () => null,
  PlayIcon: () => null,
  ShuffleIcon: () => null,
}));
jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {show: jest.fn()},
}));
jest.mock('@/store/uploadsStore', () => ({
  getCustomReciterName: jest.fn(),
  useUploadsStore: () => ({
    recitations: [],
    totalCount: 0,
    importFile: jest.fn(),
    importFiles: jest.fn(),
    loadRecitations: jest.fn(),
    deleteAllRecitations: jest.fn(),
  }),
}));
jest.mock('@/hooks/usePlayerActions', () => ({
  usePlayerActions: () => ({
    updateQueue: jest.fn(),
    addToQueue: jest.fn(),
    play: jest.fn(),
  }),
}));
jest.mock('@/utils/track', () => ({
  createUserUploadTrack: jest.fn(),
  addUploadToRecentlyPlayed: jest.fn(),
}));
jest.mock('@/utils/importAudio', () => ({pickAndImportAudioFiles: jest.fn()}));
jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: jest.fn(() => null),
}));
jest.mock('@/services/dataService', () => ({
  getSurahById: () => undefined,
  getReciterName: () => '',
  getReciterByIdSync: () => undefined,
}));
jest.mock('@/components/NowPlayingIndicator', () => ({
  NowPlayingIndicator: () => null,
}));
jest.mock('@/components/GradientText', () => ({GradientText: () => null}));
jest.mock('@/components/ReciterImage', () => ({ReciterImage: () => null}));
jest.mock('@/components/collection/CollectionStickyHeader', () => ({
  CollectionStickyHeader: () => null,
}));

import {featureFlags} from '@/config/featureFlags';
import UploadsScreen from '@/app/(tabs)/(c.collection)/collection/uploads';

// The empty state of the screen shows this button text.
const SCREEN_TEXT = 'Add Recitation';

// A host that renders the screen with a flag value that changes between renders.
function Host({tick}: {tick: number}) {
  return (
    <>
      <Text>{`tick-${tick}`}</Text>
      <UploadsScreen />
    </>
  );
}

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  mockFlags.userUploads = true;
  mockHookCleanup.mockClear();
  // React logs a hooks-order error before it throws. Keep the output clean.
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('uploads screen: the userUploads flag guard runs after the hooks', () => {
  it('(precondition) Qariah ships the userUploads feature off', () => {
    expect(featureFlags.userUploads).toBe(false);
  });

  it('renders the screen with the flag on', () => {
    const screen = render(<Host tick={0} />);
    expect(screen.getByText(SCREEN_TEXT)).toBeTruthy();
  });

  it('renders nothing for the screen with the flag off', () => {
    mockFlags.userUploads = false;
    const screen = render(<Host tick={0} />);
    expect(screen.queryByText(SCREEN_TEXT)).toBeNull();
    expect(screen.getByText('tick-0')).toBeTruthy();
  });

  it('does not throw when the flag goes from on to off between two renders', () => {
    const screen = render(<Host tick={0} />);
    expect(screen.getByText(SCREEN_TEXT)).toBeTruthy();
    expect(mockHookCleanup).not.toHaveBeenCalled();

    mockFlags.userUploads = false;
    expect(() => screen.rerender(<Host tick={1} />)).not.toThrow();
    expect(screen.queryByText(SCREEN_TEXT)).toBeNull();
    expect(screen.getByText('tick-1')).toBeTruthy();
    // The hidden screen must release its effects.
    expect(mockHookCleanup).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the flag goes from off to on between two renders', () => {
    mockFlags.userUploads = false;
    const screen = render(<Host tick={0} />);
    expect(screen.queryByText(SCREEN_TEXT)).toBeNull();

    mockFlags.userUploads = true;
    expect(() => screen.rerender(<Host tick={1} />)).not.toThrow();
    expect(screen.getByText(SCREEN_TEXT)).toBeTruthy();
  });
});
