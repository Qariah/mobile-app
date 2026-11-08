// @ai-generated
/**
 * Where the Mushaf reader shows the ayah panel (Sprint 52 Task 8). The
 * reader (components/mushaf/main.tsx) renders this beside its reader pane:
 * 'side' is a 360 pt column at the trailing edge of the row (the left edge
 * in Arabic), 'card' a centred card of at most 560 pt over the dimmed
 * reader (TabletDialog: a tap outside closes it). The store keeps the ayah
 * and the tab, so a window that crosses 900 pt turns one into the other.
 */
import React, {useEffect, useRef} from 'react';
import {BackHandler, StyleSheet, View} from 'react-native';
import {TabletDialog} from '@/components/layout/TabletDialog';
import {useMushafSettingsStore} from '@/store/mushafSettingsStore';
import {AyahSidePanel} from './AyahSidePanel';
import {closeAyahPanel, isAyahPanelOpen} from './ayahPanelStore';
import type {AyahPanelPresentation} from './useAyahPanelPresentation';

/** Height of the card: room for a tafsir passage and the note editor. */
const CARD_HEIGHT = 560;

export interface AyahPanelHostProps {
  presentation: AyahPanelPresentation | null;
  /** Height at the top of the side panel that the reader's chrome covers. */
  topInset?: number;
  /** Height at the bottom of the side panel that the reader's chrome covers. */
  bottomInset?: number;
}

export function AyahPanelHost({
  presentation,
  topInset,
  bottomInset,
}: AyahPanelHostProps) {
  // The panel's ayah is numbered in the rewayah on screen: another rewayah
  // closes it.
  const rewayah = useMushafSettingsStore(s => s.rewayah);
  const rewayahRef = useRef(rewayah);
  useEffect(() => {
    if (rewayahRef.current !== rewayah) closeAyahPanel();
    rewayahRef.current = rewayah;
  }, [rewayah]);

  // Android back closes the panel first.
  const open = presentation !== null;
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isAyahPanelOpen()) return false;
      closeAyahPanel();
      return true;
    });
    return () => sub.remove();
  }, [open]);

  if (presentation === 'side') {
    return (
      <AyahSidePanel
        presentation="side"
        topInset={topInset}
        bottomInset={bottomInset}
      />
    );
  }
  if (presentation === 'card') {
    return (
      // Modal over the whole reader: the reader hides its chrome and its
      // content from assistive technology while the card shows (main.tsx).
      <View
        style={styles.cardLayer}
        testID="ayah-panel-card-layer"
        accessible={false}
        accessibilityViewIsModal={true}>
        <TabletDialog onClose={closeAyahPanel} height={CARD_HEIGHT}>
          <AyahSidePanel presentation="card" />
        </TabletDialog>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  cardLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
  },
});
