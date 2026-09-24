import {createMMKV} from 'react-native-mmkv';

const mmkv = createMMKV({id: 'mushaf-session'});

const RECENT_KEY = 'lastReadPages';
const LEGACY_KEY = 'lastReadPage';
// Sprint 23 (S23.3) — bumped 5 → 10 to match RFC-011's MAX_HISTORY_SIZE.
// The Continue-Reading carousel caps *display* to
// `branding.continueReadingHistorySize`; the store keeps enough history
// to satisfy any value in the RFC-011 [1, 10] range.
const MAX_RECENT = 10;

export type RecentPage = {
  page: number;
  openedAt: number;
};

function readRecent(): RecentPage[] {
  const raw = mmkv.getString(RECENT_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as RecentPage[];
    } catch {
      // fall through to legacy migration
    }
  }
  const legacy = mmkv.getNumber(LEGACY_KEY);
  if (typeof legacy === 'number' && legacy > 0) {
    return [{page: legacy, openedAt: Date.now()}];
  }
  return [];
}

function writeRecent(list: RecentPage[]): void {
  mmkv.set(RECENT_KEY, JSON.stringify(list));
}

export const mushafSessionStore = {
  getLastScreenWasMushaf: (): boolean =>
    mmkv.getBoolean('lastScreenWasMushaf') ?? false,
  setLastScreenWasMushaf: (v: boolean): void =>
    mmkv.set('lastScreenWasMushaf', v),

  /** Returns the most recently opened page, or null when no reading history. */
  getLastReadPage: (): number | null => {
    const list = readRecent();
    return list[0]?.page ?? null;
  },

  /**
   * Record a page turn. Dedupes (existing entry for the page is removed first),
   * prepends, then trims to MAX_RECENT. Keeps the legacy `lastReadPage` key in
   * sync for any reader that still expects a single number.
   */
  setLastReadPage: (p: number): void => {
    const list = readRecent();
    const without = list.filter(entry => entry.page !== p);
    const next = [{page: p, openedAt: Date.now()}, ...without].slice(
      0,
      MAX_RECENT,
    );
    writeRecent(next);
    mmkv.set(LEGACY_KEY, p);
  },

  /** Returns up to MAX_RECENT recent pages, most-recent first. */
  getRecentPages: (): RecentPage[] => readRecent(),
};
