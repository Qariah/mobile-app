import React, {useCallback, useMemo, useState} from 'react';
import {Dimensions, FlatList, View, ViewStyle} from 'react-native';
import {moderateScale} from 'react-native-size-matters';
import {useFocusEffect} from 'expo-router';
import {SURAHS, Surah} from '@/data/surahData';
import {
  mushafSessionStore,
  type RecentPage,
} from '@/services/mushaf/MushafSessionStore';
import {HeroSection} from './HeroSection';
import {SurahHeroSection} from './SurahsHero';

const SECTION_HEIGHT = moderateScale(150);
const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_GAP = moderateScale(10);

function getSurahForPage(page: number): Surah | undefined {
  return SURAHS.find(s => {
    const [start, end] = s.pages.split('-').map(Number);
    return page >= start && page <= end;
  });
}

function relativeTime(now: number, ts: number): string {
  const diffMs = now - ts;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  return 'a while ago';
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
          ? 'CONTINUE READING'
          : relativeTime(now, rp.openedAt).toUpperCase();
      deduped.push({
        key: `${surah.id}-${rp.page}-${rp.openedAt}`,
        surah,
        resumePage: rp.page,
        title,
      });
    }
    return deduped;
  }, [recent, historySize]);

  const cardWidth = useMemo(() => {
    if (entries.length <= 1) {
      return SCREEN_WIDTH - moderateScale(32);
    }
    return Math.round(SCREEN_WIDTH * 0.78);
  }, [entries.length]);

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
