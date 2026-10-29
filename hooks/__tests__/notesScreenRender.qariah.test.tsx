// @ai-generated
// Qariah: a render test of the notes screen
// app/(tabs)/(c.collection)/collection/notes.tsx (Personal Notes view). The
// screen had a `verseNotes` flag guard (TECH_DEBT #236); the 2026-10-24
// divergence batch C1 removed it, because Qariah ships `verseNotes: true`,
// the upstream value. It lives outside app/ because every file there is
// bundled as a route.
import React from 'react';
import {render} from '@testing-library/react-native';
import {Text} from 'react-native';

const mockFocusCleanup = jest.fn();

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

import NotesScreen from '@/app/(tabs)/(c.collection)/collection/notes';

// A host that renders the screen beside a marker text.
function Host({tick}: {tick: number}) {
  return (
    <>
      <Text>{`tick-${tick}`}</Text>
      <NotesScreen />
    </>
  );
}

beforeEach(() => {
  mockFocusCleanup.mockClear();
});

describe('notes screen', () => {
  it('renders the Personal Notes view', async () => {
    const screen = render(<Host tick={0} />);
    // The loading state shows first, then the empty state when the load ends.
    expect(await screen.findByText('Personal Notes')).toBeTruthy();
    expect(screen.getByText('tick-0')).toBeTruthy();
  });

  it('runs the focus-effect cleanup on unmount', async () => {
    const screen = render(<Host tick={0} />);
    expect(await screen.findByText('Personal Notes')).toBeTruthy();
    expect(mockFocusCleanup).not.toHaveBeenCalled();
    screen.unmount();
    expect(mockFocusCleanup).toHaveBeenCalledTimes(1);
  });
});
