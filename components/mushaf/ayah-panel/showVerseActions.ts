// @ai-generated
import {SheetManager} from 'react-native-actions-sheet';
import {moveAyahPanel, type AyahPanelPayload} from './ayahPanelStore';

/**
 * Opens the verse actions after a long-press on an ayah. While the ayah
 * panel is open (Sprint 52 Task 8), a long-press on one ayah only moves the
 * panel to that ayah, on the same tab: the page stays in view and no sheet
 * opens. A range, or a long-press outside the Mushaf reader, opens the
 * verse actions as before.
 */
export function showVerseActions(payload: AyahPanelPayload): void {
  if (moveAyahPanel(payload)) return;
  SheetManager.show('verse-actions', {payload});
}
