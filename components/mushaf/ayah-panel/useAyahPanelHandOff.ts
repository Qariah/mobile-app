// @ai-generated
import {useCallback} from 'react';
import {SheetManager} from 'react-native-actions-sheet';
import {useResponsive} from '@/hooks/useResponsive';
import {
  ayahPanelKeepsDraft,
  canShowInAyahPanel,
  openAyahPanel,
  type AyahPanelPayload,
  type AyahPanelTab,
} from './ayahPanelStore';

/**
 * For the verse-actions sheet: on a tablet in the Mushaf reader, the Tafsir,
 * Reflections and Personal Notes rows open the ayah panel beside the page
 * and close the sheet, instead of a sub-screen of the sheet. The returned
 * function says whether it did; when it returns false (a phone, a range, the
 * player's verse view, or another ayah while the panel holds an unsaved
 * note), the sheet opens its own sub-screen as before.
 */
export function useAyahPanelHandOff(
  payload: AyahPanelPayload | undefined,
  isRange: boolean,
  sheetId: string,
): (tab: AyahPanelTab, options?: {compose?: boolean}) => boolean {
  const {isTablet} = useResponsive();
  return useCallback(
    (tab, options) => {
      if (isRange || !canShowInAyahPanel(payload, isTablet)) return false;
      if (ayahPanelKeepsDraft(payload)) return false;
      // Opens first: the panel takes the selection before the sheet's close
      // clears it, and puts it back after.
      openAyahPanel(payload, tab, options);
      SheetManager.hide(sheetId).catch(() => undefined);
      return true;
    },
    [payload, isRange, isTablet, sheetId],
  );
}
