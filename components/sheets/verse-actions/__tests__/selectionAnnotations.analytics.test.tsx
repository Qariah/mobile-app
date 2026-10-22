// @ai Qariah (TECH_DEBT #297, Sprint 47) — the events of the verse sheets'
// bookmark, highlight and note actions. One user action sends one event,
// after the write has succeeded, and an event never holds what the user typed.
// The real annotations store runs with the database service mocked, as in
// selectionAnnotations.test.tsx; the analytics service is mocked at the single
// capture function every Qariah event goes through.

const mockCapture = jest.fn();
jest.mock('@/services/analytics/AnalyticsService', () => ({
  analyticsService: {
    captureDiagnosticEvent: (...args: unknown[]) => mockCapture(...args),
  },
}));
jest.mock('@/services/verse-annotations/VerseAnnotationService', () => ({
  verseAnnotationService: {
    addBookmark: jest.fn(async () => undefined),
    removeBookmark: jest.fn(async () => undefined),
    upsertHighlight: jest.fn(async () => undefined),
    removeHighlight: jest.fn(async () => undefined),
    addNote: jest.fn(async () => ({id: 'n1'})),
    applyAnnotationChanges: jest.fn(async () => undefined),
    getAnnotationsForSurah: jest.fn(async () => ({
      bookmarks: [],
      notes: [],
      highlights: [],
    })),
  },
}));
jest.mock('@/services/mushaf/DigitalKhattDataService', () => ({
  digitalKhattDataService: {
    isRewayahReady: () => true,
    getRewayahLoadState: () => 'ready',
    subscribeCacheChanges: () => () => undefined,
    getCacheVersion: () => 0,
    retainRewayah: () => () => undefined,
    ensureRewayahLoaded: () => Promise.reject(new Error('no load in tests')),
  },
  getRewayahDataIdentityKey: (r: string) => `${r}@test`,
}));
jest.mock('@/services/mushaf/RewayahVerseUnitsService', () => ({
  rewayahVerseUnitsService: jest
    .requireActual('@/services/mushaf/__fixtures__/verseUnitsServiceStub')
    .verseUnitsServiceStub({peek: () => null, status: () => 'error'}),
}));

import {
  buildRewayahVerseUnits,
  type RewayahVerseUnits,
  type VerseUnitSlot,
} from '@/services/mushaf/RewayahVerseUnits';
import {verseAnnotationService} from '@/services/verse-annotations/VerseAnnotationService';
import {
  selectVerses,
  unitSelection,
  type ReadyVerseSelection,
} from '@/components/share/rewayahVerseSelection';
import {setStoredRows as setRows} from '../__fixtures__/storedRows';
import {
  addSelectionNote,
  setSelectionBookmarked,
  setSelectionHighlight,
} from '../selectionAnnotations';

const fixture =
  require('@/services/mushaf/__fixtures__/verseUnitsFixture.json') as {
    ids: number[];
    locations: string[];
    texts: Record<'warsh', string[]>;
  };
function buildWarsh(): RewayahVerseUnits {
  const slots: VerseUnitSlot[] = fixture.ids.map((id, i) => {
    const [surah, ayah, word] = fixture.locations[i].split(':').map(Number);
    return {id, surah, ayah, word, text: fixture.texts.warsh[i]};
  });
  return buildRewayahVerseUnits('warsh', slots, 'warsh@test');
}
const warsh = buildWarsh();

/** Warsh verses, in Warsh numbering (stored by their Hafs anchors). */
function warshSelection(...keys: string[]): ReadyVerseSelection {
  return unitSelection(
    warsh,
    keys.map(key => warsh.unitByKey(key)!),
  );
}

/** A Hafs selection, as the sheets build it from a Hafs payload. */
function hafsSelection(...keys: string[]): ReadyVerseSelection {
  const [s, a] = keys[0].split(':').map(Number);
  const selection = selectVerses(
    {
      rewayah: 'hafs',
      verseKey: keys[0],
      surahNumber: s,
      ayahNumber: a,
      verseKeys: keys.length > 1 ? keys : undefined,
    },
    null,
    'ready',
  );
  if (selection.status !== 'ready') throw new Error('not ready');
  return selection;
}

const service = verseAnnotationService as jest.Mocked<
  typeof verseAnnotationService
>;
const events = () =>
  mockCapture.mock.calls.map(([event, props]) => ({event, props}));

const PRIVATE_TEXT = 'my private words about this ayah';

beforeEach(() => {
  jest.clearAllMocks();
  setRows([]);
});

describe('highlights', () => {
  it('Hafs: setting a colour sends verse_highlight_set once, with the colour id', async () => {
    await setSelectionHighlight(hafsSelection('2:255'), 'blue');
    expect(events()).toEqual([
      {
        event: 'verse_highlight_set',
        props: {
          verse_key: '2:255',
          surah_id: 2,
          verse_count: 1,
          rewayah_id: 'hafs',
          color: 'blue',
        },
      },
    ]);
  });

  it('Hafs: a change of colour sends verse_highlight_set again', async () => {
    await setSelectionHighlight(hafsSelection('2:255'), 'blue');
    await setSelectionHighlight(hafsSelection('2:255'), 'green');
    expect(events().map(e => [e.event, e.props.color])).toEqual([
      ['verse_highlight_set', 'blue'],
      ['verse_highlight_set', 'green'],
    ]);
  });

  it('Hafs: removing sends verse_highlight_removed once, without a colour', async () => {
    await setSelectionHighlight(hafsSelection('2:255'), null);
    expect(events()).toEqual([
      {
        event: 'verse_highlight_removed',
        props: {
          verse_key: '2:255',
          surah_id: 2,
          verse_count: 1,
          rewayah_id: 'hafs',
        },
      },
    ]);
  });

  it('Hafs: a highlight on three verses is ONE event for the first verse', async () => {
    await setSelectionHighlight(
      hafsSelection('18:10', '18:11', '18:12'),
      'orange',
    );
    expect(service.upsertHighlight).toHaveBeenCalledTimes(3);
    expect(events()).toHaveLength(1);
    expect(events()[0].props).toMatchObject({
      verse_key: '18:10',
      surah_id: 18,
      verse_count: 3,
    });
  });

  it('Warsh: the event names the Hafs anchor of the verse and the rewayah', async () => {
    // Warsh 1:7 is stored at the Hafs anchor "1:7:5".
    await setSelectionHighlight(warshSelection('1:7'), 'purple');
    expect(events()).toEqual([
      {
        event: 'verse_highlight_set',
        props: {
          verse_key: '1:7',
          surah_id: 1,
          verse_count: 1,
          rewayah_id: 'warsh',
          color: 'purple',
        },
      },
    ]);
  });

  it('Warsh: removing sends verse_highlight_removed once', async () => {
    setRows([], {'1:7:5': 'blue'});
    await setSelectionHighlight(warshSelection('1:7'), null);
    expect(events().map(e => e.event)).toEqual(['verse_highlight_removed']);
  });

  it('sends nothing when the write fails', async () => {
    service.upsertHighlight.mockRejectedValueOnce(new Error('disk full'));
    await expect(
      setSelectionHighlight(hafsSelection('2:255'), 'blue'),
    ).rejects.toThrow('disk full');
    service.removeHighlight.mockRejectedValueOnce(new Error('disk full'));
    await expect(
      setSelectionHighlight(hafsSelection('2:255'), null),
    ).rejects.toThrow('disk full');
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe('bookmarks', () => {
  it('Hafs: adding and removing send verse_bookmark_toggled with added', async () => {
    await setSelectionBookmarked(hafsSelection('36:1'), true);
    await setSelectionBookmarked(hafsSelection('36:1'), false);
    expect(events()).toEqual([
      {
        event: 'verse_bookmark_toggled',
        props: {
          verse_key: '36:1',
          surah_id: 36,
          verse_count: 1,
          rewayah_id: 'hafs',
          added: true,
        },
      },
      {
        event: 'verse_bookmark_toggled',
        props: {
          verse_key: '36:1',
          surah_id: 36,
          verse_count: 1,
          rewayah_id: 'hafs',
          added: false,
        },
      },
    ]);
  });

  it('Warsh: one event for the toggle', async () => {
    await setSelectionBookmarked(warshSelection('1:6', '1:7'), true);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toEqual({
      event: 'verse_bookmark_toggled',
      props: {
        verse_key: '1:7',
        surah_id: 1,
        verse_count: 2,
        rewayah_id: 'warsh',
        added: true,
      },
    });
  });

  it('sends nothing when the write fails', async () => {
    service.addBookmark.mockRejectedValueOnce(new Error('disk full'));
    await expect(
      setSelectionBookmarked(hafsSelection('36:1'), true),
    ).rejects.toThrow('disk full');
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe('notes', () => {
  it('Hafs: a new note sends verse_note_created once, and no event holds the text', async () => {
    await addSelectionNote(hafsSelection('55:13'), PRIVATE_TEXT);
    expect(service.addNote).toHaveBeenCalledTimes(1);
    expect(events()).toEqual([
      {
        event: 'verse_note_created',
        props: {
          verse_key: '55:13',
          surah_id: 55,
          verse_count: 1,
          rewayah_id: 'hafs',
        },
      },
    ]);
    expect(JSON.stringify(mockCapture.mock.calls)).not.toContain(
      'private words',
    );
  });

  it('Hafs: a note on a range is ONE event for the first verse', async () => {
    await addSelectionNote(hafsSelection('3:1', '3:2', '3:3'), PRIVATE_TEXT);
    expect(events()).toHaveLength(1);
    expect(events()[0].props).toMatchObject({
      verse_key: '3:1',
      surah_id: 3,
      verse_count: 3,
    });
  });

  it('Warsh: a new note sends verse_note_created once, and no event holds the text', async () => {
    await addSelectionNote(warshSelection('1:6', '1:7'), PRIVATE_TEXT);
    expect(service.addNote).toHaveBeenCalledTimes(1);
    expect(events()).toEqual([
      {
        event: 'verse_note_created',
        props: {
          verse_key: '1:7',
          surah_id: 1,
          verse_count: 2,
          rewayah_id: 'warsh',
        },
      },
    ]);
    expect(JSON.stringify(mockCapture.mock.calls)).not.toContain(
      'private words',
    );
  });

  it('sends nothing when the note is not saved', async () => {
    service.addNote.mockRejectedValueOnce(new Error('disk full'));
    await expect(
      addSelectionNote(hafsSelection('55:13'), PRIVATE_TEXT),
    ).rejects.toThrow('disk full');
    // A selection with no verse saves nothing.
    const none = {...hafsSelection('55:13'), anchors: []};
    await expect(addSelectionNote(none, PRIVATE_TEXT)).resolves.toBeNull();
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
