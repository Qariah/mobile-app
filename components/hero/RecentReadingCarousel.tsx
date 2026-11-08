import React, {useCallback, useMemo, useState} from 'react';
import {
  FlatList,
  LayoutChangeEvent,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import {moderateScale} from '@/utils/scale';
import {useFocusEffect} from 'expo-router';
import {SURAHS, Surah} from '@/data/surahData';
import {
  mushafSessionStore,
  type RecentPage,
} from '@/services/mushaf/MushafSessionStore';
import {HeroSection} from './HeroSection';
import {SurahHeroSection} from './SurahsHero';
import {useTranslation} from 'react-i18next';
import type {TFunction} from 'i18next';
import {useResponsive} from '@/hooks/useResponsive'; // @ai

const SECTION_HEIGHT = moderateScale(150);
const CARD_GAP = moderateScale(10);

// @ai — the card width follows the live window width. A width read once at
// import time keeps the width of the window at the first render: Metro
// inline requires load this module when the carousel first renders, and
// that can be on the way back from the Mushaf reader while the window is
// still in landscape. The card then kept a landscape width in portrait
// (TECH_DEBT #273).
// Sprint 52 Task 6: `availableWidth` is the window on a phone and the
// measured pane on a tablet (the sidebar is not part of the pane). `inset`
// is the space that the single card leaves at both edges.
export function carouselCardWidth(
  availableWidth: number,
  entryCount: number,
  inset: number = moderateScale(32),
): number {
  if (entryCount <= 1) {
    return availableWidth - inset;
  }
  return Math.round(availableWidth * 0.78);
}

function getSurahForPage(page: number): Surah | undefined {
  return SURAHS.find(s => {
    const [start, end] = s.pages.split('-').map(Number);
    return page >= start && page <= end;
  });
}

function relativeTime(
  now: number,
  ts: number,
  t: TFunction<['qariah', 'home']>,
): string {
  const diffMs = now - ts;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return t('qariah:recent.justNow');
  if (min < 60) return t('qariah:recent.minutesAgo', {count: min});
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('qariah:recent.hoursAgo', {count: hr});
  const day = Math.floor(hr / 24);
  if (day === 1) return t('qariah:recent.yesterday');
  if (day < 7) return t('qariah:recent.daysAgo', {count: day});
  const wk = Math.floor(day / 7);
  if (wk < 5) return t('qariah:recent.weeksAgo', {count: wk});
  return t('qariah:recent.longAgo');
}

interface RecentReadingCarouselProps {
  onSurahLongPress?: (surah: Surah) => void;
  /**
   * RFC-011 `branding.continueReadingHistorySize` — max number of recent
   * stopping points to show. Already clamped to [1, 10] by the caller.
   */
  historySize: number;
  /**
   * @ai Sprint 52 Task 6 — the carousel sits in a half-width cell of the
   * iPad row beside Continue Listening: no HeroSection wrapper, and the row
   * supplies the side padding.
   */
  bare?: boolean;
}

interface DisplayEntry {
  key: string;
  surah: Surah;
  resumePage: number;
  title: string;
}

/**
 * Horizontal carousel of the last N reading stopping points (N =
 * `branding.continueReadingHistorySize`, RFC-011). Replaces the
 * single-hero `ContinueReadingHero` when that value is > 1. The leftmost
 * card preserves the existing Continue-Reading hero affordance
 * (`SurahHeroSection` with `resumePage`); subsequent cards are the same
 * component with a recency label as title.
 */
export function RecentReadingCarousel({
  onSurahLongPress,
  historySize,
  bare = false,
}: RecentReadingCarouselProps) {
  const {t} = useTranslation(['qariah', 'home']);
  const [recent, setRecent] = useState<RecentPage[]>(() =>
    mushafSessionStore.getRecentPages(),
  );
  useFocusEffect(
    useCallback(() => {
      setRecent(mushafSessionStore.getRecentPages());
    }, []),
  );

  const entries: DisplayEntry[] = useMemo(() => {
    const now = Date.now();
    const seenSurahIds = new Set<number>();
    const deduped: DisplayEntry[] = [];
    for (const rp of recent) {
      if (deduped.length >= historySize) break;
      const surah = getSurahForPage(rp.page);
      if (!surah || seenSurahIds.has(surah.id)) continue;
      seenSurahIds.add(surah.id);
      const title =
        deduped.length === 0
          ? t('home:hero.continueReading')
          : relativeTime(now, rp.openedAt, t).toUpperCase();
      deduped.push({
        key: `${surah.id}-${rp.page}-${rp.openedAt}`,
        surah,
        resumePage: rp.page,
        title,
      });
    }
    return deduped;
  }, [recent, historySize, t]);

  // @ai-start
  // A tablet sizes the cards from the measured pane (the sidebar takes part
  // of the window). The first frame uses a window-width guess. A phone
  // keeps the window width: same widths as before.
  const {width: windowWidth} = useWindowDimensions();
  const {isTablet} = useResponsive();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w <= 0) return;
    setMeasuredWidth(prev => (prev === w ? prev : w));
  }, []);
  const availableWidth =
    isTablet && measuredWidth !== null
      ? measuredWidth
      : bare
        ? windowWidth / 2
        : windowWidth;
  // A tablet draws nothing until the pane is measured: no wrong first frame,
  // no remount of the list on the first layout.
  const awaitingLayout = isTablet && measuredWidth === null;
  const sidePadding = bare ? 0 : moderateScale(16);
  const cardWidth = carouselCardWidth(
    availableWidth,
    entries.length,
    2 * sidePadding,
  );
  // @ai-end

  const cardStyle: ViewStyle = useMemo(
    () => ({width: cardWidth, height: SECTION_HEIGHT}),
    [cardWidth],
  );

  const renderItem = useCallback(
    ({item}: {item: DisplayEntry}) => (
      <View style={{width: cardWidth}}>
        <SurahHeroSection
          surah={item.surah}
          onLongPress={onSurahLongPress}
          title={item.title}
          style={cardStyle}
          resumePage={item.resumePage}
        />
      </View>
    ),
    [cardWidth, cardStyle, onSurahLongPress],
  );

  const keyExtractor = useCallback((item: DisplayEntry) => item.key, []);

  const ItemSeparator = useCallback(
    () => <View style={{width: CARD_GAP}} />,
    [],
  );

  // Single entry → preserve the original hero look (no horizontal scroll
  // affordance). FlatList still works but the unnecessary peek looks odd.
  // @ai-start
  const wrap = (content: React.ReactElement) => (
    <View
      testID="recent-reading-carousel"
      style={{width: '100%'}}
      onLayout={onLayout}
      accessible={false}>
      {awaitingLayout ? (
        <View style={{height: SECTION_HEIGHT}} />
      ) : bare ? (
        content
      ) : (
        <HeroSection mainHero={content} randomHero={false} />
      )}
    </View>
  );
  // @ai-end
  if (entries.length <= 1) {
    return wrap(
      <View style={{paddingHorizontal: sidePadding}}>
        {entries[0] ? (
          <SurahHeroSection
            surah={entries[0].surah}
            onLongPress={onSurahLongPress}
            title={entries[0].title}
            style={cardStyle}
            resumePage={entries[0].resumePage}
          />
        ) : null}
      </View>,
    );
  }

  return wrap(
    <FlatList
      // @ai — a new card width remounts the list at its start: with the
      // old scroll offset, snapToInterval would stop between two cards.
      key={`cards-${cardWidth}`}
      data={entries}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      ItemSeparatorComponent={ItemSeparator}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: sidePadding,
      }}
      snapToInterval={cardWidth + CARD_GAP}
      decelerationRate="fast"
    />,
  );
}
