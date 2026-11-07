// @ai-generated
// Qariah (Sprint 50, TECH_DEBT #261): a link that arrives while a sheet is
// open closes the sheet before the link navigates.

type OpenSheet = {id: string; context: string};

const mockOpenSheets: OpenSheet[] = [];
const mockHide = jest.fn<Promise<unknown>, [string, {context?: string}?]>();

jest.mock('react-native-actions-sheet', () => ({
  getSheetStack: () => mockOpenSheets.map(sheet => ({...sheet})),
  SheetManager: {
    hide: (id: string, options?: {context?: string}) => mockHide(id, options),
  },
}));
jest.mock('@/services/analytics/qariahEvents', () => ({qariahAnalytics: {}}));
// expo-linking `parse` needs the app config, which Jest does not have. This
// gives the same fields for the URL shapes of this test.
jest.mock('expo-linking', () => ({
  parse: (url: string) => {
    const parsed = new URL(url);
    return {
      scheme: parsed.protocol.replace(/:$/, ''),
      hostname: parsed.hostname || null,
      path: parsed.pathname.replace(/^\/+/, '') || null,
      queryParams: Object.fromEntries(parsed.searchParams),
    };
  },
}));

import {
  SHEET_CLOSE_LIMIT_MS,
  closeOpenSheets,
  redirectSystemPath,
} from '../closeSheetsBeforeLink';
import * as nativeIntent from '@/app/+native-intent';

const MUSHAF_LINK = 'qariah://mushaf/50';

/** A hide that ends when the test calls the returned function. */
function deferredHide(): Array<() => void> {
  const ends: Array<() => void> = [];
  mockHide.mockImplementation(
    () =>
      new Promise(resolve => {
        ends.push(() => resolve(undefined));
      }),
  );
  return ends;
}

/** Records the value of `result` when it resolves. */
function track(result: string | Promise<string>): {value: string | null} {
  const seen: {value: string | null} = {value: null};
  Promise.resolve(result).then(path => {
    seen.value = path;
  });
  return seen;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  mockOpenSheets.length = 0;
  mockHide.mockReset();
  mockHide.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('redirectSystemPath', () => {
  it('is the export of app/+native-intent', () => {
    expect(nativeIntent.redirectSystemPath).toBe(redirectSystemPath);
  });

  it('gives the path back at once when no sheet is open', () => {
    expect(redirectSystemPath({path: MUSHAF_LINK, initial: false})).toBe(
      MUSHAF_LINK,
    );
    expect(mockHide).not.toHaveBeenCalled();
  });

  it('does not close a sheet for the first URL of a cold start', () => {
    mockOpenSheets.push({id: 'mushaf-layout', context: 'global'});
    expect(redirectSystemPath({path: MUSHAF_LINK, initial: true})).toBe(
      MUSHAF_LINK,
    );
    expect(mockHide).not.toHaveBeenCalled();
  });

  it('does not close a sheet for a link that does not navigate', () => {
    mockOpenSheets.push({id: 'mushaf-layout', context: 'global'});
    const oauth = 'com.qariah.app:/quranoauth2redirect?code=abc';
    expect(redirectSystemPath({path: oauth, initial: false})).toBe(oauth);
    expect(redirectSystemPath({path: 'qariah://', initial: false})).toBe(
      'qariah://',
    );
    expect(mockHide).not.toHaveBeenCalled();
  });

  it.each([
    'qariah://mushaf/50',
    'qariah://quran/2?ayah=255',
    'qariah://player',
  ])('closes the open sheet before it gives back %s', async link => {
    mockOpenSheets.push({id: 'mushaf-layout', context: 'global'});
    const ends = deferredHide();
    const result = redirectSystemPath({path: link, initial: false});
    expect(result).toBeInstanceOf(Promise);
    const settled = track(result);
    await flush();
    expect(mockHide).toHaveBeenCalledWith('mushaf-layout', {
      context: 'global',
    });
    // The link must not navigate while the sheet is still closing.
    expect(settled.value).toBeNull();
    ends[0]();
    await flush();
    expect(settled.value).toBe(link);
  });
});

describe('closeOpenSheets', () => {
  it('closes the top sheet first, and waits for each close', async () => {
    mockOpenSheets.push(
      {id: 'mushaf-layout', context: 'global'},
      {id: 'select-translation', context: 'global'},
    );
    const ends = deferredHide();
    const done = track(closeOpenSheets().then(() => 'done'));
    await flush();
    expect(mockHide.mock.calls.map(call => call[0])).toEqual([
      'select-translation',
    ]);
    ends[0]();
    await flush();
    expect(mockHide.mock.calls.map(call => call[0])).toEqual([
      'select-translation',
      'mushaf-layout',
    ]);
    expect(done.value).toBeNull();
    ends[1]();
    await flush();
    expect(done.value).toBe('done');
  });

  it('stops the wait at the time limit when a close does not end', async () => {
    jest.useFakeTimers();
    mockOpenSheets.push({id: 'mushaf-layout', context: 'global'});
    deferredHide();
    const settled = track(
      redirectSystemPath({path: MUSHAF_LINK, initial: false}),
    );
    await flush();
    jest.advanceTimersByTime(SHEET_CLOSE_LIMIT_MS - 1);
    await flush();
    expect(settled.value).toBeNull();
    jest.advanceTimersByTime(1);
    await flush();
    expect(settled.value).toBe(MUSHAF_LINK);
  });

  it('closes no more sheets after the time limit', async () => {
    jest.useFakeTimers();
    mockOpenSheets.push(
      {id: 'mushaf-layout', context: 'global'},
      {id: 'select-translation', context: 'global'},
    );
    const ends = deferredHide();
    const done = track(closeOpenSheets().then(() => 'done'));
    await flush();
    jest.advanceTimersByTime(SHEET_CLOSE_LIMIT_MS);
    await flush();
    expect(done.value).toBe('done');
    // The stuck close of the top sheet ends late. The link has already
    // opened its screen, so the sheet under it must stay.
    ends[0]();
    await flush();
    expect(mockHide.mock.calls.map(call => call[0])).toEqual([
      'select-translation',
    ]);
  });

  it('does not reject when a close fails', async () => {
    mockOpenSheets.push({id: 'mushaf-layout', context: 'global'});
    mockHide.mockRejectedValue(new Error('no sheet'));
    await expect(
      redirectSystemPath({path: MUSHAF_LINK, initial: false}),
    ).resolves.toBe(MUSHAF_LINK);
  });
});
