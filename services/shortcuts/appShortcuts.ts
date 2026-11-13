// @ai-generated
// Qariah (owner, 2026-11-11): the three app shortcuts. iOS shows them next to
// the app in Spotlight and in the Shortcuts app; Android shows them when you
// long-press the app icon. Approved proposal:
// https://claude.ai/artifact/BBg2cj1gbVhppCLoLronFM
//
// - Continue listening: resume the last session (the player's queue, else the
//   most recent entry of the recently played list) and open the full player.
//   With nothing to resume, the Listen tab.
// - Continue reading: the reader at the last page read, else page 1
//   (Al-Fatihah). An open reader turns to that page (ReaderLinkRedirect).
// - Search: the Search tab.
//
// Two ways in, one route each:
// - Android: a static shortcut opens the link `<scheme>://<shortcut>`
//   (plugins/withQariahAndroidShortcuts.js), so the link routes
//   app/continue-listening.tsx, app/continue-reading.tsx and app/search.tsx
//   run, after the cold-start link replay where needed.
// - iOS: the App Intent opens the app and queues the widget command
//   `{type: 'openShortcut', target}` (plugins/app-shortcuts/
//   BayaanAppShortcuts.swift). The command handler pushes the same route
//   (openAppShortcutRoute). OpenURLIntent would need iOS 18, and the App
//   Shortcuts list cannot hold an iOS 18-only entry while it supports iOS 17.
import {
  LISTEN_ROUTE,
  MUSHAF_RESTORE_WAIT_MS,
  SESSION_WAIT_MS,
} from '@/services/notifications/tapRouter';

export const APP_SHORTCUTS = [
  'continue-listening',
  'continue-reading',
  'search',
] as const;

export type AppShortcut = (typeof APP_SHORTCUTS)[number];

export function isAppShortcut(value: unknown): value is AppShortcut {
  return (
    typeof value === 'string' &&
    (APP_SHORTCUTS as readonly string[]).includes(value)
  );
}

/** The Search tab. */
export const SEARCH_ROUTE = '/(tabs)/(b.search)';

/** The Mushaf has 604 pages. */
const LAST_PAGE = 604;

/** The page that Continue reading opens: the last page read, else page 1. */
export function continueReadingPage(
  lastReadPage: number | null | undefined,
): number {
  return typeof lastReadPage === 'number' &&
    Number.isInteger(lastReadPage) &&
    lastReadPage >= 1 &&
    lastReadPage <= LAST_PAGE
    ? lastReadPage
    : 1;
}

/**
 * The full player opens with an expand of the player sheet. An expand while
 * the link route's back transition runs is cancelled by the sheet's onChange
 * (app/player.tsx waits the same time).
 */
export const EXPAND_DELAY_MS = 400;

export interface ContinueListeningDeps {
  waitForSession: () => Promise<unknown>;
  /** `false` when there is nothing to resume. */
  resumeLastSession: () => Promise<boolean>;
  navigate: (href: string) => void;
  delay: (ms: number) => Promise<void>;
}

/** Continue listening, after the link route has stepped off the stack. */
export async function continueListening(
  deps: ContinueListeningDeps = continueListeningDeps(),
): Promise<'resume' | 'listen'> {
  await deps.waitForSession();
  await deps.delay(EXPAND_DELAY_MS);
  if (await deps.resumeLastSession()) return 'resume';
  deps.navigate(LISTEN_ROUTE);
  return 'listen';
}

function continueListeningDeps(): ContinueListeningDeps {
  return {
    waitForSession: () => {
      const {waitForSessionRestored} =
        require('@/services/car/sessionGate') as typeof import('@/services/car/sessionGate');
      return waitForSessionRestored(SESSION_WAIT_MS);
    },
    resumeLastSession: () => {
      const {resumeLastSession} =
        require('@/services/notifications/tapActions') as typeof import('@/services/notifications/tapActions');
      return resumeLastSession();
    },
    navigate: href => {
      const {router} = require('expo-router') as typeof import('expo-router');
      router.navigate(href as never);
    },
    delay: ms => new Promise(resolve => setTimeout(resolve, ms)),
  };
}

export interface OpenRouteDeps {
  /** Resolves once the cold-start Mushaf restore is done (or after a limit). */
  waitForMushafRestore: () => Promise<unknown>;
  /** Closes the open action sheets (they render above every screen). */
  closeSheets: () => Promise<void>;
  push: (href: string) => void;
}

/**
 * The iOS App Shortcut's widget command: push the shortcut's link route, as
 * the Android link does. It waits for the cold-start Mushaf restore, so the
 * restore's /mushaf push cannot land on top of the shortcut's screen.
 */
export async function openAppShortcutRoute(
  target: AppShortcut,
  deps: OpenRouteDeps = openRouteDeps(),
): Promise<void> {
  await deps.waitForMushafRestore();
  await deps.closeSheets();
  deps.push(`/${target}`);
}

function openRouteDeps(): OpenRouteDeps {
  return {
    waitForMushafRestore: () => {
      const {whenMushafRestoreHandled} =
        require('@/services/mushafRestoreSignal') as typeof import('@/services/mushafRestoreSignal');
      return whenMushafRestoreHandled(MUSHAF_RESTORE_WAIT_MS);
    },
    closeSheets: () => {
      const {closeOpenSheets} =
        require('@/services/closeSheetsBeforeLink') as typeof import('@/services/closeSheetsBeforeLink');
      return closeOpenSheets();
    },
    push: href => {
      const {router} = require('expo-router') as typeof import('expo-router');
      router.push(href as never);
    },
  };
}

/** Search: close the full player (a tab must not open under it), then the tab. */
export function openSearchTab(): void {
  const {usePlayerStore} =
    require('@/services/player/store/playerStore') as typeof import('@/services/player/store/playerStore');
  if (usePlayerStore.getState().sheetMode === 'full') {
    const {closePlayerSheet} =
      require('@/services/player/sheetRef') as typeof import('@/services/player/sheetRef');
    closePlayerSheet();
  }
  const {router} = require('expo-router') as typeof import('expo-router');
  router.navigate(SEARCH_ROUTE as never);
}
