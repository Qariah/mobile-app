// @ai
// #388 — the suppression boundary of the `v1-restore-zero-merge` alarm.
//
// QARIAHV2-2P fired at level:'error' on a healthy re-run. The repair is a
// detector fix, so the thing under test is the alarm's own judgement: it must
// stay quiet for the two outcomes that only LOOK like a silent failure, and it
// must still fire for everything else — in particular for a merge whose items
// were eaten by the skip filters, which is a real failure that also lands on
// `restored === 0`.
//
// Without this the regression returns silently: nothing else in the app
// notices an alarm that has stopped alarming.

// The component module reaches AnalyticsService (→ MMKV) and v1Restore
// (→ expo-crypto) at import time; neither has a native module in jest. Same
// stubs as services/analytics/__tests__/AnalyticsService.test.ts.
const mockMmkvStorage = new Map<string, string>();
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: (key: string) => mockMmkvStorage.get(key),
    set: (key: string, value: string) => mockMmkvStorage.set(key, value),
    delete: (key: string) => mockMmkvStorage.delete(key),
    getAllKeys: () => Array.from(mockMmkvStorage.keys()),
  }),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-device-id',
}));

jest.mock('@/services/userState', () => ({
  enqueueFavoritesSync: jest.fn(),
  enqueueReadingSessionSync: jest.fn(),
  enqueuePreferenceSync: jest.fn(),
}));

// RECITERS is populated in-place at runtime; empty is fine here because the
// predicate never touches the catalog.
jest.mock('@/data/reciterData', () => ({RECITERS: []}));

// The sheet chassis pulls gorhom → reanimated → worklets, whose native part
// cannot initialize under jest. The predicate has nothing to do with the
// sheet, so stub the chassis rather than reaching into a third party's
// internals (components/__tests__/BottomSheetModal.test.tsx mocks gorhom
// itself, because that test IS about the sheet).
jest.mock('@/components/BottomSheetModal', () => ({
  __esModule: true,
  default: () => null,
}));

// `burnt` ships untransformed ESM and is outside the preset's transform
// allowlist, so importing the toast helper throws at parse time.
jest.mock('@/utils/toastUtils', () => ({showToast: jest.fn()}));

// The Sentry SDK registers a module-level setInterval at import time
// (AsyncExpiringMap), which keeps the jest worker alive and forces a hard
// exit. Nothing here reports to Sentry. Same stub as
// services/diagnostics/__tests__/memoryWatch.budget.test.ts.
jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
  setContext: jest.fn(),
  flush: () => Promise.resolve(true),
}));

import {shouldReportWriteLoss, shouldReportZeroMerge} from '../V1RestoreModal';

describe('shouldReportZeroMerge', () => {
  it('stays quiet when every offered item was already present', () => {
    // The benign re-run: Settings → Your Data on a device that already merged.
    // restored 0, every skip 0 — the shape that used to page at level:'error'.
    expect(shouldReportZeroMerge(3, 0, 3)).toBe(false);
  });

  it('fires when only part of the candidate was already present', () => {
    // Two items offered: one was already there, one was eaten by a skip
    // filter. Something really did go missing, so the alarm must still fire.
    expect(shouldReportZeroMerge(2, 0, 1)).toBe(true);
  });

  it('stays quiet when the candidate offered nothing', () => {
    // The empty-state, not a failure. Nothing offered, nothing landing.
    expect(shouldReportZeroMerge(0, 0, 0)).toBe(false);
  });

  it('stays quiet whenever anything at all landed', () => {
    expect(shouldReportZeroMerge(3, 1, 0)).toBe(false);
  });

  it('fires on the unexplained zero — nothing landed, nothing accounted for', () => {
    // The original signal this alarm exists for.
    expect(shouldReportZeroMerge(1, 0, 0)).toBe(true);
  });
});

// #394 — the failure `shouldReportZeroMerge` cannot see. A full device
// (QARIAHV2-20) throws inside the plain-surah write, so those rows never reach
// disk; the reciter and recitation merges still succeed, leaving `restored > 0`.
// Every condition in the zero-merge predicate is gated on `restored === 0`, so
// the loss needs its own trigger or it reports through nothing at all.
describe('shouldReportWriteLoss', () => {
  it('fires on a partial loss the zero-merge alarm is blind to', () => {
    // Three items offered, two landed, one surah eaten by the failed write.
    expect(shouldReportZeroMerge(3, 2, 0)).toBe(false); // the blindness
    expect(shouldReportWriteLoss(1)).toBe(true); // the report
  });

  it('fires even when the whole merge otherwise succeeded', () => {
    expect(shouldReportWriteLoss(5)).toBe(true);
  });

  it('stays quiet when nothing was lost', () => {
    // The overwhelming majority of merges. This must not add noise to a
    // healthy restore.
    expect(shouldReportWriteLoss(0)).toBe(false);
  });
});
