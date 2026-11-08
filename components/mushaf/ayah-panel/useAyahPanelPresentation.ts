// @ai-generated
import {useWindowDimensions} from 'react-native';
import {AYAH_PANEL_MIN_WINDOW, useAyahPanelStore} from './ayahPanelStore';

/** How the open ayah panel shows: beside the reader, or as a centred card. */
export type AyahPanelPresentation = 'side' | 'card';

/**
 * The presentation for a window `width` wide: beside the reader from 900 pt
 * (ipad-standards §8, `expanded`), a card below. Phones never show the panel
 * (a phone in landscape can be wider than 900 pt).
 */
export function ayahPanelPresentation(
  isTablet: boolean,
  width: number,
): AyahPanelPresentation | null {
  if (!isTablet) return null;
  return width >= AYAH_PANEL_MIN_WINDOW ? 'side' : 'card';
}

/**
 * The presentation of the open panel in this window, or null while it is
 * closed. A window that crosses 900 pt turns the panel into the card (same
 * ayah, same tab) and back.
 */
export function useAyahPanelPresentation(
  isTablet: boolean,
): AyahPanelPresentation | null {
  const {width} = useWindowDimensions();
  const open = useAyahPanelStore(s => s.payload !== null);
  return open ? ayahPanelPresentation(isTablet, width) : null;
}

/**
 * The reader's accessibility while the panel shows: the card below 900 pt is
 * modal, so VoiceOver (`accessibilityElementsHidden`) and TalkBack
 * (`importantForAccessibility`) skip the reader under it. The reader root
 * holds all of the screen's own UI on Android (its header and bottom bar);
 * the card layer is rendered after it, with `accessibilityViewIsModal`.
 */
export function readerAccessibility(
  presentation: AyahPanelPresentation | null,
): {
  accessibilityElementsHidden: boolean;
  importantForAccessibility: 'no-hide-descendants' | 'auto';
} {
  const underCard = presentation === 'card';
  return {
    accessibilityElementsHidden: underCard,
    importantForAccessibility: underCard ? 'no-hide-descendants' : 'auto',
  };
}
