// @ai-generated
// Qariah (Sprint 48, S48.8, Task 18): the stored last announced id, the
// fresh-install test, the foreground record and the background candidate.
import {QARIAH_ANNOUNCEMENT_ID} from '@/config/qariahAnnouncement';
import {announcementCandidate, whatsNewCandidate} from '../announcement';
import {
  LAST_ANNOUNCED_ID_KEY,
  backgroundAnnouncementCandidate,
  clearAnnouncementNotice,
  readIsFreshInstall,
  readLastAnnouncedId,
  recordForegroundAnnouncement,
  recordPostedAnnouncement,
  writeLastAnnouncedId,
} from '../announcementStore';
import type {KeyValueStorage, Notifier} from '../types';

const ID = '2026-10-sprint48';
const OLDER_ID = '2026-09-sprint44';

function memoryStorage(
  initial: Record<string, string> = {},
): KeyValueStorage & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getString: key => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
    remove: key => {
      values.delete(key);
    },
    isAvailable: () => true,
  };
}

const unavailable: KeyValueStorage = {
  getString: () => undefined,
  set: jest.fn(),
  remove: jest.fn(),
  isAvailable: () => false,
};

const throwing: KeyValueStorage = {
  getString: () => {
    throw new Error('MMKV is not readable');
  },
  set: () => {
    throw new Error('MMKV is not writable');
  },
  remove: jest.fn(),
};

describe('the last announced id', () => {
  it('uses the key `last_announced_id`', () => {
    expect(LAST_ANNOUNCED_ID_KEY).toBe('last_announced_id');
  });

  it('is null when nothing is stored', () => {
    expect(readLastAnnouncedId(memoryStorage())).toBeNull();
    expect(
      readLastAnnouncedId(memoryStorage({[LAST_ANNOUNCED_ID_KEY]: ''})),
    ).toBeNull();
  });

  it('is undefined when the storage cannot be read', () => {
    expect(readLastAnnouncedId(unavailable)).toBeUndefined();
    expect(readLastAnnouncedId(throwing)).toBeUndefined();
  });

  it('is kept only when the read-back gives the written value', () => {
    const storage = memoryStorage();
    expect(writeLastAnnouncedId(ID, storage)).toBe(true);
    expect(readLastAnnouncedId(storage)).toBe(ID);

    const lossy: KeyValueStorage = {...memoryStorage(), set: () => undefined};
    expect(writeLastAnnouncedId(ID, lossy)).toBe(false);
    expect(writeLastAnnouncedId(ID, unavailable)).toBe(false);
    expect(writeLastAnnouncedId(ID, throwing)).toBe(false);
    expect(writeLastAnnouncedId('', memoryStorage())).toBe(false);
  });
});

describe('readIsFreshInstall', () => {
  it('is true when no app version was recorded', async () => {
    await expect(readIsFreshInstall(async () => null)).resolves.toBe(true);
  });

  it('is false after an earlier start recorded a version', async () => {
    await expect(readIsFreshInstall(async () => '3.2.1')).resolves.toBe(false);
  });

  it('counts a failed read as a fresh install (announces nothing)', async () => {
    await expect(
      readIsFreshInstall(async () => {
        throw new Error('AsyncStorage failed');
      }),
    ).resolves.toBe(true);
  });
});

describe('recordForegroundAnnouncement', () => {
  it('uses the configured id by default', () => {
    const storage = memoryStorage();
    recordForegroundAnnouncement({isFreshInstall: true, storage});
    expect(storage.values.get(LAST_ANNOUNCED_ID_KEY)).toBe(
      QARIAH_ANNOUNCEMENT_ID,
    );
  });

  it('a fresh install records the id, and no notice follows', () => {
    const storage = memoryStorage();
    expect(
      recordForegroundAnnouncement({
        currentId: ID,
        isFreshInstall: true,
        storage,
      }),
    ).toEqual({action: 'record', recorded: true});
    expect(readLastAnnouncedId(storage)).toBe(ID);
    // Before and after the record, the background gives no candidate.
    expect(
      announcementCandidate({
        currentId: ID,
        lastAnnouncedId: null,
        isFreshInstall: true,
      }),
    ).toBeNull();
    expect(
      announcementCandidate({
        currentId: ID,
        lastAnnouncedId: readLastAnnouncedId(storage) ?? null,
        isFreshInstall: false,
      }),
    ).toBeNull();
  });

  it('an upgrade with a new id records it and cancels a pending notice', () => {
    const storage = memoryStorage({[LAST_ANNOUNCED_ID_KEY]: OLDER_ID});
    // Not opened yet: the background task has a candidate.
    expect(
      announcementCandidate({
        currentId: ID,
        lastAnnouncedId: readLastAnnouncedId(storage) ?? null,
        isFreshInstall: false,
      }),
    ).toEqual(whatsNewCandidate(ID));

    expect(
      recordForegroundAnnouncement({
        currentId: ID,
        isFreshInstall: false,
        storage,
      }),
    ).toEqual({action: 'record_and_cancel_pending', recorded: true});
    expect(readLastAnnouncedId(storage)).toBe(ID);
    // Opened: the background task posts nothing any more.
    expect(
      announcementCandidate({
        currentId: ID,
        lastAnnouncedId: readLastAnnouncedId(storage) ?? null,
        isFreshInstall: false,
      }),
    ).toBeNull();
  });

  it('the upgrade to the first build with announcements records the id', () => {
    const storage = memoryStorage();
    expect(
      recordForegroundAnnouncement({
        currentId: ID,
        isFreshInstall: false,
        storage,
      }),
    ).toEqual({action: 'record_and_cancel_pending', recorded: true});
  });

  it('does nothing for the same id, an older id or no id', () => {
    const same = memoryStorage({[LAST_ANNOUNCED_ID_KEY]: ID});
    expect(
      recordForegroundAnnouncement({
        currentId: ID,
        isFreshInstall: false,
        storage: same,
      }),
    ).toEqual({action: 'none', recorded: false});

    const newer = memoryStorage({[LAST_ANNOUNCED_ID_KEY]: '2026-12-sprint52'});
    expect(
      recordForegroundAnnouncement({
        currentId: ID,
        isFreshInstall: false,
        storage: newer,
      }),
    ).toEqual({action: 'none', recorded: false});
    expect(readLastAnnouncedId(newer)).toBe('2026-12-sprint52');

    const none = memoryStorage({[LAST_ANNOUNCED_ID_KEY]: OLDER_ID});
    expect(
      recordForegroundAnnouncement({
        currentId: null,
        isFreshInstall: false,
        storage: none,
      }),
    ).toEqual({action: 'none', recorded: false});
    expect(readLastAnnouncedId(none)).toBe(OLDER_ID);
  });

  it('decides nothing when the storage cannot be read', () => {
    expect(
      recordForegroundAnnouncement({
        currentId: ID,
        isFreshInstall: false,
        storage: unavailable,
      }),
    ).toEqual({action: null, recorded: false});
    expect(
      recordForegroundAnnouncement({
        currentId: ID,
        isFreshInstall: false,
        storage: throwing,
      }),
    ).toEqual({action: null, recorded: false});
  });

  it('reports a write that did not keep the id', () => {
    const lossy: KeyValueStorage = {...memoryStorage(), set: () => undefined};
    expect(
      recordForegroundAnnouncement({
        currentId: ID,
        isFreshInstall: false,
        storage: lossy,
      }),
    ).toEqual({action: 'record_and_cancel_pending', recorded: false});
  });
});

describe('the background half (Task 16)', () => {
  it('an upgrade with a new id gives the whats_new candidate', async () => {
    const candidate = await backgroundAnnouncementCandidate({
      currentId: ID,
      storage: memoryStorage({[LAST_ANNOUNCED_ID_KEY]: OLDER_ID}),
      readFreshInstall: async () => false,
    });
    expect(candidate).toEqual(whatsNewCandidate(ID));
  });

  it('gives nothing for a fresh install, the recorded id, no id, or an unreadable storage', async () => {
    const upgrade = async () => false;
    await expect(
      backgroundAnnouncementCandidate({
        currentId: ID,
        storage: memoryStorage(),
        readFreshInstall: async () => true,
      }),
    ).resolves.toBeNull();
    await expect(
      backgroundAnnouncementCandidate({
        currentId: ID,
        storage: memoryStorage({[LAST_ANNOUNCED_ID_KEY]: ID}),
        readFreshInstall: upgrade,
      }),
    ).resolves.toBeNull();
    await expect(
      backgroundAnnouncementCandidate({
        currentId: null,
        storage: memoryStorage(),
        readFreshInstall: upgrade,
      }),
    ).resolves.toBeNull();
    await expect(
      backgroundAnnouncementCandidate({
        currentId: ID,
        storage: unavailable,
        readFreshInstall: upgrade,
      }),
    ).resolves.toBeNull();
  });

  it('records the id only when the run posted that candidate', () => {
    const candidate = whatsNewCandidate(ID);
    const storage = memoryStorage();
    expect(recordPostedAnnouncement(candidate, null, storage)).toBe(false);
    expect(
      recordPostedAnnouncement(
        candidate,
        {...candidate, type: 'followed_recitation', dedupeKey: 'other'},
        storage,
      ),
    ).toBe(false);
    expect(storage.values.has(LAST_ANNOUNCED_ID_KEY)).toBe(false);
    expect(recordPostedAnnouncement(candidate, candidate, storage)).toBe(true);
    expect(storage.values.get(LAST_ANNOUNCED_ID_KEY)).toBe(ID);
    // The next background run gives no candidate.
    expect(
      announcementCandidate({
        currentId: ID,
        lastAnnouncedId: readLastAnnouncedId(storage) ?? null,
        isFreshInstall: false,
      }),
    ).toBeNull();
  });
});

describe('clearAnnouncementNotice (Task 16)', () => {
  function notifier(): Notifier & {
    cancel: jest.Mock;
    dismissDelivered: jest.Mock;
  } {
    return {
      schedule: jest.fn(),
      cancel: jest.fn(async () => undefined),
      cancelByType: jest.fn(),
      getPermission: jest.fn(),
      dismissDelivered: jest.fn(async () => undefined),
    };
  }

  it('cancels a pending notice and dismisses a shown one, by the notice id', async () => {
    const fake = notifier();
    await clearAnnouncementNotice(ID, fake);
    expect(fake.cancel).toHaveBeenCalledWith(`whats_new:${ID}`);
    expect(fake.dismissDelivered).toHaveBeenCalledWith(`whats_new:${ID}`);
  });

  it('dismisses also when the cancel fails, and never throws', async () => {
    const fake = notifier();
    fake.cancel.mockRejectedValue(new Error('native'));
    fake.dismissDelivered.mockRejectedValue(new Error('native'));
    await expect(clearAnnouncementNotice(ID, fake)).resolves.toBeUndefined();
    expect(fake.dismissDelivered).toHaveBeenCalled();
  });
});
