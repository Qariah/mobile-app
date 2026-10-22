// @ai-generated
// Qariah (Sprint 48, S48.8): the "new features in this build" rule, branch by
// branch.
import {
  announcementAction,
  whatsNewCandidate,
  type AnnouncementAction,
  type AnnouncementActionInput,
} from '../announcement';

const ID = '2026-10-sprint48';

describe('announcementAction', () => {
  const table: [string, AnnouncementActionInput, AnnouncementAction][] = [
    [
      'no announcement in this build (foreground)',
      {
        currentId: null,
        lastAnnouncedId: null,
        isFreshInstall: false,
        context: 'foreground',
      },
      'none',
    ],
    [
      'no announcement in this build (background)',
      {
        currentId: null,
        lastAnnouncedId: '2026-09-sprint44',
        isFreshInstall: false,
        context: 'background',
      },
      'none',
    ],
    [
      'an empty id counts as no announcement',
      {
        currentId: '',
        lastAnnouncedId: null,
        isFreshInstall: false,
        context: 'background',
      },
      'none',
    ],
    [
      'a fresh install records the id (foreground)',
      {
        currentId: ID,
        lastAnnouncedId: null,
        isFreshInstall: true,
        context: 'foreground',
      },
      'record',
    ],
    [
      'a fresh install records the id (background)',
      {
        currentId: ID,
        lastAnnouncedId: null,
        isFreshInstall: true,
        context: 'background',
      },
      'record',
    ],
    [
      'the same id again does nothing (foreground)',
      {
        currentId: ID,
        lastAnnouncedId: ID,
        isFreshInstall: false,
        context: 'foreground',
      },
      'none',
    ],
    [
      'the same id again does nothing (background)',
      {
        currentId: ID,
        lastAnnouncedId: ID,
        isFreshInstall: false,
        context: 'background',
      },
      'none',
    ],
    [
      'the same id on a "fresh install" does nothing',
      {
        currentId: ID,
        lastAnnouncedId: ID,
        isFreshInstall: true,
        context: 'background',
      },
      'none',
    ],
    [
      'a new id in the foreground records it and cancels a pending notice',
      {
        currentId: ID,
        lastAnnouncedId: '2026-09-sprint44',
        isFreshInstall: false,
        context: 'foreground',
      },
      'record_and_cancel_pending',
    ],
    [
      'a new id in the background gives a candidate',
      {
        currentId: ID,
        lastAnnouncedId: '2026-09-sprint44',
        isFreshInstall: false,
        context: 'background',
      },
      'candidate',
    ],
    [
      'the upgrade to the first build with announcements announces (background)',
      {
        currentId: ID,
        lastAnnouncedId: null,
        isFreshInstall: false,
        context: 'background',
      },
      'candidate',
    ],
    [
      'the upgrade to the first build with announcements, opened first',
      {
        currentId: ID,
        lastAnnouncedId: null,
        isFreshInstall: false,
        context: 'foreground',
      },
      'record_and_cancel_pending',
    ],
    [
      'an older id than the last recorded one (a downgrade) does nothing (background)',
      {
        currentId: '2026-09-sprint44',
        lastAnnouncedId: ID,
        isFreshInstall: false,
        context: 'background',
      },
      'none',
    ],
    [
      'an older id than the last recorded one does nothing (foreground)',
      {
        currentId: '2026-09-sprint44',
        lastAnnouncedId: ID,
        isFreshInstall: false,
        context: 'foreground',
      },
      'none',
    ],
    [
      'a newer id than the last recorded one announces',
      {
        currentId: '2026-12-sprint52',
        lastAnnouncedId: ID,
        isFreshInstall: false,
        context: 'background',
      },
      'candidate',
    ],
  ];

  it('ids in the YYYY-MM-<slug> format sort by date', () => {
    expect(ID > '2026-09-sprint44').toBe(true);
    expect(ID < '2026-12-sprint52').toBe(true);
    expect(ID < '2027-01-sprint53').toBe(true);
  });

  it.each(table)('%s', (_name, input, expected) => {
    expect(announcementAction(input)).toBe(expected);
  });
});

describe('whatsNewCandidate', () => {
  it('uses the announcement text and opens the Listen tab', () => {
    expect(whatsNewCandidate(ID)).toEqual({
      type: 'whats_new',
      title: {key: `qariah:announcement.${ID}.title`},
      body: {key: `qariah:announcement.${ID}.body`},
      target: {kind: 'listen'},
      dedupeKey: `whats_new:${ID}`,
      coveredKeys: [],
    });
  });
});
