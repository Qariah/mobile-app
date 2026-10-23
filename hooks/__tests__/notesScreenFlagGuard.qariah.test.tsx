// @ai-generated
// Qariah (Sprint 50, Task 15, TECH_DEBT #236): the notes screen
// app/(tabs)/(c.collection)/collection/notes.tsx checks the `verseNotes`
// feature flag. The check must not run before the hooks of the screen.
// This is a rules-of-hooks defect. React does not always throw for it: a
// component that calls no hook in an update render drops the effect list of
// the previous render, so the cleanup of its effects never runs. The test
// renders the screen with the flag on, with the flag off, and through a
// change in both directions. It checks that nothing throws and that the
// cleanup of the focus effect runs when the flag goes off. It lives outside
// app/ because every file there is bundled as a route.
import React from 'react';
import {render} from '@testing-library/react-native';
import {Text} from 'react-native';

const mockFlags: {verseNotes: boolean} = {verseNotes: true};
const mockFocusCleanup = jest.fn();

jest.mock('@/config/featureFlags', () => {
  const actual = jest.requireActual('@/config/featureFlags');
  return {
    ...actual,
    isFeatureEnabled: (key: string) =>
      key === 'verseNotes'
        ? mockFlags.verseNotes
        : actual.isFeatureEnabled(key),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({back: jest.fn()}),
  useLocalSearchParams: () => ({}),
  // The real hook runs its effect on focus. The mock runs it on mount and
  // records the cleanup, which the real hook runs on blur or on unmount.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactActual = jest.requireActual('react');
    ReactActual.useEffect(() => {
      const cleanup = effect();
      return () => {
        mockFocusCleanup();
        if (typeof cleanup === 'function') cleanup();
      };
    }, [effect]);
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
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
  }),
}));
jest.mock('@/hooks/useGlassProps', () => ({USE_GLASS: false}));
jest.mock('@/hooks/useCollectionNativeHeader', () => ({
  useCollectionNativeHeader: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({Feather: () => null}));
jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {show: jest.fn()},
}));
jest.mock('@/services/dataService', () => ({getSurahById: () => undefined}));
jest.mock('@/services/verse-annotations/VerseAnnotationService', () => ({
  verseAnnotationService: {
    getAllNotes: jest.fn(async () => []),
    deleteNoteById: jest.fn(),
    getNotesCountForVerse: jest.fn(),
  },
}));
jest.mock('@/services/userState/notesSync', () => ({
  syncDeleteToQf: jest.fn(),
}));
jest.mock('@/services/userState/postsRestore', () => ({
  syncQfPostsToLocal: jest.fn(async () => ({kind: 'skipped'})),
}));
jest.mock('@/services/analytics/verseAnnotationEvents', () => ({
  trackVerseNoteDeleted: jest.fn(),
  versesOfSaved: jest.fn(),
}));
jest.mock('@/store/verseAnnotationsStore', () => ({
  useVerseAnnotationsStore: {getState: () => ({removeNote: jest.fn()})},
}));
jest.mock('@/components/collection/NoteItem', () => ({NoteItem: () => null}));
jest.mock('@/components/collection/CollectionStickyHeader', () => ({
  CollectionStickyHeader: () => null,
}));
jest.mock('@/hooks/useSavedVerseDescription', () => ({
  describeSavedVerseNow: jest.fn(),
}));
jest.mock('@/services/verse-annotations/unitAnnotations', () => ({
  savedVerseSubtitle: jest.fn(),
}));

import {featureFlags} from '@/config/featureFlags';
import NotesScreen from '@/app/(tabs)/(c.collection)/collection/notes';

// A host that renders the screen with a flag value that changes between renders.
function Host({tick}: {tick: number}) {
  return (
    <>
      <Text>{`tick-${tick}`}</Text>
      <NotesScreen />
    </>
  );
}

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  mockFlags.verseNotes = true;
  mockFocusCleanup.mockClear();
  // React logs a hooks-order error before it throws. Keep the output clean.
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('notes screen: the verseNotes flag guard runs after the hooks', () => {
  it('(precondition) Qariah ships the verseNotes feature on', () => {
    expect(featureFlags.verseNotes).toBe(true);
  });

  it('renders the screen with the flag on', async () => {
    const screen = render(<Host tick={0} />);
    // The loading state shows first, then the empty state when the load ends.
    expect(await screen.findByText('Personal Notes')).toBeTruthy();
  });

  it('renders nothing for the screen with the flag off', () => {
    mockFlags.verseNotes = false;
    const screen = render(<Host tick={0} />);
    expect(screen.queryByText('Personal Notes')).toBeNull();
    expect(screen.getByText('tick-0')).toBeTruthy();
  });

  it('does not throw when the flag goes from on to off between two renders', async () => {
    const screen = render(<Host tick={0} />);
    expect(await screen.findByText('Personal Notes')).toBeTruthy();

    expect(mockFocusCleanup).not.toHaveBeenCalled();

    mockFlags.verseNotes = false;
    expect(() => screen.rerender(<Host tick={1} />)).not.toThrow();
    expect(screen.queryByText('Personal Notes')).toBeNull();
    expect(screen.getByText('tick-1')).toBeTruthy();
    // The hidden screen must release its effects.
    expect(mockFocusCleanup).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the flag goes from off to on between two renders', async () => {
    mockFlags.verseNotes = false;
    const screen = render(<Host tick={0} />);
    expect(screen.queryByText('Personal Notes')).toBeNull();

    mockFlags.verseNotes = true;
    expect(() => screen.rerender(<Host tick={1} />)).not.toThrow();
    expect(await screen.findByText('Personal Notes')).toBeTruthy();
  });
});
