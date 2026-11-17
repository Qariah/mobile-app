import React, {
  useMemo,
  useCallback,
  useEffect, // @ai
  useRef,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {View, useWindowDimensions} from 'react-native'; // @ai
import {
  FlashList,
  type FlashListRef,
  type ListRenderItemInfo,
} from '@shopify/flash-list';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {moderateScale, verticalScale} from '@/utils/scale';
import {useTheme} from '@/hooks/useTheme';
import {
  getDkFontFamily, // @ai
  useMushafSettingsStore,
} from '@/store/mushafSettingsStore';
import {useTajweedStore} from '@/store/tajweedStore';
import {useVerseAnnotationsStore} from '@/store/verseAnnotationsStore';
import {mushafPreloadService} from '@/services/mushaf/MushafPreloadService';
import {useMushafFontMgr} from '@/hooks/useMushafFontMgr';
import {digitalKhattDataService} from '@/services/mushaf/DigitalKhattDataService';
import {mushafVerseMapService} from '@/services/mushaf/MushafVerseMapService';
import {
  enhancedVersesBySurah,
  type EnhancedVerse,
} from '@/utils/enhancedVerseData';
import {VerseItem} from '@/components/player/v2/PlayerContent/QuranView/VerseItem';
import {
  useMushafPlayerStore,
  usePlaybackBasmalaSurah, // @ai
  usePlaybackVerseKeys, // @ai
} from '@/store/mushafPlayerStore';
import SurahDivider from '@/components/player/v2/PlayerContent/QuranView/SurahDivider';
import BasmalaHeader from '@/components/player/v2/PlayerContent/QuranView/BasmalaHeader';
import {getTranslationName} from '@/utils/translationLookup';
import {getAllahNameHighlightColorHex} from '@/constants/mushafAllahHighlight';
import {readingListSidePadding} from '../readerListKey'; // @ai Sprint 52 Task 8
import {listStartIndex} from './listStartIndex'; // @ai TECH_DEBT #411
// @ai-start
import {useRewayahVerseUnits} from '@/hooks/useRewayahVerseUnits';
import {parseAnchorKey} from '@/services/mushaf/RewayahVerseUnits';
import {shownVerseUnitsOf} from '@/services/mushaf/MushafVerseMapService';
import {isVerseUnitRow} from '@/components/player/v2/PlayerContent/QuranView/verseUnitRows';
import {playbackBandUnitKeys} from '../skia/verseHighlightLayers';
import {usePlaybackBand} from '../skia/playbackBand';
import {buildUnitListModel, type UnitListModel} from './mushafVerseUnitRows';
import {VerseUnitsPending} from './VerseUnitsPending';

const NO_KEYS: readonly string[] = Object.freeze([]);

/** The Hafs verse of a stored anchor 'S:A:W'; a Hafs key as it is. */
function hafsVerseKeyOf(reference: string): string {
  const loc =
    reference.split(':').length === 3 ? parseAnchorKey(reference) : null;
  return loc ? `${loc.surah}:${loc.ayah}` : reference;
}
// @ai-end

const surahData = require('@/data/surahData.json') as Array<{
  id: number;
  name: string;
  bismillah_pre: boolean;
  verses_count: number;
}>;

// Item types for the flat list
type ContinuousListItem =
  | {type: 'surah_header'; surahNumber: number; showBismillah: boolean}
  | {type: 'verse'; verse: EnhancedVerse; surahNumber: number};

// Build the flat list once at module scope
let cachedItems: ContinuousListItem[] | null = null;

function buildContinuousListItems(): ContinuousListItem[] {
  if (cachedItems) return cachedItems;

  const items: ContinuousListItem[] = [];
  for (const surah of surahData) {
    items.push({
      type: 'surah_header',
      surahNumber: surah.id,
      showBismillah: surah.bismillah_pre,
    });

    const verses = enhancedVersesBySurah[surah.id];
    if (verses) {
      for (const verse of verses) {
        items.push({type: 'verse', verse, surahNumber: surah.id});
      }
    }
  }

  cachedItems = items;
  return items;
}

// Precomputed lookup: surahNumber → index in flat list
let surahIndexMap: Map<number, number> | null = null;
// Precomputed lookup: verseKey → index in flat list
let verseIndexMap: Map<string, number> | null = null;

function getSurahIndex(surahNumber: number): number {
  if (!surahIndexMap) {
    surahIndexMap = new Map();
    const items = buildContinuousListItems();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (
        item.type === 'surah_header' &&
        !surahIndexMap.has(item.surahNumber)
      ) {
        surahIndexMap.set(item.surahNumber, i);
      }
    }
  }
  return surahIndexMap.get(surahNumber) ?? 0;
}

function getVerseIndex(verseKey: string): number {
  if (!verseIndexMap) {
    verseIndexMap = new Map();
    const items = buildContinuousListItems();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type === 'verse') {
        verseIndexMap.set(item.verse.verse_key, i);
      }
    }
  }
  return verseIndexMap.get(verseKey) ?? 0;
}

// @ai-start TECH_DEBT #411
/** The list index of a verse, or undefined for an unknown or absent verse. */
function verseIndexOf(
  verseKey: string | null | undefined,
): number | undefined {
  if (!verseKey) return undefined;
  getVerseIndex(verseKey); // builds the map
  return verseIndexMap?.get(verseKey);
}
// @ai-end

// @ai Qariah: the page of the verse's first word, from the verse index. A map
// built from the 604 pages here read all the words on the JS thread.
function getPageForVerse(verseKey: string): number | null {
  return digitalKhattDataService.getPageForVerse(verseKey) ?? null;
}

// Map page number → first verse key on that page for scroll-to-page support
function getFirstVerseKeyForPage(pageNumber: number): string | null {
  if (!digitalKhattDataService.initialized) return null;
  const verseKeys =
    mushafVerseMapService.getOrderedVerseKeysForPage(pageNumber);
  return verseKeys.length > 0 ? verseKeys[0] : null;
}

// Public handle for imperative navigation from MushafViewer
export interface ContinuousListViewHandle {
  scrollToPage: (page: number, animated?: boolean) => void;
  scrollToSurah: (surahId: number, animated?: boolean) => void;
  scrollToVerse: (verseKey: string, animated?: boolean) => void;
}

interface ContinuousListViewProps {
  textColor: string;
  labelColor: string;
  borderColor: string;
  onTap?: () => void;
  initialPage: number;
  onCurrentSurahChange?: (surahId: number) => void;
  onCurrentPageChange?: (page: number) => void;
  // @ai-start
  /**
   * The list's measured width on iPad, where the text also sits in a centred
   * reading column. Phones leave it out and keep the launch-time screen
   * width.
   */
  width?: number;
  /** Whether a tap on the status bar scrolls back to the start. Default on. */
  scrollsToTop?: boolean;
  /**
   * TECH_DEBT #411: the Hafs key of a verse on `initialPage` to start at (a
   * bookmark opened from Collection). Without it the list starts at the page.
   */
  initialVerseKey?: string;
  // @ai-end
}

// @ai-start
const ContinuousListView = forwardRef<
  ContinuousListViewHandle,
  ContinuousListViewProps
>(
  (
    {
      textColor,
      labelColor,
      borderColor,
      onTap,
      initialPage,
      onCurrentSurahChange,
      onCurrentPageChange,
      width,
      scrollsToTop = true,
      initialVerseKey, // TECH_DEBT #411
    },
    ref,
  ) => {
    const {theme} = useTheme();
    const insets = useSafeAreaInsets();
    const flashListRef = useRef<FlashListRef<ContinuousListItem>>(null);

    // Active ayah highlighting (same pattern as player QuranView): every
    // Hafs verse the reciter is reciting.
    const playbackVerseKeys = usePlaybackVerseKeys(); // @ai
    const playbackState = useMushafPlayerStore(s => s.playbackState);
    const isPlaying = playbackState === 'playing';
    // @ai — the surah whose basmala is being recited (the intro before its
    // first verse): its header's basmala is lit as a recited verse is.
    const basmalaSurah = usePlaybackBasmalaSurah();

    // @ai-start
    // Decision 3 (Release 1): a non-Hafs text lists its rewayah's OWN verses
    // (verse units, in its numbering; mushafVerseUnitRows.ts), never Hafs
    // verses under the rewayah's name: in Warsh, Hafs 1:7 is the rows 1:6
    // and 1:7, and Warsh 2:1 holds Hafs 2:1 and 2:2. Hafs keeps its Hafs
    // verse rows exactly as before and never builds verse units.
    const mushafRewayah = useMushafSettingsStore(s => s.rewayah);
    const unitsRewayah = mushafRewayah === 'hafs' ? null : mushafRewayah;
    const {units: verseUnits, status: verseUnitsStatus} =
      useRewayahVerseUnits(unitsRewayah);
    const unitList = useMemo<UnitListModel | null>(
      () =>
        unitsRewayah && verseUnits?.rewayah === unitsRewayah
          ? buildUnitListModel(verseUnits)
          : null,
      [unitsRewayah, verseUnits],
    );
    // The follow-along band as rows of the rewayah: the band the mushaf
    // pages paint (verse-units contract 4.2), e.g. a Warsh reciter on Warsh
    // 1:6 lights the row 1:6 only.
    const playbackBand = usePlaybackBand();
    const bandKeys = useMemo(
      () =>
        unitList
          ? playbackBandUnitKeys(
              shownVerseUnitsOf(unitList.units),
              playbackBand,
            )
          : NO_KEYS,
      [unitList, playbackBand],
    );
    // For the stable viewability callback below.
    const unitListRef = useRef(unitList);
    useEffect(() => {
      unitListRef.current = unitList;
    }, [unitList]);
    // @ai-end

    // Expose navigation methods to parent
    useImperativeHandle(ref, () => ({
      scrollToPage: (page: number, animated = false) => {
        // @ai-start
        // A rewayah's list: the row holding the page's first word.
        if (unitList) {
          const index = unitList.indexForPage(page);
          if (index !== undefined) {
            flashListRef.current?.scrollToIndex({index, animated});
          }
          return;
        }
        // @ai-end
        const verseKey = getFirstVerseKeyForPage(page);
        if (verseKey) {
          const index = getVerseIndex(verseKey);
          flashListRef.current?.scrollToIndex({index, animated});
        }
      },
      scrollToSurah: (surahId: number, animated = false) => {
        const index = unitList // @ai
          ? (unitList.indexOfSurah(surahId) ?? 0)
          : getSurahIndex(surahId);
        flashListRef.current?.scrollToIndex({index, animated});
      },
      scrollToVerse: (verseKey: string, animated = false) => {
        // @ai-start
        // `verseKey`: a Hafs key (search, playback) or a stored anchor
        // 'S:A:W'. A rewayah's list scrolls to the row holding that slot;
        // during playback to the band's row holding that Hafs verse.
        if (unitList) {
          const index = unitList.indexForHafsReference(verseKey, bandKeys);
          if (index !== undefined) {
            flashListRef.current?.scrollToIndex({index, animated});
          }
          return;
        }
        const index = getVerseIndex(hafsVerseKeyOf(verseKey));
        // @ai-end
        flashListRef.current?.scrollToIndex({index, animated});
      },
    }));

    // Settings subscriptions
    const showTranslation = useMushafSettingsStore(s => s.showTranslation);
    const showTransliteration = useMushafSettingsStore(
      s => s.showTransliteration,
    );
    const showTajweed = useMushafSettingsStore(s => s.showTajweed);
    const showWBW = useMushafSettingsStore(s => s.showWBW);
    const wbwShowTranslation = useMushafSettingsStore(
      s => s.wbwShowTranslation,
    );
    const wbwShowTransliteration = useMushafSettingsStore(
      s => s.wbwShowTransliteration,
    );
    const arabicFontSize = useMushafSettingsStore(s => s.arabicFontSize);
    const arabicTextWeight = useMushafSettingsStore(s => s.arabicTextWeight);
    const showAllahNameHighlight = useMushafSettingsStore(
      s => s.showAllahNameHighlight,
    );
    const allahNameHighlightColorSetting = useMushafSettingsStore(
      s => s.allahNameHighlightColor,
    );
    const translationFontSize = useMushafSettingsStore(
      s => s.translationFontSize,
    );
    const transliterationFontSize = useMushafSettingsStore(
      s => s.transliterationFontSize,
    );
    const mushafRenderer = useMushafSettingsStore(s => s.mushafRenderer);
    const selectedTranslationId = useMushafSettingsStore(
      s => s.selectedTranslationId,
    );
    const translationName = getTranslationName(selectedTranslationId);
    const allahNameHighlightColor = useMemo(
      () =>
        getAllahNameHighlightColorHex(
          allahNameHighlightColorSetting,
          theme.isDarkMode,
        ),
      [allahNameHighlightColorSetting, theme.isDarkMode],
    );

    // @ai-start
    // Same font as before for Hafs; a font that cannot draw a rewayah's marks
    // (IndoPak) is never used for non-Hafs text.
    const dkFontFamily = getDkFontFamily(mushafRenderer, mushafRewayah);
    // @ai-end
    const isDK =
      (mushafRenderer === 'dk_v1' ||
        mushafRenderer === 'dk_v2' ||
        mushafRenderer === 'dk_indopak') &&
      mushafPreloadService.initialized &&
      digitalKhattDataService.initialized;
    const subscribedFontMgr = useMushafFontMgr();
    const fontMgr = isDK ? subscribedFontMgr : null;
    const indexedTajweedData = useTajweedStore(s => s.indexedTajweedData);

    const items = useMemo(() => buildContinuousListItems(), []);

    // @ai TECH_DEBT #278: the live window width, so the rows follow a rotation.
    const {width: windowWidth} = useWindowDimensions();
    const sidePadding =
      width === undefined ? moderateScale(8) : readingListSidePadding(width); // @ai — the list key's column too
    const contentWidth = (width ?? windowWidth) - sidePadding * 2;

    // Load annotations for visible surahs
    const loadAnnotationsForSurah = useVerseAnnotationsStore(
      s => s.loadAnnotationsForSurah,
    );

    const handleVersePress = useCallback(() => {
      onTap?.();
    }, [onTap]);

    // Compute initial scroll index from page number
    // @ai-start
    // TECH_DEBT #411: at the verse the reader opened at, when it is on the
    // start page; else at the page.
    const initialScrollIndex = useMemo(() => {
      if (unitList) {
        const verseIndex = initialVerseKey
          ? unitList.indexForHafsReference(initialVerseKey, [])
          : undefined;
        return (
          listStartIndex(
            unitList.indexForPage(initialPage),
            verseIndex,
            unitList.indexForPage(initialPage + 1),
          ) ?? 0
        );
      }
      const pageStart = verseIndexOf(getFirstVerseKeyForPage(initialPage));
      const verseIndex = initialVerseKey
        ? verseIndexOf(hafsVerseKeyOf(initialVerseKey))
        : undefined;
      const nextPageStart = verseIndexOf(
        getFirstVerseKeyForPage(initialPage + 1),
      );
      return listStartIndex(pageStart, verseIndex, nextPageStart) ?? 0;
    }, [initialPage, initialVerseKey, unitList]);
    // @ai-end

    // #55: FlashList v2 mis-lands `initialScrollIndex` before measurement. Scroll again after layout (2 rAF).
    const didInitialScrollRef = useRef(false);
    useEffect(() => {
      if (didInitialScrollRef.current) return;
      // Include index 0: FlashList v2 mis-lands it too (#55).
      if (initialScrollIndex == null) return;
      didInitialScrollRef.current = true;
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          try {
            flashListRef.current?.scrollToIndex({
              index: initialScrollIndex,
              animated: false,
            });
          } catch {
            // A pre-measurement scrollToIndex can fail; the initialScrollIndex prop already set the position.
          }
        });
      });
      return () => {
        cancelAnimationFrame(outer);
        if (inner) cancelAnimationFrame(inner);
      };
    }, [initialScrollIndex]);

    // Track viewable items for surah/page updates
    const onViewableItemsChanged = useCallback(
      ({viewableItems}: {viewableItems: Array<{item: ContinuousListItem}>}) => {
        if (viewableItems.length === 0) return;
        const firstItem = viewableItems[0].item;
        if (firstItem.type === 'surah_header') {
          onCurrentSurahChange?.(firstItem.surahNumber);
          loadAnnotationsForSurah(firstItem.surahNumber);
        } else if (firstItem.type === 'verse') {
          onCurrentSurahChange?.(firstItem.surahNumber);
          loadAnnotationsForSurah(firstItem.surahNumber);
          // Report accurate page number from verse-to-page mapping
          // @ai — a rewayah verse row: the page of its first word
          const page = isVerseUnitRow(firstItem.verse)
            ? unitListRef.current?.pageOfRow(firstItem.verse.verse_key)
            : getPageForVerse(firstItem.verse.verse_key);
          if (page) onCurrentPageChange?.(page);
        }
      },
      [onCurrentSurahChange, onCurrentPageChange, loadAnnotationsForSurah],
    );

    const renderItem = useCallback(
      ({item}: ListRenderItemInfo<ContinuousListItem>) => {
        if (item.type === 'surah_header') {
          return (
            <View>
              <SurahDivider
                width={contentWidth}
                surahNumber={item.surahNumber}
                textColor={labelColor}
                nameColor={textColor}
              />
              <BasmalaHeader
                visible={item.showBismillah}
                surahNumber={item.surahNumber} // @ai
                width={contentWidth}
                textColor={textColor}
                showTajweed={showTajweed}
                fontMgr={fontMgr}
                dkFontFamily={dkFontFamily}
                indexedTajweedData={indexedTajweedData}
                arabicTextWeight={arabicTextWeight}
                showAllahNameHighlight={showAllahNameHighlight}
                allahNameHighlightColor={allahNameHighlightColor}
                // @ai — lit while its basmala is recited; unset otherwise, so the
                // header's props stay exactly as before (readingViews.hafsGolden)
                isActive={
                  (isPlaying && basmalaSurah === item.surahNumber) || undefined
                }
              />
            </View>
          );
        }

        return (
          <VerseItem
            verse={item.verse}
            onVersePress={handleVersePress}
            textColor={textColor}
            borderColor={borderColor}
            showTranslation={showTranslation}
            showTransliteration={showTransliteration}
            showTajweed={showTajweed}
            arabicFontFamily="Uthmani"
            transliterationFontSize={transliterationFontSize}
            translationFontSize={translationFontSize}
            arabicFontSize={arabicFontSize}
            fontMgr={fontMgr}
            dkFontFamily={dkFontFamily}
            indexedTajweedData={indexedTajweedData}
            isActive={
              isPlaying &&
              // @ai — a rewayah verse row: lit by the band's verse keys
              (isVerseUnitRow(item.verse)
                ? bandKeys.includes(item.verse.verse_key)
                : playbackVerseKeys.includes(item.verse.verse_key))
            }
            source="mushaf"
            translationName={translationName}
            translationId={selectedTranslationId}
            showWBW={showWBW}
            wbwShowTranslation={wbwShowTranslation}
            wbwShowTransliteration={wbwShowTransliteration}
            // @ai — the row is this rewayah verse (label, text, actions)
            unitRow={isVerseUnitRow(item.verse) ? item.verse : undefined}
          />
        );
      },
      [
        contentWidth,
        textColor,
        labelColor,
        borderColor,
        showTranslation,
        showTransliteration,
        showTajweed,
        arabicFontSize,
        arabicTextWeight,
        translationFontSize,
        transliterationFontSize,
        fontMgr,
        dkFontFamily,
        indexedTajweedData,
        handleVersePress,
        playbackVerseKeys, // @ai
        basmalaSurah, // @ai
        bandKeys, // @ai
        isPlaying,
        translationName,
        selectedTranslationId,
        showWBW,
        wbwShowTranslation,
        wbwShowTransliteration,
        showAllahNameHighlight,
        allahNameHighlightColor,
      ],
    );

    const getItemType = useCallback(
      (item: ContinuousListItem) => item.type,
      [],
    );

    const keyExtractor = useCallback(
      (item: ContinuousListItem, _index: number) => {
        if (item.type === 'surah_header') return `header-${item.surahNumber}`;
        return item.verse.verse_key;
      },
      [],
    );

    // @ai-start
    // A rewayah whose verse units are not ready: no rows yet (never its text
    // as Hafs verses).
    if (unitsRewayah && !unitList) {
      return (
        <VerseUnitsPending
          status={verseUnitsStatus === 'ready' ? 'loading' : verseUnitsStatus}
          rewayah={unitsRewayah}
          color={labelColor}
        />
      );
    }
    // @ai-end

    return (
      <FlashList
        ref={flashListRef}
        data={unitList ? unitList.items : items} // @ai
        renderItem={renderItem}
        extraData={`${(unitList ? bandKeys : playbackVerseKeys).join(',')}-${arabicTextWeight}-${showAllahNameHighlight}-${allahNameHighlightColor}`} // @ai
        getItemType={getItemType}
        keyExtractor={keyExtractor}
        initialScrollIndex={initialScrollIndex}
        contentContainerStyle={{
          paddingTop: insets.top + verticalScale(60),
          paddingBottom: insets.bottom + verticalScale(80),
          paddingHorizontal: sidePadding,
        }}
        showsVerticalScrollIndicator={false}
        scrollsToTop={scrollsToTop}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{itemVisiblePercentThreshold: 50}}
      />
    );
  },
);
// @ai-end
ContinuousListView.displayName = 'ContinuousListView';

export default React.memo(ContinuousListView);

// Re-export navigation helpers for use by MushafViewer
export {getSurahIndex, getVerseIndex, getFirstVerseKeyForPage};
