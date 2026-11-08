// @ai-generated
/**
 * The ayah panel (Sprint 52 Task 8): Tafsir, Reflections and Personal Notes
 * of the selected ayah, beside the Mushaf reader on a tablet window of 900 pt
 * or more ('side'), or in a centred card below that ('card'). The page and
 * the highlight of the ayah stay in view while it is open.
 *
 * Header: "Ayah {key}" (a header for VoiceOver), the surah name, and the
 * close button. Under it a 44 pt segmented control, then the tab content.
 * The content reuses the verse-actions screens (TafseerContent,
 * CommunityReflectionsContent, NoteContent).
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewInstance,
} from 'react-native';
import {Feather} from '@expo/vector-icons';
import Color from 'color';
import {useTranslation} from 'react-i18next';
import {useTheme} from '@/hooks/useTheme';
import branding from '@/config/branding';
import {SURAHS} from '@/data/surahData';
import {getSurahDisplayName} from '@/i18n/format';
import {useMushafSettingsStore} from '@/store/mushafSettingsStore';
import {getRewayahShortLabel} from '@/utils/rewayahLabels';
import {useVerseSelection} from '@/components/share/useVerseSelection';
import type {
  ReadyVerseSelection,
  VerseSelectionRequest,
} from '@/components/share/rewayahVerseSelection';
import {TafseerContent} from '@/components/sheets/verse-actions/TafseerContent';
import {CommunityReflectionsContent} from '@/components/sheets/verse-actions/CommunityReflectionsContent';
import {AyahPanelNotesTab} from './AyahPanelNotesTab';
import {
  AYAH_PANEL_WIDTH,
  ayahPanelKey,
  closeAyahPanel,
  setAyahPanelTab,
  useAyahPanelStore,
  type AyahPanelPayload,
  type AyahPanelTab,
} from './ayahPanelStore';
import type {AyahPanelPresentation} from './useAyahPanelPresentation';

/**
 * A segment is 38 pt high inside the 44 pt track (3 pt padding), as in the
 * mock; the touch area reaches the track edges: 44 pt.
 */
const SEGMENT_HEIGHT = 38;
const SEGMENT_HIT_SLOP = {top: 3, bottom: 3};

const TAB_LABELS = {
  tafsir: 'sheets:verseActions.tafseer',
  reflections: 'qariah:notes.reflections',
  notes: 'qariah:notes.personalNotes',
} as const satisfies Record<AyahPanelTab, string>;

/** The tabs: Reflections only where a fork gives a reflections provider. */
export function ayahPanelTabs(): AyahPanelTab[] {
  return branding.communityReflectionsProvider
    ? ['tafsir', 'reflections', 'notes']
    : ['tafsir', 'notes'];
}

export interface AyahSidePanelProps {
  presentation: AyahPanelPresentation;
  /** Height at the top that the reader's chrome covers (the iOS 26 header). */
  topInset?: number;
  /** Height at the bottom that the reader's chrome covers. */
  bottomInset?: number;
}

/**
 * The height of a keyboard event's keyboard that is docked at the bottom of
 * the window, or 0. A floating (undocked) iPad keyboard is narrower than the
 * window and covers no fixed band of the panel: it counts as 0.
 */
export function dockedKeyboardHeight(
  keyboard: {width: number; height: number},
  windowWidth: number,
): number {
  return keyboard.width < windowWidth ? 0 : keyboard.height;
}

/**
 * The height of the docked on-screen keyboard (0 while it is hidden or
 * floating), and a reset for a hidden editor.
 */
function useDockedKeyboard(
  enabled: boolean,
  windowWidth: number,
): [number, () => void] {
  const [height, setHeight] = useState(0);
  const windowWidthRef = useRef(windowWidth);
  windowWidthRef.current = windowWidth;
  useEffect(() => {
    if (!enabled) return;
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(show, e =>
      setHeight(dockedKeyboardHeight(e.endCoordinates, windowWidthRef.current)),
    );
    const hideSub = Keyboard.addListener(hide, () => setHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
      setHeight(0);
    };
  }, [enabled]);
  const reset = useCallback(() => setHeight(0), []);
  return [height, reset];
}

/**
 * How much of a panel whose bottom edge is at `panelBottom` the docked
 * keyboard covers, all in window coordinates: the keyboard's top is
 * `windowHeight - keyboardHeight`. 0 while the keyboard is hidden or
 * floating, or the panel is not measured yet.
 */
export function keyboardOverlap(
  panelBottom: number | null,
  windowHeight: number,
  keyboardHeight: number,
): number {
  if (panelBottom === null || keyboardHeight <= 0) return 0;
  return Math.max(0, panelBottom - (windowHeight - keyboardHeight));
}

export function AyahSidePanel(props: AyahSidePanelProps) {
  const payload = useAyahPanelStore(s => s.payload);
  if (!payload) return null;
  return <AyahPanelBody {...props} payload={payload} />;
}

function AyahPanelBody({
  presentation,
  topInset = 0,
  bottomInset = 0,
  payload,
}: AyahSidePanelProps & {payload: AyahPanelPayload}) {
  const {theme} = useTheme();
  const {t} = useTranslation(['qariah', 'sheets', 'common']);
  const storedTab = useAyahPanelStore(s => s.tab);
  const revision = useAyahPanelStore(s => s.revision);
  const compose = useAyahPanelStore(s => s.compose);
  const tabs = ayahPanelTabs();
  const tab = tabs.includes(storedTab) ? storedTab : 'tafsir';
  const side = presentation === 'side';
  // The card moves above the keyboard (TabletDialog); the side panel ends
  // above it, so the note editor's field stays in view. The overlap comes
  // from the panel's measured frame and the docked keyboard, both in window
  // coordinates.
  const {width: windowWidth, height: windowHeight} = useWindowDimensions();
  const [keyboardHeight, resetKeyboard] = useDockedKeyboard(side, windowWidth);
  const panelRef = useRef<ViewInstance>(null);
  const [panelBottom, setPanelBottom] = useState<number | null>(null);
  const measurePanel = useCallback(() => {
    panelRef.current?.measureInWindow((_x, y, _width, height) =>
      setPanelBottom(y + height),
    );
  }, []);
  // The iOS 26 header can change the inset with no layout of the panel.
  useEffect(() => {
    if (side) measurePanel();
  }, [side, topInset, measurePanel]);
  const overlap = keyboardOverlap(panelBottom, windowHeight, keyboardHeight);
  // A hidden editor must not keep the keyboard up.
  const selectTab = useCallback(
    (id: AyahPanelTab) => {
      if (id !== 'notes') {
        Keyboard.dismiss();
        resetKeyboard();
      }
      setAyahPanelTab(id);
    },
    [resetKeyboard],
  );

  const key = ayahPanelKey(payload);
  const surahNumber = Number(key.split(':')[0]);
  const surah = SURAHS[surahNumber - 1];
  const surahName = surah ? getSurahDisplayName(surah) : '';

  // The ayah in the shown rewayah's own numbering (the verse-actions sheet
  // builds the same selection).
  const mushafRewayah = useMushafSettingsStore(s => s.rewayah);
  const request = useMemo<VerseSelectionRequest>(
    () => ({
      rewayah: payload.rewayah ?? mushafRewayah,
      verseKey: payload.verseKey,
      surahNumber: payload.surahNumber,
      ayahNumber: payload.ayahNumber,
      verseKeys: payload.verseKeys,
      unitKeys: payload.unitKeys,
    }),
    [payload, mushafRewayah],
  );
  const selection = useVerseSelection(request);
  const ready = selection.status === 'ready' ? selection : null;

  const colors = useMemo(
    () => ({
      panel: theme.colors.backgroundSecondary ?? theme.colors.background,
      border: Color(theme.colors.text).alpha(0.12).toString(),
      track: Color(theme.colors.text).alpha(0.07).toString(),
      secondary: Color(theme.colors.text).alpha(0.75).toString(),
      // The selected segment stands out from the track in both themes.
      selected: theme.colors.light,
    }),
    [theme],
  );

  let content: React.ReactNode = null;
  if (!ready) {
    content = (
      <View style={styles.pending}>
        {selection.status === 'loading' ? (
          <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        ) : (
          <Text style={[styles.pendingText, {color: colors.secondary}]}>
            {t(
              selection.status === 'invalid'
                ? 'sheets:verseActions.unnumbered'
                : 'sheets:verseActions.loadFailed',
              {rewayah: getRewayahShortLabel(selection.rewayah)},
            )}
          </Text>
        )}
      </View>
    );
  } else if (tab === 'tafsir') {
    content = (
      <TafseerContent
        key={`tafsir-${revision}`}
        surahNumber={payload.surahNumber}
        ayahNumber={payload.ayahNumber}
        rewayah={ready.rewayah}
        unitStart={unitStartOf(ready)}
        onBack={closeAyahPanel}
        inPanel={true}
      />
    );
  } else if (tab === 'reflections') {
    // Reflections are per Hafs verse: the one holding the verse's first word.
    content = (
      <CommunityReflectionsContent
        key={`reflections-${revision}`}
        surahNumber={ready.linkVerse.surah}
        ayahNumber={ready.linkVerse.ayah}
        label={ready.units ? ready.label : undefined}
        inPanel={true}
        emptyState={
          <View style={styles.empty} testID="ayah-panel-reflections-empty">
            <View style={[styles.emptyIcon, {backgroundColor: colors.track}]}>
              <Feather name="users" size={20} color={theme.colors.text} />
            </View>
            <Text style={[styles.emptyTitle, {color: theme.colors.text}]}>
              {t('qariah:notes.noReflections')}
            </Text>
            <Text style={[styles.emptyHint, {color: colors.secondary}]}>
              {t('qariah:notes.reflectionsHint')}
            </Text>
          </View>
        }
      />
    );
  }
  // The Personal Notes tab stays mounted, hidden, while a note is being
  // written, so a tab change keeps the draft.
  const notes =
    ready && (tab === 'notes' || compose) ? (
      <View
        style={[styles.notes, tab !== 'notes' && styles.hidden]}
        accessible={false}>
        <AyahPanelNotesTab
          key={`notes-${revision}`}
          payload={payload}
          selection={ready}
        />
      </View>
    ) : null;

  return (
    <View
      ref={panelRef}
      onLayout={side ? measurePanel : undefined}
      testID="ayah-panel"
      accessible={false}
      style={[
        side ? styles.side : styles.card,
        side && {
          backgroundColor: colors.panel,
          borderStartColor: colors.border,
          paddingTop: topInset,
        },
      ]}>
      <View style={styles.header} accessible={false}>
        <View style={styles.titles}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={[styles.title, {color: theme.colors.text}]}>
            {t('qariah:ayahPanel.title', {key})}
          </Text>
          {surahName ? (
            <Text
              numberOfLines={1}
              style={[styles.subtitle, {color: colors.secondary}]}>
              {surahName}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={closeAyahPanel}
          accessibilityRole="button"
          accessibilityLabel={t('qariah:ayahPanel.close')}
          testID="ayah-panel-close"
          style={({pressed}) => [styles.close, pressed && styles.pressed]}>
          <Feather name="x" size={20} color={theme.colors.text} />
        </Pressable>
      </View>

      <View
        accessible={false}
        accessibilityRole="tablist"
        style={[styles.segments, {backgroundColor: colors.track}]}>
        {tabs.map(id => {
          const selected = id === tab;
          return (
            <Pressable
              key={id}
              onPress={() => selectTab(id)}
              accessibilityRole="tab"
              accessibilityState={{selected}}
              hitSlop={SEGMENT_HIT_SLOP}
              testID={`ayah-panel-tab-${id}`}
              style={[
                styles.segment,
                selected && [
                  styles.segmentSelected,
                  {backgroundColor: colors.selected},
                ],
              ]}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit={true}
                minimumFontScale={0.85}
                style={[
                  styles.segmentText,
                  {color: selected ? theme.colors.text : colors.secondary},
                ]}>
                {t(TAB_LABELS[id])}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View
        accessible={false}
        style={[
          styles.content,
          side && {paddingBottom: Math.max(bottomInset, overlap)},
        ]}>
        {content}
        {notes}
      </View>
    </View>
  );
}

function unitStartOf(ready: ReadyVerseSelection) {
  return ready.model && ready.units
    ? {model: ready.model, unit: ready.units[0]}
    : undefined;
}

const styles = StyleSheet.create({
  side: {
    width: AYAH_PANEL_WIDTH,
    borderStartWidth: StyleSheet.hairlineWidth,
  },
  card: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingStart: 20,
    paddingEnd: 8,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  titles: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    fontFamily: 'Manrope-Bold',
    textAlign: 'auto',
  },
  subtitle: {
    fontSize: 13,
    fontFamily: 'Manrope-Regular',
    marginTop: 1,
  },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  segments: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 3,
    borderRadius: 12,
    minHeight: 44,
  },
  segment: {
    flex: 1,
    minHeight: SEGMENT_HEIGHT,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  segmentSelected: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: {width: 0, height: 1},
    elevation: 1,
  },
  segmentText: {
    fontSize: 13,
    fontFamily: 'Manrope-SemiBold',
  },
  content: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 20,
  },
  notes: {
    flex: 1,
  },
  hidden: {
    display: 'none',
  },
  pending: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  pendingText: {
    fontSize: 13,
    fontFamily: 'Manrope-Medium',
    textAlign: 'center',
  },
  empty: {
    paddingTop: 8,
    gap: 10,
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: 'Manrope-Bold',
  },
  emptyHint: {
    fontSize: 15,
    fontFamily: 'Manrope-Regular',
    lineHeight: 22,
  },
});
