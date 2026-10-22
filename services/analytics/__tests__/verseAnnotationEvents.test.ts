// @ai Qariah (TECH_DEBT #297, Sprint 47) — the verse annotation events: which
// verse an event names, the properties it carries, and that nothing the user
// typed can reach it. The events go through qariahAnalytics and then
// captureDiagnosticEvent, so the consent gate and the dev/simulator drop apply.

const mockCaptureDiagnosticEvent = jest.fn();
jest.mock('../AnalyticsService', () => ({
  analyticsService: {
    captureDiagnosticEvent: (...args: unknown[]) =>
      mockCaptureDiagnosticEvent(...args),
  },
}));

import {
  trackVerseBookmarkToggled,
  trackVerseHighlightChanged,
  trackVerseNoteCreated,
  trackVerseNoteDeleted,
  verseAnnotationProps,
  versesOfSaved,
  versesOfSelection,
} from '../verseAnnotationEvents';

const sent = () =>
  mockCaptureDiagnosticEvent.mock.calls.map(([event, props]) => ({
    event,
    props,
  }));

describe('verseAnnotationEvents', () => {
  beforeEach(() => mockCaptureDiagnosticEvent.mockClear());

  describe('verseAnnotationProps', () => {
    it('names the first verse, its surah, and how many verses the action covered', () => {
      expect(
        verseAnnotationProps({
          keys: ['2:255', '2:256', '2:257'],
          rewayahId: 'hafs',
        }),
      ).toEqual({
        verse_key: '2:255',
        surah_id: 2,
        verse_count: 3,
        rewayah_id: 'hafs',
      });
    });

    it('reports a word-anchored (split) verse as surah:ayah', () => {
      expect(
        verseAnnotationProps({keys: ['1:7:5'], rewayahId: 'warsh'}),
      ).toEqual({
        verse_key: '1:7',
        surah_id: 1,
        verse_count: 1,
        rewayah_id: 'warsh',
      });
    });

    it('sends rewayah_id as null when the rewayah is unknown', () => {
      expect(verseAnnotationProps({keys: ['114:6']})?.rewayah_id).toBeNull();
      expect(
        verseAnnotationProps({keys: ['114:6'], rewayahId: null})?.rewayah_id,
      ).toBeNull();
    });

    it.each([
      [[]],
      [['']],
      [['abc']],
      [['2']],
      [['2:']],
      [['0:1']],
      [['115:1']],
      [['2:0']],
      [['2:255:x']],
      [['2:255 and my private words']],
    ])('gives no properties for the keys %j', keys => {
      expect(verseAnnotationProps({keys})).toBeNull();
    });
  });

  describe('adapters', () => {
    it('versesOfSelection uses the storage anchors and the selection rewayah', () => {
      expect(
        versesOfSelection({
          anchors: [{key: '1:7:1'}, {key: '1:7:5'}],
          rewayah: 'warsh',
        }),
      ).toEqual({keys: ['1:7:1', '1:7:5'], rewayahId: 'warsh'});
    });

    it('versesOfSaved uses all the keys of a range note, else the one key', () => {
      expect(
        versesOfSaved({
          verseKey: '3:1',
          verseKeys: ['3:1', '3:2'],
          rewayahId: 'hafs',
        }),
      ).toEqual({keys: ['3:1', '3:2'], rewayahId: 'hafs'});
      expect(versesOfSaved({verseKey: '3:1'})).toEqual({
        keys: ['3:1'],
        rewayahId: undefined,
      });
      expect(versesOfSaved({verseKey: '3:1', verseKeys: []}).keys).toEqual([
        '3:1',
      ]);
    });
  });

  describe('the events', () => {
    const verses = {keys: ['18:10', '18:11'], rewayahId: 'hafs'};
    const base = {
      verse_key: '18:10',
      surah_id: 18,
      verse_count: 2,
      rewayah_id: 'hafs',
    };

    it('verse_note_created', () => {
      trackVerseNoteCreated(verses);
      expect(sent()).toEqual([{event: 'verse_note_created', props: base}]);
    });

    it('verse_note_deleted', () => {
      trackVerseNoteDeleted(verses);
      expect(sent()).toEqual([{event: 'verse_note_deleted', props: base}]);
    });

    it('verse_highlight_set carries the colour id', () => {
      trackVerseHighlightChanged(verses, 'purple');
      expect(sent()).toEqual([
        {event: 'verse_highlight_set', props: {...base, color: 'purple'}},
      ]);
    });

    it('verse_highlight_removed has no colour', () => {
      trackVerseHighlightChanged(verses, null);
      expect(sent()).toEqual([{event: 'verse_highlight_removed', props: base}]);
    });

    it('verse_bookmark_toggled carries added', () => {
      trackVerseBookmarkToggled(verses, true);
      trackVerseBookmarkToggled(verses, false);
      expect(sent()).toEqual([
        {event: 'verse_bookmark_toggled', props: {...base, added: true}},
        {event: 'verse_bookmark_toggled', props: {...base, added: false}},
      ]);
    });

    it('sends nothing for a key that is not a verse key', () => {
      trackVerseNoteCreated({keys: ['not a key']});
      trackVerseNoteDeleted({keys: []});
      trackVerseHighlightChanged({keys: ['0:0']}, 'blue');
      trackVerseBookmarkToggled({keys: ['x']}, true);
      expect(mockCaptureDiagnosticEvent).not.toHaveBeenCalled();
    });

    it('never throws into the action that called it', () => {
      const warn = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      mockCaptureDiagnosticEvent.mockImplementationOnce(() => {
        throw new Error('posthog is down');
      });
      expect(() => trackVerseNoteCreated(verses)).not.toThrow();
      warn.mockRestore();
    });

    it('sends only the known properties', () => {
      trackVerseNoteCreated(verses);
      trackVerseHighlightChanged(verses, 'green');
      trackVerseBookmarkToggled(verses, true);
      const allowed = new Set([
        'verse_key',
        'surah_id',
        'verse_count',
        'rewayah_id',
        'color',
        'added',
      ]);
      for (const {props} of sent()) {
        for (const name of Object.keys(props)) expect(allowed).toContain(name);
      }
    });
  });
});
