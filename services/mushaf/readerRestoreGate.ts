// @ai Qariah (Lite mode plan, section 7h) — the Listen tab waits for a reader
// that the launch restores.
//
// A launch whose last screen was the reader pushes the reader over the Listen
// tab (app/_layout.tsx). Listen rendered and mounted first, under the reader
// where nobody sees it: on a Samsung A10s that held the push for 0.7 s (Lite)
// to 1.2 s (full mode), and its later work competed with the reader's first
// page. While a restore is pending, the Listen route draws an empty screen.
// The restore ends:
//   - 1 s after the reader's first page has drawn,
//   - when the launch does not push the reader (no onboarding, a deep link,
//     a share), or when the user goes back to Listen,
//   - at the latest SAFETY_MS after the first check.
import {useSyncExternalStore} from 'react';
import {mushafSessionStore} from './MushafSessionStore';

/** Listen renders this long after the restored reader's first page. */
export const LISTEN_AFTER_PAGE_MS = 1000;
/** The restore ends at the latest this long after the first check. */
export const SAFETY_MS = 15000;

let pending: boolean | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let pageTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
let pageDrawn = false;
const pageWaiters = new Set<() => void>();

function settlePageWaiters(): void {
  pageDrawn = true;
  for (const resolve of pageWaiters) resolve();
  pageWaiters.clear();
}

function isPending(): boolean {
  if (pending === null) {
    let restoring = false;
    try {
      restoring = mushafSessionStore.getLastScreenWasMushaf();
    } catch {
      restoring = false;
    }
    pending = restoring;
    if (pending) safetyTimer = setTimeout(endReaderRestore, SAFETY_MS);
  }
  return pending;
}

/** True while Listen waits for the restored reader. */
export function isListenWaitingForReader(): boolean {
  return isPending();
}

/** Ends the wait at once (idempotent). */
export function endReaderRestore(): void {
  if (!isPending()) return;
  pending = false;
  if (safetyTimer) clearTimeout(safetyTimer);
  if (pageTimer) clearTimeout(pageTimer);
  safetyTimer = null;
  pageTimer = null;
  settlePageWaiters();
  for (const listener of listeners) listener();
}

/**
 * True for a reader view with no page draw report: the continuous views
 * (vertical) and the horizontal reading view (ReadingPageView). Only the
 * Mushaf pages (DKPageView, also inside a spread) report their draw, so these
 * views note the page when they mount.
 */
export function readerViewReportsNoDraw(
  scrollDirection: string,
  viewMode: string,
): boolean {
  return scrollDirection === 'vertical' || viewMode === 'list';
}

/** The reader drew a page: Listen follows LISTEN_AFTER_PAGE_MS later. */
export function noteReaderPageDrawn(): void {
  if (!isPending() || pageTimer) return;
  settlePageWaiters();
  pageTimer = setTimeout(endReaderRestore, LISTEN_AFTER_PAGE_MS);
}

/**
 * Settles when the restored reader has drawn its first page, or when the
 * wait ends (at once when there is no restore). The splash stays until then
 * (app/_layout.tsx), so the reader shows its page and no empty frame.
 */
export function whenReaderPageDrawn(): Promise<void> {
  if (!isPending() || pageDrawn) return Promise.resolve();
  return new Promise(resolve => pageWaiters.add(resolve));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders when the wait ends. */
export function useListenWaitingForReader(): boolean {
  return useSyncExternalStore(
    subscribe,
    isListenWaitingForReader,
    isListenWaitingForReader,
  );
}

/** Test hook: forget the state of this launch. */
export function resetReaderRestoreGateForTests(): void {
  if (safetyTimer) clearTimeout(safetyTimer);
  if (pageTimer) clearTimeout(pageTimer);
  pending = null;
  safetyTimer = null;
  pageTimer = null;
  listeners.clear();
  pageDrawn = false;
  pageWaiters.clear();
}
