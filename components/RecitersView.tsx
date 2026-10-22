import React, {useMemo, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  FlatList,
  Pressable,
} from 'react-native';
import {useTheme} from '@/hooks/useTheme';
import {moderateScale, verticalScale} from 'react-native-size-matters';
import {Reciter, RECITERS} from '@/data/reciterData';
import {BrowseReciterCard} from './browse/BrowseReciterCard';
import {CircularReciterCard} from './cards/CircularReciterCard';
import {useFavoriteReciters} from '@/hooks/useFavoriteReciters';
import {RecentReciterCard} from '@/components/cards/RecentReciterCard';
import {useLoved} from '@/hooks/useLoved';
import {useContentReadyWatchdog} from '@/hooks/useContentReadyWatchdog';
import {
  useRecentlyPlayedStore,
  RecentlyPlayedTrack,
} from '@/services/player/store/recentlyPlayedStore';
import {useDownloadStore} from '@/services/player/store/downloadStore';
import {usePlaylists} from '@/hooks/usePlaylists';
import {PlaylistCard} from '@/components/cards/PlaylistCard';
import {UserPlaylist} from '@/services/playlist/PlaylistService';
import {Theme} from '@/utils/themeUtils';
import {RecitersHero} from '@/components/hero/RecitersHero';
// Sprint 25 (S25.2) — ListenTabTopGrid is now consumed via
// `branding.listenTabTopComponent` (RFC-008 seam); no direct import needed.
import {
  getTajweedReciters,
  getMemorizationReciters,
  getBeginnerFriendlyReciters,
  getFeaturedReciters,
  getCuratedReciters,
  getFollowAlongReciters,
  getHonoredReciters,
  getParadiseReciters,
  getNewlyAddedReciters,
  getFullRecordingReciters,
} from '@/data/reciterCollections';
// Sprint 14 — SURAHS / SurahCard / GRADIENT_COLORS imports dropped along with
// the Sprint-13 standalone "Explore by Surah" row.
import {useTimestampStore} from '@/store/timestampStore';
import {useReciterStore} from '@/store/reciterStore';
import {getAllRewayatTypes, RewayatInfo} from '@/data/rewayatCollections';
import RewayatCard from '@/components/cards/RewayatCard';
import {getAllCountries, CountryInfo} from '@/data/countryCollections';
import CountryCard from '@/components/cards/CountryCard';
import {
  getAllTranslations,
  TranslationInfo,
} from '@/data/translationCollections';
import TranslationCard from '@/components/cards/TranslationCard';
import {useMostPlayedReciters} from '@/hooks/useMostPlayedReciters';
import {useTrendingReciters} from '@/hooks/useTrendingReciters';
import {useSettings} from '@/hooks/useSettings';
import {useRouter} from 'expo-router';
import Color from 'color';
import {useReciterFollowAlong} from '@/hooks/useFollowAlong';
import {useBottomInset} from '@/hooks/useBottomInset';
import {USE_GLASS} from '@/hooks/useGlassProps';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAdhkarStore} from '@/store/adhkarStore';
import {AdhkarBentoCard} from '@/components/adhkar/AdhkarBentoCard';
import {
  ADHKAR_TILE_GAP,
  ADHKAR_TILE_WIDTH,
  AdhkarNowPlayingCard,
  useHasAdhkarSession,
} from '@/components/adhkar/AdhkarNowPlayingCard';
import {SuperCategory} from '@/types/adhkar';
import {isFeatureEnabled} from '@/config/featureFlags';
import branding, {type HomeRow, type HomeRowId} from '@/config/branding';
// Qariah (Sprint 48): the "Newly Added" row of recitations.
import {NewlyAddedRecitationsRow} from '@/components/listen/NewlyAddedRecitationsRow';
// Qariah (TECH_DEBT #314): the rows start at their first card in Arabic on
// iOS, and their item layout is the real one.
import {RtlRowFlatList} from '@/components/listen/RtlRowFlatList';
import {rowItemLayout} from '@/components/listen/rowItemLayout';
// @ai-start
import {useTranslation} from 'react-i18next';
import {getReciterDisplayName, getSurahDisplayName} from '@/i18n/format';
// @ai-end

/**
 * Fallback row order used when `branding.homeRowConfig` is undefined.
 * Matches the historical hardcoded Bayaan order so behavior is unchanged
 * for any branding that omits the field. Forks declare their own array
 * in `config/branding.js` to reorder, hide, or omit rows entirely.
 * Qariah's curated order lives in `config/branding.js` → `homeRowConfig`.
 */
const DEFAULT_HOME_ROW_CONFIG: readonly HomeRow[] = [
  {id: 'continue-listening', enabled: true},
  {id: 'new-to-quran', enabled: true},
  {id: 'favorites', enabled: true},
  {id: 'featured', enabled: true},
  {id: 'adhkar', enabled: true},
  {id: 'follow-along', enabled: true},
  {id: 'playlists', enabled: true},
  {id: 'exclusives', enabled: true},
  {id: 'tajweed', enabled: true},
  {id: 'memorization', enabled: true},
  {id: 'rewayat', enabled: true},
  {id: 'collection', enabled: true},
];

// Qariah (Sprint 48): true only when the config turns the trending row on.
// The owner turned the row off on 2026-10-18, so the R2 fetch must not run.
const TRENDING_ROW_ENABLED = (
  branding.homeRowConfig ?? DEFAULT_HOME_ROW_CONFIG
).some(row => row.id === 'trending' && row.enabled);

interface RecitersViewProps {
  onReciterPress: (reciter: Reciter) => void;
}

type SectionItem =
  | Reciter
  | RecentlyPlayedTrack
  | RewayatInfo
  | UserPlaylist
  | CountryInfo
  | TranslationInfo;

// Memoize the FlatList component
const MemoizedFlatList = React.memo(
  ({
    data,
    variant,
    onReciterPress,
    onRewayatPress,
    onPlaylistPress,
    onCountryPress,
    onTranslationPress,
    showAdhkarTile,
  }: {
    data: SectionItem[];
    variant:
      | 'recent'
      | 'circular'
      | 'default'
      | 'featured'
      | 'rewayat'
      | 'playlist'
      | 'country'
      | 'translation';
    onReciterPress: (reciter: Reciter) => void;
    onRewayatPress?: (rewayat: RewayatInfo) => void;
    onPlaylistPress?: (playlist: UserPlaylist) => void;
    onCountryPress?: (country: CountryInfo) => void;
    onTranslationPress?: (translation: TranslationInfo) => void;
    showAdhkarTile?: boolean;
    theme: Theme;
  }) => (
    <RtlRowFlatList
      data={data}
      renderItem={({item, index}) => (
        <RenderSectionItem
          item={item}
          variant={variant}
          index={index}
          onReciterPress={onReciterPress}
          onRewayatPress={onRewayatPress}
          onPlaylistPress={onPlaylistPress}
          onCountryPress={onCountryPress}
          onTranslationPress={onTranslationPress}
        />
      )}
      keyExtractor={item =>
        'timestamp' in item
          ? `${item.reciter?.id ?? 'unknown'}-${item.surah?.id ?? 'unknown'}-${
              item.timestamp
            }`
          : 'displayName' in item
            ? item.id
            : 'itemCount' in item && 'color' in item
              ? item.id
              : 'languageCode' in item
                ? item.id
                : 'reciterCount' in item && 'flag' in item
                  ? `country-${item.id}`
                  : item.id
      }
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.sectionContent}
      ListHeaderComponent={
        showAdhkarTile ? (
          <View style={{flex: 1}}>
            <AdhkarNowPlayingCard variant="tile" />
          </View>
        ) : null
      }
      removeClippedSubviews={true}
      maxToRenderPerBatch={5}
      windowSize={3}
      initialNumToRender={5}
      // Qariah (TECH_DEBT #314): the real card width and gap (rowItemLayout.ts).
      getItemLayout={(_, index) =>
        rowItemLayout(
          variant,
          index,
          showAdhkarTile && variant === 'recent'
            ? ADHKAR_TILE_WIDTH + ADHKAR_TILE_GAP
            : 0,
        )
      }
    />
  ),
  (prevProps, nextProps) =>
    prevProps.data === nextProps.data &&
    prevProps.variant === nextProps.variant &&
    prevProps.onReciterPress === nextProps.onReciterPress &&
    prevProps.onRewayatPress === nextProps.onRewayatPress &&
    prevProps.onPlaylistPress === nextProps.onPlaylistPress &&
    prevProps.onCountryPress === nextProps.onCountryPress &&
    prevProps.onTranslationPress === nextProps.onTranslationPress &&
    prevProps.showAdhkarTile === nextProps.showAdhkarTile &&
    prevProps.theme === nextProps.theme,
);

MemoizedFlatList.displayName = 'MemoizedFlatList';

// @ai-start
const RenderSectionItem = React.memo(
  ({
    item,
    variant,
    index,
    onReciterPress,
    onRewayatPress,
    onPlaylistPress,
    onCountryPress,
    onTranslationPress,
  }: {
    item: SectionItem;
    variant:
      | 'recent'
      | 'circular'
      | 'default'
      | 'featured'
      | 'rewayat'
      | 'playlist'
      | 'country'
      | 'translation';
    index: number;
    onReciterPress: (reciter: Reciter) => void;
    onRewayatPress?: (rewayat: RewayatInfo) => void;
    onPlaylistPress?: (playlist: UserPlaylist) => void;
    onCountryPress?: (country: CountryInfo) => void;
    onTranslationPress?: (translation: TranslationInfo) => void;
  }) => {
    const {theme} = useTheme();
    const {t} = useTranslation(['home', 'common']);

    // Derive reciter ID for follow-along badge
    const reciterId =
      'timestamp' in item
        ? (item as RecentlyPlayedTrack).reciter?.id
        : 'rewayat' in item
          ? (item as Reciter).id
          : undefined;
    const showFollowAlong = useReciterFollowAlong(reciterId);

    if (variant === 'recent' && 'timestamp' in item) {
      if (item.isUserUpload) {
        return (
          <RecentReciterCard
            imageUrl={
              item.reciter?.id !== '__uploads__'
                ? (item.reciter?.image_url ?? undefined)
                : undefined
            }
            reciterName={item.uploadArtist || t('home.myRecitations')}
            surahName={item.uploadTitle || t('home.upload')}
            trackId={`upload:${item.userRecitationId}`}
            reciterId={item.reciter?.id || '__uploads__'}
            surahId={item.surah?.id || 0}
            duration={item.duration}
            progress={item.progress}
            index={index}
            isUserUpload
            userRecitationId={item.userRecitationId}
          />
        );
      }

      if (!item.reciter?.name || !item.surah?.name) {
        return null;
      }

      return (
        <RecentReciterCard
          imageUrl={item.reciter.image_url ?? undefined}
          reciterName={getReciterDisplayName(item.reciter)}
          surahName={getSurahDisplayName(item.surah)}
          trackId={`${item.reciter.id}:${item.surah.id}`}
          reciterId={item.reciter.id}
          surahId={item.surah.id}
          duration={item.duration}
          progress={item.progress}
          rewayatId={item.rewayatId}
          index={index}
        />
      );
    }

    if (variant === 'circular') {
      const reciter = item as Reciter;
      return (
        <CircularReciterCard
          imageUrl={reciter.image_url ?? undefined}
          name={getReciterDisplayName(reciter)}
          onPress={() => onReciterPress(reciter)}
          showFollowAlong={showFollowAlong}
        />
      );
    }

    if (variant === 'featured') {
      const reciter = item as Reciter;
      return (
        <BrowseReciterCard
          reciter={reciter}
          onPress={() => onReciterPress(reciter)}
          width={moderateScale(140)}
          height={moderateScale(160)}
          theme={theme}
          showFollowAlong={showFollowAlong}
        />
      );
    }

    if (variant === 'rewayat' && 'displayName' in item) {
      const rewayat = item as RewayatInfo;
      return (
        <RewayatCard
          rewayat={rewayat}
          onPress={() => onRewayatPress?.(rewayat)}
          width={moderateScale(130)}
          height={moderateScale(110)}
        />
      );
    }

    if (variant === 'playlist' && 'itemCount' in item && 'color' in item) {
      const playlist = item as UserPlaylist;
      return (
        <PlaylistCard
          name={playlist.name}
          itemCount={playlist.itemCount}
          color={playlist.color}
          playlistId={playlist.id}
          onPress={() => onPlaylistPress?.(playlist)}
          width={moderateScale(110)}
          height={moderateScale(110)}
        />
      );
    }

    if (
      variant === 'country' &&
      'reciterCount' in item &&
      !('teacher' in item)
    ) {
      const country = item as CountryInfo;
      return (
        <CountryCard
          country={country}
          onPress={() => onCountryPress?.(country)}
          width={moderateScale(130)}
          height={moderateScale(110)}
        />
      );
    }

    if (variant === 'translation' && 'languageCode' in item) {
      const translation = item as TranslationInfo;
      return (
        <TranslationCard
          translation={translation}
          onPress={() => onTranslationPress?.(translation)}
          width={moderateScale(130)}
          height={moderateScale(110)}
        />
      );
    }

    const reciter = item as Reciter;
    return (
      <BrowseReciterCard
        reciter={reciter}
        onPress={() => onReciterPress(reciter)}
        width={moderateScale(120)}
        height={moderateScale(140)}
        theme={theme}
        showFollowAlong={showFollowAlong}
      />
    );
  },
);
// @ai-end

RenderSectionItem.displayName = 'RenderSectionItem';

// Memoize the section component
// @ai-start
const Section = React.memo(
  ({
    title,
    data,
    variant,
    onReciterPress,
    onRewayatPress,
    onPlaylistPress,
    onCountryPress,
    onTranslationPress,
    onClear,
    showAdhkarTile,
    theme,
  }: {
    title: string;
    data: SectionItem[];
    variant:
      | 'recent'
      | 'circular'
      | 'default'
      | 'featured'
      | 'rewayat'
      | 'playlist'
      | 'country'
      | 'translation';
    onReciterPress: (reciter: Reciter) => void;
    onRewayatPress?: (rewayat: RewayatInfo) => void;
    onPlaylistPress?: (playlist: UserPlaylist) => void;
    onCountryPress?: (country: CountryInfo) => void;
    onTranslationPress?: (translation: TranslationInfo) => void;
    onClear?: () => void;
    showAdhkarTile?: boolean;
    theme: Theme;
  }) => {
    const {t} = useTranslation(['home', 'common']);
    if (!data.length && !showAdhkarTile) return null;

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, {color: theme.colors.text}]}>
            {title}
          </Text>
          {onClear && data.length > 0 && (
            <Pressable onPress={onClear} hitSlop={8}>
              <Text
                style={[
                  styles.clearButton,
                  {
                    color: Color(theme.colors.textSecondary)
                      .alpha(0.5)
                      .toString(),
                  },
                ]}>
                {t('common:actions.clear')}
              </Text>
            </Pressable>
          )}
        </View>
        <MemoizedFlatList
          data={data}
          variant={variant}
          onReciterPress={onReciterPress}
          onRewayatPress={onRewayatPress}
          onPlaylistPress={onPlaylistPress}
          onCountryPress={onCountryPress}
          onTranslationPress={onTranslationPress}
          showAdhkarTile={showAdhkarTile}
          theme={theme}
        />
      </View>
    );
  },
  (prevProps, nextProps) =>
    prevProps.data === nextProps.data &&
    prevProps.variant === nextProps.variant &&
    prevProps.onReciterPress === nextProps.onReciterPress &&
    prevProps.onRewayatPress === nextProps.onRewayatPress &&
    prevProps.onPlaylistPress === nextProps.onPlaylistPress &&
    prevProps.onCountryPress === nextProps.onCountryPress &&
    prevProps.onTranslationPress === nextProps.onTranslationPress &&
    prevProps.onClear === nextProps.onClear &&
    prevProps.showAdhkarTile === nextProps.showAdhkarTile &&
    prevProps.theme === nextProps.theme,
);
// @ai-end

Section.displayName = 'Section';

// Seeded shuffle function for consistent shuffling within a session
function seededShuffle<T>(array: T[], seed: number): T[] {
  const shuffled = [...array];
  let currentSeed = seed;

  // Simple seeded random number generator
  const random = () => {
    currentSeed = (currentSeed * 9301 + 49297) % 233280;
    return currentSeed / 233280;
  };

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// @ai-start
function RecitersView({onReciterPress}: RecitersViewProps) {
  const {theme} = useTheme();
  const {t} = useTranslation(['home', 'common', 'qariah']);
  const bottomInset = useBottomInset();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const recentTracks = useRecentlyPlayedStore(s => s.recentTracks);
  const showAdhkarTile = useHasAdhkarSession();
  const {favoriteReciters} = useFavoriteReciters();
  const {lovedTracks} = useLoved();
  const downloads = useDownloadStore(state => state.downloads);
  const {playlists} = usePlaylists();
  const {incrementRecitersViewOpenCount, shouldShowNewToQuran} = useSettings();

  // TECH_DEBT #154 — content-ready watchdog for the Listen tab. The catalog
  // gates every catalog-dependent row; if `isInitialized` never flips, this
  // self-reports `screen-content-stalled` (field-only, full-fleet). Mirrors the
  // Mushaf wiring (app/mushaf.tsx). Report-only — no behaviour change. This is
  // the instrument-don't-cold-pressure-gate posture (regression-test-plan.md).
  const catalogReady = useReciterStore(s => s.isInitialized);
  useContentReadyWatchdog({
    screen: 'listen',
    ready: catalogReady,
    awaiting: 'catalog',
  });

  // Generate a session seed once when the component first mounts
  // This persists across re-renders but changes on app restart
  const sessionSeed = useRef(Date.now()).current;

  // Filter out any corrupted recent tracks (missing reciter or surah data)
  // Upload tracks are valid if they have userRecitationId
  const validRecentTracks = useMemo(
    () =>
      recentTracks.filter(track =>
        track.isUserUpload
          ? !!track.userRecitationId
          : track.reciter?.id &&
            track.reciter?.name &&
            track.surah?.id &&
            track.surah?.name,
      ),
    [recentTracks],
  );

  // Track when the reciters view is opened
  useEffect(() => {
    incrementRecitersViewOpenCount();
  }, [incrementRecitersViewOpenCount]);

  // Shuffle favorites for variety (uses session seed so consistent within session)
  const favoriteRecitersSection = useMemo(
    () => seededShuffle(favoriteReciters, sessionSeed).slice(0, 10),
    [favoriteReciters, sessionSeed],
  );

  const collectionReciters = useMemo(() => {
    // Reciters from loved tracks
    const reciterIdsFromLoved = lovedTracks.map(track => track.reciterId);

    // Reciters from downloads (completed only)
    const reciterIdsFromDownloads = downloads
      .filter(d => d.status === 'completed')
      .map(d => d.reciterId);

    // Combine all sources into a unique set
    // Sources: favorites, loved tracks, downloads
    const uniqueReciterIds = new Set([
      ...favoriteReciters.map(r => r.id),
      ...reciterIdsFromLoved,
      ...reciterIdsFromDownloads,
    ]);

    const reciters = Array.from(uniqueReciterIds)
      .map(id => RECITERS.find(r => r.id === id))
      .filter((r): r is Reciter => r !== undefined);

    // Shuffle for variety
    return seededShuffle(reciters, sessionSeed + 1).slice(0, 10);
  }, [favoriteReciters, lovedTracks, downloads, sessionSeed]);

  // Get specialized reciter collections with session-based shuffle
  // Each collection uses a different offset to the seed for unique shuffles
  const featuredReciters = useMemo(
    () => seededShuffle(getFeaturedReciters(8), sessionSeed + 2),
    [sessionSeed],
  );
  const bayaanOriginalsReciters = useMemo(
    () => seededShuffle(getCuratedReciters(10), sessionSeed + 3),
    [sessionSeed],
  );
  const beginnerFriendlyReciters = useMemo(
    () => seededShuffle(getBeginnerFriendlyReciters(10), sessionSeed + 4),
    [sessionSeed],
  );
  const tajweedReciters = useMemo(
    () => seededShuffle(getTajweedReciters(10), sessionSeed + 5),
    [sessionSeed],
  );
  const memorizationReciters = useMemo(
    () => seededShuffle(getMemorizationReciters(10), sessionSeed + 6),
    [sessionSeed],
  );
  const registryLoaded = useTimestampStore(s => s.registryLoaded);
  const followAlongReciters = useMemo(
    () =>
      registryLoaded
        ? seededShuffle(getFollowAlongReciters(), sessionSeed + 9)
        : [],
    [sessionSeed, registryLoaded],
  );
  const rewayatTypes = useMemo(() => getAllRewayatTypes(), []);

  // Sprint 13 — Qariah-specific reciter collections.
  // Honored + Paradise are curated lists (driven by the Sprint 13 CSV);
  // they return empty arrays until the CSV is filled in and auto-hide.
  // Newly Added is algorithmic (catalog `added_at` window) and Full
  // Recording is algorithmic (catalog flag) — both return non-empty data
  // today and render whenever data exists.
  const honoredReciters = useMemo(
    () => seededShuffle(getHonoredReciters(), sessionSeed + 10),
    [sessionSeed],
  );
  const paradiseReciters = useMemo(
    () => seededShuffle(getParadiseReciters(), sessionSeed + 11),
    [sessionSeed],
  );
  const newlyAddedReciters = useMemo(() => getNewlyAddedReciters(30), []);
  const fullRecordingReciters = useMemo(() => {
    // Sprint 26 user-feedback — Translation reciters (e.g. Maryam from
    // Elgo Academy, Spanish) satisfy the 114-surah `getFullRecordingReciters`
    // filter because their translation tracks span the whole Quran. Anchor
    // them to the END of the row so the Arabic recitations always lead;
    // shuffle only within each group so the Arabic carousel still rotates
    // per session.
    const all = getFullRecordingReciters();
    const arabic = all.filter(r => !r.translation);
    const translations = all.filter(r => !!r.translation);
    return [
      ...seededShuffle(arabic, sessionSeed + 12),
      ...seededShuffle(translations, sessionSeed + 13),
    ];
  }, [sessionSeed]);

  // Sprint 14 — Sprint-13's `exploreSurahs` row is removed; the Surahs
  // tile in `ListenTabTopGrid` (Sprint 19 V1) is its replacement entry
  // point.

  // Sprint 8 — feedback-driven home rows.
  // Country + translation row data is computed once per session (cheap, no
  // network); `branding.homeRowConfig` decides if each row shows. Most-played
  // is hooked from MMKV daily aggregates and recomputes on listening events.
  const countries = useMemo(() => getAllCountries(), []);
  const translations = useMemo(() => getAllTranslations(), []);
  const mostPlayedReciters = useMostPlayedReciters({windowDays: 30, limit: 10});
  // Qariah (Sprint 48): no fetch while the trending row is off.
  const {reciters: trendingReciters} = useTrendingReciters({
    limit: 10,
    enabled: TRENDING_ROW_ENABLED,
  });

  // Handler for country card press — routes to the existing reciter browse
  // screen with a `country` param. The browse screen accepts arbitrary
  // params and ignores unknown ones, so this degrades to "no filter" if
  // the screen hasn't been updated yet.
  const handleCountryPress = useCallback(
    (country: CountryInfo) => {
      router.push({
        pathname: '/(tabs)/(a.home)/reciter/browse',
        params: {country: country.id, countryName: country.name},
      });
    },
    [router],
  );

  // Handler for translation card press (Sprint 15 S15.5). Routes to the
  // same reciter-browse screen as country/rewaya, filtered by
  // `Reciter.translation`. Mirrors `handleCountryPress` shape.
  const handleTranslationPress = useCallback(
    (translation: TranslationInfo) => {
      router.push({
        pathname: '/(tabs)/(a.home)/reciter/browse',
        params: {
          translation: translation.id,
          translationName: translation.name,
        },
      });
    },
    [router],
  );

  // Handler for rewayat card press
  const handleRewayatPress = (rewayat: RewayatInfo) => {
    router.push({
      pathname: '/(tabs)/(a.home)/reciter/browse',
      params: {
        teacher: rewayat.teacher,
        student: rewayat.student,
        rewayatName: rewayat.displayName,
      },
    });
  };

  // Handler for playlist card press
  const handlePlaylistPress = (playlist: UserPlaylist) => {
    router.push({
      pathname: '/(tabs)/(a.home)/playlist/[id]',
      params: {id: playlist.id},
    });
  };

  const handleClearRecentTracks = useCallback(() => {
    useRecentlyPlayedStore.getState().clearRecentTracks();
  }, []);

  const showNewToQuran = shouldShowNewToQuran();

  // Adhkar data for the section at the bottom
  const mainSuperCategories = useAdhkarStore(
    state => state.mainSuperCategories,
  );
  const adhkarLoaded = useAdhkarStore(state => state.superCategoriesLoaded);

  // Interleave adhkar categories for consistent display order
  const adhkarCategories = useMemo(() => {
    const left = mainSuperCategories
      .filter(c => c.column === 'left')
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const right = mainSuperCategories
      .filter(c => c.column === 'right')
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const result: SuperCategory[] = [];
    const maxLen = Math.max(left.length, right.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < left.length) result.push(left[i]);
      if (i < right.length) result.push(right[i]);
    }
    return result;
  }, [mainSuperCategories]);

  /**
   * Pre-built JSX for each home row. Each value is `null` when the row's
   * data is empty (rows self-hide regardless of `enabled`). The render
   * order is determined by `branding.homeRowConfig` below, not by the
   * order of entries here.
   *
   * Pre-building (rather than factory functions) avoids
   * `react/no-unstable-nested-components`; runtime cost is identical to
   * inline conditional rendering (each branch's null-return is what
   * Bayaan already did with `{cond && <Section …/>}`).
   *
   * Sprint 15 — Row order + visibility driven entirely by
   * `branding.homeRowConfig` (XF-NNN RFC, upstream PR #260). Each row's
   * data-empty check stays inline; `enabled: false` rows are registered
   * but skipped at the `.filter()` step below. `enabled` is the only
   * switch: Sprint 45 (TECH_DEBT #230) removed the last `qariah*Row` flags.
   */
  const rowNodes: Record<HomeRowId, React.ReactNode> = {
    'continue-listening':
      validRecentTracks.length > 0 || showAdhkarTile ? (
        <Section
          title={t('home.continueListening')}
          data={validRecentTracks}
          variant="recent"
          onReciterPress={onReciterPress}
          onClear={handleClearRecentTracks}
          showAdhkarTile={showAdhkarTile}
          theme={theme}
        />
      ) : null,

    'new-to-quran':
      showNewToQuran && beginnerFriendlyReciters.length > 0 ? (
        <Section
          title={t('home.newToQuran')}
          data={beginnerFriendlyReciters}
          variant="default"
          onReciterPress={onReciterPress}
          theme={theme}
        />
      ) : null,

    favorites:
      favoriteRecitersSection.length > 0 ? (
        <Section
          title={t('home.yourFavorites')}
          data={favoriteRecitersSection}
          variant="circular"
          onReciterPress={onReciterPress}
          theme={theme}
        />
      ) : null,

    featured:
      featuredReciters.length > 0 ? (
        <Section
          title={t('home.featuredReciters')}
          data={featuredReciters}
          variant="default"
          onReciterPress={onReciterPress}
          theme={theme}
        />
      ) : null,

    adhkar:
      isFeatureEnabled('adhkar') &&
      adhkarLoaded &&
      adhkarCategories.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, {color: theme.colors.text}]}>
              {t('common:terms.adhkar')}
            </Text>
            <Pressable
              onPress={() => router.push('/(tabs)/(a.home)/adhkar')}
              hitSlop={8}>
              <Text
                style={[
                  styles.seeMoreButton,
                  {
                    color: Color(theme.colors.textSecondary)
                      .alpha(0.5)
                      .toString(),
                  },
                ]}>
                {t('home.seeMore')}
              </Text>
            </Pressable>
          </View>
          <FlatList
            data={adhkarCategories}
            renderItem={renderAdhkarItem}
            keyExtractor={adhkarKeyExtractor}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sectionContent}
          />
        </View>
      ) : null,

    'follow-along':
      followAlongReciters.length > 0 ? (
        <Section
          title={t('home.followAlong')}
          data={followAlongReciters}
          variant="default"
          onReciterPress={onReciterPress}
          theme={theme}
        />
      ) : null,

    playlists:
      playlists.length > 0 ? (
        <Section
          title={t('home.yourPlaylists')}
          data={seededShuffle(playlists, sessionSeed + 8).slice(0, 10)}
          variant="playlist"
          onReciterPress={onReciterPress}
          onPlaylistPress={handlePlaylistPress}
          theme={theme}
        />
      ) : null,

    exclusives:
      bayaanOriginalsReciters.length > 0 ? (
        <Section
          title={t('home.exclusives')}
          data={bayaanOriginalsReciters}
          variant="featured"
          onReciterPress={onReciterPress}
          theme={theme}
        />
      ) : null,

    tajweed:
      tajweedReciters.length > 0 ? (
        <Section
          title={t('home.bestForTajweed')}
          data={tajweedReciters}
          variant="default"
          onReciterPress={onReciterPress}
          theme={theme}
        />
      ) : null,

    memorization:
      memorizationReciters.length > 0 ? (
        <Section
          title={t('home.bestForMemorization')}
          data={memorizationReciters}
          variant="default"
          onReciterPress={onReciterPress}
          theme={theme}
        />
      ) : null,

    // Bayaan titles this row "Explore by Rewayah"; Qariah uses
    // "Browse by Rewaya" (no trailing h, "Browse" not "Explore" for
    // header consistency with Country / Translation / Surahs).
    // @ai Pass C: upstream's key is kept. The Qariah wording comes from the
    // override bundle (i18n/overrides/en.json "Browse by Rewaya"; the Arabic
    // in i18n/overrides/ar.json is qariah:homeRows.rewayat).
    rewayat:
      rewayatTypes.length > 0 ? (
        <Section
          title={t('home.exploreByRewayah')}
          data={rewayatTypes}
          variant="rewayat"
          onReciterPress={onReciterPress}
          onRewayatPress={handleRewayatPress}
          theme={theme}
        />
      ) : null,

    collection:
      collectionReciters.length > 0 ? (
        <Section
          title={t('home.fromYourCollection')}
          data={collectionReciters}
          variant="default"
          onReciterPress={onReciterPress}
          theme={theme}
        />
      ) : null,

    // ───── Qariah extensions (additive HomeRowIds) ─────
    country:
      countries.length > 0 ? (
        <Section
          title={t('qariah:homeRows.country')}
          data={countries}
          variant="country"
          onReciterPress={onReciterPress}
          onCountryPress={handleCountryPress}
          theme={theme}
        />
      ) : null,

    translations:
      translations.length > 0 ? (
        <Section
          title={t('qariah:homeRows.translation')}
          data={translations}
          variant="translation"
          onReciterPress={onReciterPress}
          onTranslationPress={handleTranslationPress}
          theme={theme}
        />
      ) : null,

    honored:
      honoredReciters.length > 0 ? (
        <Section
          title={t('qariah:homeRows.honored')}
          data={honoredReciters}
          variant="default"
          onReciterPress={onReciterPress}
          theme={theme}
        />
      ) : null,

    paradise:
      paradiseReciters.length > 0 ? (
        <Section
          title={t('qariah:homeRows.paradise')}
          data={paradiseReciters}
          variant="default"
          onReciterPress={onReciterPress}
          theme={theme}
        />
      ) : null,

    'newly-added':
      newlyAddedReciters.length > 0 ? (
        <Section
          title={t('qariah:homeRows.newlyAdded')}
          data={newlyAddedReciters}
          variant="default"
          onReciterPress={onReciterPress}
          theme={theme}
        />
      ) : null,

    // Qariah (Sprint 48): recitations, not reciters. The row renders nothing
    // when the catalog has no dated recitations, and recomputes on each
    // catalog refill (components/listen/NewlyAddedRecitationsRow.tsx).
    'newly-added-recitations': <NewlyAddedRecitationsRow />,

    'full-recording':
      fullRecordingReciters.length > 0 ? (
        <Section
          title={t('qariah:homeRows.fullQuran')}
          data={fullRecordingReciters}
          variant="default"
          onReciterPress={onReciterPress}
          theme={theme}
        />
      ) : null,

    trending:
      trendingReciters.length > 0 ? (
        <Section
          title={t('qariah:homeRows.trending')}
          data={trendingReciters}
          variant="default"
          onReciterPress={onReciterPress}
          theme={theme}
        />
      ) : null,

    'most-played':
      mostPlayedReciters.length > 0 ? (
        <Section
          title={t('qariah:homeRows.mostPlayed')}
          data={mostPlayedReciters}
          variant="default"
          onReciterPress={onReciterPress}
          theme={theme}
        />
      ) : null,
  };

  const homeRowConfig = branding.homeRowConfig ?? DEFAULT_HOME_ROW_CONFIG;

  // RFC-008 — Listen-tab top-region slot. Forks may replace the default
  // `RecitersHero` via `branding.listenTabTopComponent`; capitalised here
  // so it can be used as a JSX element. Qariah ships `ListenTabTopGrid`
  // here. Sprint 25 (S25.2) retired the Sprint-19 `qariahListenTabTopGrid`
  // flag in favor of this seam. `undefined` keeps Bayaan's hero.
  const ListenTabTopComponent = branding.listenTabTopComponent;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={
        USE_GLASS
          ? undefined
          : {paddingTop: insets.top, paddingBottom: bottomInset}
      }
      contentInsetAdjustmentBehavior={USE_GLASS ? 'automatic' : 'never'}
      showsVerticalScrollIndicator={false}
      removeClippedSubviews={true}>
      {/* RFC-008 — Listen-tab top region. Default is the unified
       * `RecitersHero`; forks may substitute their own via
       * `branding.listenTabTopComponent`. Qariah wraps in a marginBottom
       * View so the curated grid sits with consistent vertical rhythm
       * above the first row. */}
      {ListenTabTopComponent ? (
        <View style={{marginBottom: moderateScale(16)}}>
          <ListenTabTopComponent />
        </View>
      ) : (
        <RecitersHero />
      )}

      {homeRowConfig
        .filter(row => row.enabled)
        .map(row => (
          <React.Fragment key={row.id}>
            {rowNodes[row.id] ?? null}
          </React.Fragment>
        ))}
    </ScrollView>
  );
}
// @ai-end

// Module-level helpers to keep the renderItem/keyExtractor references
// stable across renders (avoids react/no-unstable-nested-components).
const renderAdhkarItem = ({item}: {item: SuperCategory}) => (
  <AdhkarBentoCard
    category={item}
    width={moderateScale(140)}
    height={moderateScale(100)}
  />
);

const adhkarKeyExtractor = (item: SuperCategory) => item.id;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    marginBottom: moderateScale(24),
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: moderateScale(16),
    marginBottom: moderateScale(16),
  },
  sectionTitle: {
    fontSize: moderateScale(18),
    fontFamily: 'Manrope-SemiBold',
  },
  clearButton: {
    fontSize: moderateScale(13),
    fontFamily: 'Manrope-Medium',
  },
  seeMoreButton: {
    fontSize: moderateScale(13),
    fontFamily: 'Manrope-Medium',
  },
  sectionContent: {
    paddingHorizontal: moderateScale(16),
    gap: moderateScale(8),
  },
});

export default React.memo(RecitersView, (prevProps, nextProps) => {
  return prevProps.onReciterPress === nextProps.onReciterPress;
});
