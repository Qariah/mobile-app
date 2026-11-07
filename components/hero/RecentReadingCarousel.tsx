import React, {useCallback, useMemo, useState} from 'react';
import {FlatList, View, ViewStyle, useWindowDimensions} from 'react-native';
import {moderateScale} from 'react-native-size-matters';
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

const SECTION_HEIGHT = moderateScale(150);
const CARD_GAP = moderateScale(10);

// @ai — the card width follows the live window width. A width read once at
// import time keeps the width of the window at the first render: Metro
// inline requires load this module when the carousel first renders, and
// that can be on the way back from the Mushaf reader while the window is
// still in landscape. The card then kept a landscape width in portrait
// (TECH_DEBT #273).
export function carouselCardWidth(
  windowWidth: number,
  entryCount: number,
): number {
  if (entryCount <= 1) {
    return windowWidth - moderateScale(32);
  }
  return Math.round(windowWidth * 0.78);
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

  const {width: windowWidth} = useWindowDimensions(); // @ai
  const cardWidth = carouselCardWidth(windowWidth, entries.length); // @ai

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
  if (entries.length <= 1) {
    return (
      <HeroSection
        mainHero={
          <View style={{paddingHorizontal: moderateScale(16)}}>
            {entries[0] ? (
              <SurahHeroSection
                surah={entries[0].surah}
                onLongPress={onSurahLongPress}
                title={entries[0].title}
                style={cardStyle}
                resumePage={entries[0].resumePage}
              />
            ) : null}
          </View>
        }
        randomHero={false}
      />
    );
  }

  return (
    <HeroSection
      mainHero={
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
            paddingHorizontal: moderateScale(16),
          }}
          snapToInterval={cardWidth + CARD_GAP}
          decelerationRate="fast"
        />
      }
      randomHero={false}
    />
  );
}
