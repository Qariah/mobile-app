// @ai Qariah (Lite mode plan, section 7h) — Listen waits for a restored reader.
const mockSession = {lastScreenWasMushaf: true};
jest.mock('@/services/mushaf/MushafSessionStore', () => ({
  mushafSessionStore: {
    getLastScreenWasMushaf: () => mockSession.lastScreenWasMushaf,
  },
}));

import {
  LISTEN_AFTER_PAGE_MS,
  SAFETY_MS,
  endReaderRestore,
  isListenWaitingForReader,
  noteReaderPageDrawn,
  readerViewReportsNoDraw,
  resetReaderRestoreGateForTests,
  whenReaderPageDrawn,
} from '../readerRestoreGate';

beforeEach(() => {
  jest.useFakeTimers();
  mockSession.lastScreenWasMushaf = true;
  resetReaderRestoreGateForTests();
});
afterEach(() => {
  resetReaderRestoreGateForTests();
  jest.useRealTimers();
});

it('waits only when the last screen was the reader', () => {
  mockSession.lastScreenWasMushaf = false;
  expect(isListenWaitingForReader()).toBe(false);
  noteReaderPageDrawn();
  expect(isListenWaitingForReader()).toBe(false);
});

it('keeps the first answer of the launch', () => {
  expect(isListenWaitingForReader()).toBe(true);
  // The reader writes the flag while it is open: the launch's answer stays.
  mockSession.lastScreenWasMushaf = false;
  expect(isListenWaitingForReader()).toBe(true);
});

it('ends the wait a second after the first page draw', () => {
  expect(isListenWaitingForReader()).toBe(true);
  noteReaderPageDrawn();
  jest.advanceTimersByTime(LISTEN_AFTER_PAGE_MS - 1);
  noteReaderPageDrawn(); // a later page does not move the end
  expect(isListenWaitingForReader()).toBe(true);
  jest.advanceTimersByTime(1);
  expect(isListenWaitingForReader()).toBe(false);
});

it('ends the wait at once on request, and at the latest after SAFETY_MS', () => {
  expect(isListenWaitingForReader()).toBe(true);
  endReaderRestore();
  expect(isListenWaitingForReader()).toBe(false);

  resetReaderRestoreGateForTests();
  expect(isListenWaitingForReader()).toBe(true);
  jest.advanceTimersByTime(SAFETY_MS);
  expect(isListenWaitingForReader()).toBe(false);
});

it('settles the page promise at the first page draw, or at once with no restore', async () => {
  let drawn = false;
  void whenReaderPageDrawn().then(() => {
    drawn = true;
  });
  await Promise.resolve();
  expect(drawn).toBe(false);
  noteReaderPageDrawn();
  await Promise.resolve();
  expect(drawn).toBe(true);

  resetReaderRestoreGateForTests();
  mockSession.lastScreenWasMushaf = false;
  await expect(whenReaderPageDrawn()).resolves.toBeUndefined();
});

it('names the views that note the page at mount', () => {
  // Only the Mushaf pages (also inside a spread) report their draw.
  expect(readerViewReportsNoDraw('horizontal', 'mushaf')).toBe(false);
  expect(readerViewReportsNoDraw('horizontal', 'list')).toBe(true);
  expect(readerViewReportsNoDraw('vertical', 'mushaf')).toBe(true);
  expect(readerViewReportsNoDraw('vertical', 'list')).toBe(true);
});
