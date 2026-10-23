// @ai-generated
// Qariah (Sprint 50, TECH_DEBT #261). Upstream candidate: Bayaan renders its
// action sheets above the navigator too, so a link opens under an open sheet.
import {SheetManager, getSheetStack} from 'react-native-actions-sheet';
import {deepLinkTargetPath} from '@/services/diagnostics/deepLinkWatchdog';

/** The longest time that a link waits for the open sheets to close. */
export const SHEET_CLOSE_LIMIT_MS = 1500;

/**
 * Closes every open action sheet, the top sheet first, and waits until each
 * close ends. It resolves after `limitMs` at the latest, also when a sheet
 * does not report the end of its close. It never rejects.
 *
 * At the time limit, the loop stops: it closes no more sheets. Else a late
 * end of a stuck close would close the next sheet some time after the link
 * opened its screen.
 */
export async function closeOpenSheets(
  limitMs: number = SHEET_CLOSE_LIMIT_MS,
): Promise<void> {
  const open = getSheetStack().reverse();
  if (open.length === 0) return;
  let cancelled = false;
  const closeAll = (async () => {
    for (const sheet of open) {
      if (cancelled) return;
      await SheetManager.hide(sheet.id, {context: sheet.context});
    }
  })().catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>(resolve => {
    timer = setTimeout(() => {
      cancelled = true;
      resolve();
    }, limitMs);
  });
  try {
    await Promise.race([closeAll, limit]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The `redirectSystemPath` of expo-router (app/+native-intent.ts). The action
 * sheets render above the navigator (the SheetProvider in app/_layout.tsx).
 * Thus a link that arrives while a sheet is open (for example the Mushaf
 * settings sheet) navigates under the sheet, and the sheet stays on top of
 * the new screen. For a link that navigates while the app runs, close the
 * open sheets first. The path does not change.
 *
 * - A cold start (`initial`) has no open sheet. The path goes back at once,
 *   so the first URL on iOS stays synchronous.
 * - A link that does not navigate (the QF OAuth callback, the share intent,
 *   the dev client) does not close a sheet.
 * - With no open sheet, the path goes back at once.
 */
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string | Promise<string> {
  try {
    if (initial || deepLinkTargetPath(path) === null) return path;
    if (getSheetStack().length === 0) return path;
    return closeOpenSheets().then(() => path);
  } catch {
    // A failure here must not lose the link.
    return path;
  }
}
