// @ai-generated
// Qariah (Sprint 48, S48.6): the candidates, the daily pick and the held-back
// keys of the notification engine.
import type {Reciter, Rewayat, SurahMetadata} from '@/data/reciterData';
import {whatsNewCandidate} from '../announcement';
import {recitationKeysOf} from '../catalogDiff';
import {DEFAULT_NOTIFICATION_TYPE_PREFS} from '../prefsStore';
import {
  CONTINUE_LISTENING_DELAY_DAYS,
  KAHF_FRIDAY_TRIGGER,
  NOTIFICATION_PRIORITY,
  RECITATION_SUMMARY_MIN_COUNT,
  buildRecitationCandidates,
  continueListeningCandidate,
  continueListeningTrigger,
  heldBackKeys,
  kahfFridayCandidate,
  localDay,
  pickNotification,
  type PickNotificationInput,
} from '../scheduler';
import {
  NOTIFICATION_TEXT_KEYS,
  NOTIFICATION_TYPES,
  type NotificationCandidate,
  type NotificationText,
  type NotificationType,
} from '../types';

// The prefs store reaches AsyncStorage and Sentry; neither matters here.
jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

const CONTINUE_TEXT = {surahName: 'Al-Kahf', reciterName: 'Zaynab'};

function rewayah(
  id: string,
  surahs: {surah: number; addedAt?: string; range?: [number, number]}[],
): Rewayat {
  const metadata: SurahMetadata[] = surahs.map(s => ({
    surah: s.surah,
    is_full: !s.range,
    ...(s.range ? {range: {from: s.range[0], to: s.range[1]}} : {}),
    ...(s.addedAt ? {added_at: s.addedAt} : {}),
  }));
  return {
    id,
    reciter_id: 'unused',
    name: "Hafs A'n Assem",
    style: 'murattal',
    server: 'https://example.invalid/audio',
    surah_total: surahs.length,
    surah_list: surahs.map(s => s.surah),
    source_type: 'qariah',
    created_at: '2026-01-01T00:00:00Z',
    surah_metadata: metadata,
  };
}

function reciter(
  id: string,
  name: string,
  rewayat: Rewayat[],
  slug: string | null = `${id}-slug`,
): Reciter {
  return {id, name, slug, date: null, image_url: null, rewayat};
}

/** Every key of a catalog: "everything is new". */
function allKeys(reciters: Reciter[]): string[] {
  return [...recitationKeysOf(reciters)];
}

function textKey(text: NotificationText | undefined): string | undefined {
  return text && 'key' in text ? text.key : undefined;
}

function textParams(text: NotificationText | undefined) {
  return text && 'key' in text ? text.params : undefined;
}

describe('buildRecitationCandidates', () => {
  const zaynab = reciter('r-zaynab', 'Zaynab Talha', [
    rewayah('w-z', [{surah: 18, addedAt: '2026-10-19'}]),
  ]);
  const amina = reciter('r-amina', 'Amina Ali', [
    rewayah('w-a', [{surah: 36, addedAt: '2026-10-18', range: [1, 40]}]),
  ]);

  it('gives nothing for no new keys', () => {
    expect(
      buildRecitationCandidates({
        newKeys: [],
        reciters: [zaynab],
        favoriteReciterIds: [],
      }),
    ).toEqual([]);
  });

  it('a favorite reciter gives followed_recitation only; another gives new_recitation', () => {
    const candidates = buildRecitationCandidates({
      newKeys: allKeys([zaynab, amina]),
      reciters: [zaynab, amina],
      favoriteReciterIds: ['r-zaynab'],
    });
    expect(candidates.map(c => [c.type, c.dedupeKey, c.coveredKeys])).toEqual([
      [
        'followed_recitation',
        'followed_recitation:r-zaynab|w-z|18||',
        ['r-zaynab|w-z|18||'],
      ],
      [
        'new_recitation',
        'new_recitation:r-amina|w-a|36|1|40',
        ['r-amina|w-a|36|1|40'],
      ],
    ]);
  });

  it('builds the text keys, the params and the tap target of one recitation', () => {
    const [followed, other] = buildRecitationCandidates({
      newKeys: allKeys([zaynab, amina]),
      reciters: [zaynab, amina],
      favoriteReciterIds: ['r-zaynab'],
      formatReciterName: r => `name:${r.id}`,
      formatSurahName: surah => `surah:${surah}`,
    });
    expect(followed.title).toEqual({
      key: 'qariah:notifications.followedRecitation.title',
      params: {reciterName: 'name:r-zaynab'},
    });
    expect(followed.body).toEqual({
      key: 'qariah:notifications.followedRecitation.body',
      params: {surahName: 'surah:18', reciterName: 'name:r-zaynab'},
    });
    expect(followed.target).toEqual({
      kind: 'recitation',
      reciterId: 'r-zaynab',
      reciterSlug: 'r-zaynab-slug',
      rewayahId: 'w-z',
      surah: 18,
    });
    // A partial recording names its range.
    expect(other.title).toEqual({
      key: 'qariah:notifications.newRecitation.title',
      params: {reciterName: 'name:r-amina'},
    });
    expect(other.body).toEqual({
      key: 'qariah:notifications.newRecitation.bodyRange',
      params: {
        surahName: 'surah:36',
        reciterName: 'name:r-amina',
        from: 1,
        to: 40,
      },
    });
  });

  it('defaults to the catalog name and the surah number; a missing slug is null', () => {
    const noSlug = reciter(
      'r-x',
      'Reciter X',
      [rewayah('w-x', [{surah: 1}])],
      null,
    );
    const [candidate] = buildRecitationCandidates({
      newKeys: allKeys([noSlug]),
      reciters: [noSlug],
      favoriteReciterIds: [],
    });
    expect(textParams(candidate.title)).toEqual({reciterName: 'Reciter X'});
    expect(textParams(candidate.body)).toEqual({
      surahName: '1',
      reciterName: 'Reciter X',
    });
    expect(candidate.target).toMatchObject({reciterSlug: null});
  });

  it('skips a key that is not in the catalog', () => {
    expect(
      buildRecitationCandidates({
        newKeys: ['gone|w|1||'],
        reciters: [zaynab],
        favoriteReciterIds: [],
      }),
    ).toEqual([]);
  });

  it('one recitation of a type gives a single candidate', () => {
    expect(RECITATION_SUMMARY_MIN_COUNT).toBe(2);
    const one = reciter('r-1', 'One', [rewayah('w-1', [{surah: 1}])]);
    const candidates = buildRecitationCandidates({
      newKeys: allKeys([one]),
      reciters: [one],
      favoriteReciterIds: [],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].target.kind).toBe('recitation');
  });

  it('2 new recitations of one type give ONE summary that covers both (no recitation is lost to the daily limit)', () => {
    const two = reciter('r-2', 'Two', [
      rewayah('w-2', [
        {surah: 18, addedAt: '2026-10-19'},
        {surah: 36, addedAt: '2026-10-20'},
      ]),
    ]);
    const candidates = buildRecitationCandidates({
      newKeys: allKeys([two]),
      reciters: [two],
      favoriteReciterIds: ['r-2'],
    });
    expect(candidates).toHaveLength(1);
    const [summary] = candidates;
    expect(summary.type).toBe('followed_recitation');
    expect(summary.title).toEqual({
      key: 'qariah:notifications.followedRecitationSummary.title',
    });
    expect(summary.body).toEqual({
      key: 'qariah:notifications.followedRecitationSummary.body',
      params: {count: 2, reciterName: 'Two'},
    });
    expect(summary.target).toEqual({kind: 'listen'});
    // Newest first.
    expect(summary.coveredKeys).toEqual(['r-2|w-2|36||', 'r-2|w-2|18||']);
  });

  it('a summary names the reciter of the newest recitation and covers each key, newest first', () => {
    const older = reciter('r-old', 'Older Reciter', [
      rewayah('w-o', [
        {surah: 1, addedAt: '2026-10-01'},
        {surah: 2, addedAt: '2026-10-02'},
        {surah: 3},
      ]),
    ]);
    const newest = reciter('r-new', 'Newest Reciter', [
      rewayah('w-n', [{surah: 67, addedAt: '2026-10-19'}]),
    ]);
    const candidates = buildRecitationCandidates({
      newKeys: allKeys([older, newest]),
      reciters: [older, newest],
      favoriteReciterIds: [],
    });
    expect(candidates).toHaveLength(1);
    const [summary] = candidates;
    expect(summary.type).toBe('new_recitation');
    expect(summary.title).toEqual({
      key: 'qariah:notifications.newRecitationSummary.title',
    });
    expect(summary.body).toEqual({
      key: 'qariah:notifications.newRecitationSummary.body',
      params: {count: 4, reciterName: 'Newest Reciter'},
    });
    expect(summary.dedupeKey).toBe('new_recitation:summary:4:r-new|w-n|67||');
    // A recitation without a date comes last.
    expect(summary.coveredKeys).toEqual([
      'r-new|w-n|67||',
      'r-old|w-o|2||',
      'r-old|w-o|1||',
      'r-old|w-o|3||',
    ]);
  });

  it('only covers the new keys', () => {
    const many = reciter('r-m', 'Maryam', [
      rewayah('w-m', [{surah: 1}, {surah: 2}, {surah: 3}]),
    ]);
    const [summary] = buildRecitationCandidates({
      newKeys: ['r-m|w-m|1||', 'r-m|w-m|3||'],
      reciters: [many],
      favoriteReciterIds: [],
    });
    expect(summary.coveredKeys).toEqual(['r-m|w-m|1||', 'r-m|w-m|3||']);
    expect(textParams(summary.body)).toEqual({count: 2, reciterName: 'Maryam'});
  });

  it('summarises each type on its own', () => {
    const fav = reciter('r-fav', 'Favorite', [
      rewayah('w-f', [
        {surah: 1, addedAt: '2026-10-10'},
        {surah: 2, addedAt: '2026-10-11'},
        {surah: 3, addedAt: '2026-10-12'},
      ]),
    ]);
    const candidates = buildRecitationCandidates({
      newKeys: allKeys([fav, zaynab]),
      reciters: [fav, zaynab],
      favoriteReciterIds: ['r-fav'],
    });
    expect(candidates.map(c => c.type)).toEqual([
      'followed_recitation',
      'new_recitation',
    ]);
    const [followedSummary, single] = candidates;
    expect(followedSummary.body).toEqual({
      key: 'qariah:notifications.followedRecitationSummary.body',
      params: {count: 3, reciterName: 'Favorite'},
    });
    expect(followedSummary.coveredKeys).toHaveLength(3);
    expect(single.target.kind).toBe('recitation');
  });
});

function fakeCandidate(
  type: NotificationType,
  dedupeKey: string,
  coveredKeys: string[] = [],
): NotificationCandidate {
  return {
    type,
    title: {text: dedupeKey},
    target: {kind: 'listen'},
    dedupeKey,
    coveredKeys,
  };
}

describe('pickNotification', () => {
  const followed = fakeCandidate('followed_recitation', 'followed', ['k-f']);
  const recitation = fakeCandidate('new_recitation', 'new', ['k-n']);
  const all: NotificationCandidate[] = [
    continueListeningCandidate(CONTINUE_TEXT),
    kahfFridayCandidate(),
    recitation,
    whatsNewCandidate('2026-10-sprint48'),
    followed,
  ];

  function input(
    overrides: Partial<PickNotificationInput> = {},
  ): PickNotificationInput {
    return {
      candidates: all,
      prefs: {...DEFAULT_NOTIFICATION_TYPE_PREFS},
      permissionGranted: true,
      holdout: false,
      todayLocal: '2026-10-23',
      lastNotifiedDay: '2026-10-22',
      ...overrides,
    };
  }

  it('the priority is type 1, 5, 2, 3, 4', () => {
    expect(NOTIFICATION_PRIORITY).toEqual([
      'followed_recitation',
      'whats_new',
      'new_recitation',
      'kahf_friday',
      'continue_listening',
    ]);
    expect([...NOTIFICATION_PRIORITY].sort()).toEqual(
      [...NOTIFICATION_TYPES].sort(),
    );
  });

  it('picks by the priority, whatever the order of the candidates', () => {
    const order: NotificationType[] = [];
    let candidates = [...all];
    for (let i = 0; i < all.length; i++) {
      const picked = pickNotification(input({candidates}));
      if (!picked) throw new Error(`nothing picked after ${order.join(', ')}`);
      order.push(picked.type);
      candidates = candidates.filter(c => c !== picked);
    }
    expect(order).toEqual([...NOTIFICATION_PRIORITY]);
  });

  it('within one type, the first candidate wins', () => {
    const second = {...recitation, dedupeKey: 'new-2'};
    expect(
      pickNotification(input({candidates: [recitation, second]}))?.dedupeKey,
    ).toBe('new');
  });

  it('daily limit: nothing when a notice already went out today', () => {
    expect(pickNotification(input({lastNotifiedDay: '2026-10-23'}))).toBeNull();
    expect(pickNotification(input({lastNotifiedDay: null}))?.type).toBe(
      'followed_recitation',
    );
  });

  it.each(NOTIFICATION_TYPES.map(type => [type]))(
    'a toggle that is off stops %s',
    type => {
      const only = all.filter(c => c.type === type);
      expect(only).toHaveLength(1);
      expect(
        pickNotification(
          input({
            candidates: only,
            prefs: {...DEFAULT_NOTIFICATION_TYPE_PREFS, [type]: false},
          }),
        ),
      ).toBeNull();
      // The next type in the priority takes its place.
      const next = NOTIFICATION_PRIORITY.find(
        t => t !== type && all.some(c => c.type === t),
      );
      expect(
        pickNotification(
          input({prefs: {...DEFAULT_NOTIFICATION_TYPE_PREFS, [type]: false}}),
        )?.type,
      ).toBe(next);
    },
  );

  it('a missing toggle value is off', () => {
    const prefs = {...DEFAULT_NOTIFICATION_TYPE_PREFS} as Record<
      string,
      boolean
    >;
    delete prefs.followed_recitation;
    expect(
      pickNotification(
        input({
          candidates: [followed],
          prefs: prefs as typeof DEFAULT_NOTIFICATION_TYPE_PREFS,
        }),
      ),
    ).toBeNull();
  });

  it('a holdout user gets nothing', () => {
    expect(pickNotification(input({holdout: true}))).toBeNull();
  });

  it('nothing without the permission', () => {
    expect(pickNotification(input({permissionGranted: false}))).toBeNull();
  });

  it('nothing when there is no candidate', () => {
    expect(pickNotification(input({candidates: []}))).toBeNull();
  });
});

describe('heldBackKeys', () => {
  const followed = fakeCandidate('followed_recitation', 'f', ['k-f1', 'k-f2']);
  const recitation = fakeCandidate('new_recitation', 'n', ['k-n']);
  const whatsNew = whatsNewCandidate('2026-10-sprint48');
  const base: PickNotificationInput = {
    candidates: [recitation, whatsNew, followed],
    prefs: {...DEFAULT_NOTIFICATION_TYPE_PREFS},
    permissionGranted: true,
    holdout: false,
    todayLocal: '2026-10-23',
    lastNotifiedDay: null,
  };

  it('holds back the keys of a candidate that lost to the order', () => {
    const picked = pickNotification(base);
    expect(picked).toBe(followed);
    expect(heldBackKeys(base, picked)).toEqual(['k-n']);
  });

  it('holds back every enabled candidate when the daily limit stops the day', () => {
    const limited = {...base, lastNotifiedDay: '2026-10-23'};
    expect(pickNotification(limited)).toBeNull();
    expect(heldBackKeys(limited, null).sort()).toEqual(['k-f1', 'k-f2', 'k-n']);
  });

  it('drops (does not hold back) the keys of a type that is off', () => {
    const off = {
      ...base,
      prefs: {...DEFAULT_NOTIFICATION_TYPE_PREFS, new_recitation: false},
    };
    expect(heldBackKeys(off, pickNotification(off))).toEqual([]);
  });

  it('drops every key for a holdout user and without permission', () => {
    expect(heldBackKeys({...base, holdout: true}, null)).toEqual([]);
    expect(heldBackKeys({...base, permissionGranted: false}, null)).toEqual([]);
  });
});

describe('the scheduled types', () => {
  it('the Al-Kahf reminder opens surah 18, each Friday at 09:00', () => {
    expect(kahfFridayCandidate()).toMatchObject({
      type: 'kahf_friday',
      target: {kind: 'surah', surah: 18},
      coveredKeys: [],
    });
    expect(KAHF_FRIDAY_TRIGGER).toEqual({
      kind: 'weekly',
      weekday: 6,
      hour: 9,
      minute: 0,
    });
  });

  it('"continue listening" restores the session, 3 calendar days after the last play', () => {
    expect(continueListeningCandidate(CONTINUE_TEXT).target).toEqual({
      kind: 'continue_listening',
    });
    // The text names the track of the last play.
    expect(continueListeningCandidate(CONTINUE_TEXT).body).toEqual({
      key: 'qariah:notifications.continueListening.body',
      params: {surahName: 'Al-Kahf', reciterName: 'Zaynab'},
    });
    const lastPlay = new Date(2026, 9, 20, 18, 15);
    const trigger = continueListeningTrigger(lastPlay);
    expect(trigger.kind).toBe('date');
    const at = new Date((trigger as {at: number}).at);
    expect([at.getFullYear(), at.getMonth(), at.getDate()]).toEqual([
      2026, 9, 23,
    ]);
    expect([at.getHours(), at.getMinutes()]).toEqual([18, 15]);
  });

  it.each([
    // [play hour, play minute] → [notice hour, notice minute]
    [
      [0, 0],
      [9, 0],
    ],
    [
      [8, 59],
      [9, 0],
    ],
    [
      [9, 0],
      [9, 0],
    ],
    [
      [9, 1],
      [9, 1],
    ],
    [
      [20, 59],
      [20, 59],
    ],
    [
      [21, 0],
      [20, 0],
    ],
    [
      [23, 59],
      [20, 0],
    ],
  ])(
    'keeps the notice in the day window: a play at %j gives %j, 3 days later',
    ([playHour, playMinute], [hour, minute]) => {
      const lastPlay = new Date(2026, 9, 20, playHour, playMinute, 30);
      const at = new Date(
        (continueListeningTrigger(lastPlay) as {at: number}).at,
      );
      expect(at.getDate()).toBe(23);
      expect([at.getHours(), at.getMinutes()]).toEqual([hour, minute]);
      // A moved time starts at the full minute.
      if (hour !== playHour || minute !== playMinute) {
        expect([at.getSeconds(), at.getMilliseconds()]).toEqual([0, 0]);
      }
    },
  );

  // Jest cannot change the time zone at run time (`process.env.TZ` has no
  // effect in a test), so this case uses the summer-time changes of the local
  // zone. A zone with no summer time (for example UTC) skips it.
  const HOUR = 60 * 60 * 1000;
  const dstEves: Date[] = [];
  for (let day = new Date(2026, 0, 1, 12); day.getFullYear() === 2026; ) {
    const nextDay = new Date(day);
    nextDay.setDate(day.getDate() + 1);
    if (nextDay.getTimezoneOffset() !== day.getTimezoneOffset()) {
      dstEves.push(new Date(day));
    }
    day = nextDay;
  }
  (dstEves.length > 0 ? it : it.skip)(
    'keeps the time of day across a summer-time change (local zone)',
    () => {
      for (const eve of dstEves) {
        const lastPlay = new Date(eve);
        lastPlay.setHours(20, 15, 0, 0);
        const at = new Date(
          (continueListeningTrigger(lastPlay) as {at: number}).at,
        );
        expect([at.getHours(), at.getMinutes()]).toEqual([20, 15]);
        const expectedDay = new Date(lastPlay);
        expectedDay.setDate(lastPlay.getDate() + CONTINUE_LISTENING_DELAY_DAYS);
        expect(at.getDate()).toBe(expectedDay.getDate());
        // The clock moved, so the gap is not 72 hours.
        const gap = at.getTime() - lastPlay.getTime();
        expect(gap).not.toBe(CONTINUE_LISTENING_DELAY_DAYS * 24 * HOUR);
        expect(Math.abs(gap - CONTINUE_LISTENING_DELAY_DAYS * 24 * HOUR)).toBe(
          Math.abs(at.getTimezoneOffset() - lastPlay.getTimezoneOffset()) *
            60 *
            1000,
        );
        // A late play crosses the change too: 20:00, 3 calendar days later.
        const late = new Date(eve);
        late.setHours(22, 40, 0, 0);
        const lateAt = new Date(
          (continueListeningTrigger(late) as {at: number}).at,
        );
        expect([
          lateAt.getDate(),
          lateAt.getHours(),
          lateAt.getMinutes(),
        ]).toEqual([expectedDay.getDate(), 20, 0]);
      }
    },
  );
});

describe('localDay', () => {
  it('formats the local calendar day', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDay(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });
});

describe('the text keys', () => {
  it('are unique and in the qariah:notifications namespace', () => {
    expect(new Set(NOTIFICATION_TEXT_KEYS).size).toBe(
      NOTIFICATION_TEXT_KEYS.length,
    );
    for (const key of NOTIFICATION_TEXT_KEYS) {
      expect(key.startsWith('qariah:notifications.')).toBe(true);
    }
  });

  it('every key that a builder uses is in the list', () => {
    const complete = reciter('r-c', 'C', [rewayah('w-c', [{surah: 1}])]);
    const partial = reciter('r-p', 'P', [
      rewayah('w-p', [{surah: 2, range: [1, 5]}]),
    ]);
    const many = reciter('r-many', 'Many', [
      rewayah('w-many', [{surah: 1}, {surah: 2}]),
    ]);
    const build = (r: Reciter, favorite: boolean) =>
      buildRecitationCandidates({
        newKeys: allKeys([r]),
        reciters: [r],
        favoriteReciterIds: favorite ? [r.id] : [],
      });
    const candidates = [
      ...build(complete, true),
      ...build(complete, false),
      ...build(partial, true),
      ...build(partial, false),
      ...build(many, true),
      ...build(many, false),
      kahfFridayCandidate(),
      continueListeningCandidate(CONTINUE_TEXT),
    ];
    const used = new Set(
      candidates.flatMap(c => [textKey(c.title), textKey(c.body)]),
    );
    used.delete(undefined);
    expect([...used].sort()).toEqual([...NOTIFICATION_TEXT_KEYS].sort());
  });
});
