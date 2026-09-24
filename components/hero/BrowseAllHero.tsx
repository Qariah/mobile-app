import React, {useMemo, useEffect, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  InteractionManager,
} from 'react-native';
import {Image} from 'expo-image';
import {Link} from 'expo-router';
import {useTheme} from '@/hooks/useTheme';
import {moderateScale} from 'react-native-size-matters';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import Svg, {Path} from 'react-native-svg';
import {SESSION_SEED, pickHeroTheme} from '@/components/hero/heroThemes';
import {Theme} from '@/utils/themeUtils';
import Color from 'color';
import {RECITERS} from '@/data/reciterData';
import {isFeatureEnabled} from '@/config/featureFlags';

const TILE_COLORS = [
  '#fbbf24',
  '#ef4444',
  '#8b5cf6',
  '#34d399',
  '#38bdf8',
  '#ec4899',
  '#f97316',
  '#06b6d4',
  '#a78bfa',
  '#fb923c',
  '#4ade80',
  '#f472b6',
];

const TITLE_VARIANTS = [
  'Browse the Full Collection',
  'Explore Every Reciter',
  'Every Voice, One Place',
  'A World of Recitations',
  'All Reciters Await',
  'Every Reciter, One Tap',
];

const LABEL_VARIANTS = [
  'All Reciters',
  'Browse Voices',
  'Discover',
  'Full Library',
  'Explore',
  'Browse',
];

// Sprint 13 — height matched to the compact RandomRecitationHero (75pt)
const CARD_HEIGHT = moderateScale(75);
const TILE_SIZE = moderateScale(16);
const TILE_RADIUS = moderateScale(3);
const TILE_GAP = moderateScale(3);
const TILE_STEP = TILE_SIZE + TILE_GAP;

// Column configs — different speeds and start offsets for staggered drift
const COLUMN_CONFIGS = [
  {speed: 180000, startOffset: 0},
  {speed: 200000, startOffset: 30},
  {speed: 160000, startOffset: 60},
  {speed: 210000, startOffset: 15},
  {speed: 190000, startOffset: 45},
  {speed: 170000, startOffset: 70},
  {speed: 220000, startOffset: 25},
  {speed: 185000, startOffset: 55},
  {speed: 195000, startOffset: 10},
  {speed: 175000, startOffset: 40},
  {speed: 205000, startOffset: 65},
  {speed: 165000, startOffset: 20},
  {speed: 215000, startOffset: 50},
  {speed: 180000, startOffset: 35},
  {speed: 200000, startOffset: 5},
  {speed: 190000, startOffset: 60},
  {speed: 170000, startOffset: 22},
  {speed: 210000, startOffset: 48},
  {speed: 185000, startOffset: 12},
  {speed: 195000, startOffset: 58},
];

interface TileData {
  fill: string;
  opacity: number;
  imageUrl?: string;
}

// Generate tile colors/opacities for a single column
function generateColumnTiles(
  seed: number,
  colIndex: number,
  count: number,
  imageUrls?: string[],
): TileData[] {
  let s = seed + colIndex * 7919; // different seed per column
  function nextRand() {
    s = (s * 16807 + 11) % 2147483647;
    return (s & 0x7fffffff) / 2147483647;
  }
  const hasImages = imageUrls && imageUrls.length > 0;
  const tiles: TileData[] = [];
  for (let i = 0; i < count; i++) {
    // Deterministic image-index pattern: varies by row+col but reproducible
    const imageUrl = hasImages
      ? imageUrls![(i * 7 + colIndex * 3) % imageUrls!.length]
      : undefined;
    tiles.push({
      fill: TILE_COLORS[Math.floor(nextRand() * TILE_COLORS.length)],
      opacity: 0.15 + nextRand() * 0.25,
      imageUrl,
    });
  }
  return tiles;
}

// Animated column of tiles
const TileColumn = React.memo(
  ({
    colIndex,
    tileOpacity,
    tilesPerColumn,
    speed,
    startOffset,
    imageUrls,
  }: {
    colIndex: number;
    tileOpacity: number;
    tilesPerColumn: number;
    speed: number;
    startOffset: number;
    imageUrls?: string[];
  }) => {
    const scrollY = useSharedValue(startOffset);
    const mountedRef = useRef(true);

    // Generate tiles for this column (doubled for seamless loop)
    const tiles = useMemo(
      () =>
        generateColumnTiles(SESSION_SEED, colIndex, tilesPerColumn, imageUrls),
      [colIndex, tilesPerColumn, imageUrls],
    );

    const singleSetHeight = tilesPerColumn * TILE_STEP;

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [{translateY: -(scrollY.value % singleSetHeight)}],
    }));

    useEffect(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        if (!mountedRef.current) return;
        scrollY.value = startOffset;
        scrollY.value = withRepeat(
          withTiming(singleSetHeight + startOffset, {
            duration: speed,
            easing: Easing.linear,
          }),
          -1,
          false,
        );
      });

      return () => {
        mountedRef.current = false;
        cancelAnimation(scrollY);
        task.cancel();
      };
    }, [singleSetHeight, speed, startOffset, scrollY]);

    // Render doubled tiles for seamless wrap
    const allTiles = useMemo(() => [...tiles, ...tiles], [tiles]);

    return (
      <View style={columnStyles.wrapper}>
        <Animated.View style={animatedStyle}>
          {allTiles.map((tile, i) =>
            tile.imageUrl ? (
              <View
                key={i}
                style={[
                  columnStyles.tile,
                  {opacity: tile.opacity + tileOpacity},
                ]}>
                <Image
                  source={{uri: tile.imageUrl}}
                  style={columnStyles.tileImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={0}
                />
              </View>
            ) : (
              <View
                key={i}
                style={[
                  columnStyles.tile,
                  {
                    backgroundColor: Color(tile.fill)
                      .alpha(tile.opacity * tileOpacity)
                      .toString(),
                  },
                ]}
              />
            ),
          )}
        </Animated.View>
      </View>
    );
  },
);

TileColumn.displayName = 'TileColumn';

const columnStyles = StyleSheet.create({
  wrapper: {
    width: TILE_SIZE,
    overflow: 'hidden',
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: TILE_RADIUS,
    marginBottom: TILE_GAP,
    overflow: 'hidden',
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
});

interface BrowseAllHeroProps {
  style?: object;
}

export function BrowseAllHero({style}: BrowseAllHeroProps) {
  const {theme} = useTheme();
  const heroTheme = useMemo(() => pickHeroTheme(), []);
  const copyIndex = useMemo(
    () => Math.abs(SESSION_SEED) % TITLE_VARIANTS.length,
    [],
  );
  const title = TITLE_VARIANTS[copyIndex];
  const label = LABEL_VARIANTS[copyIndex];
  const isDark = theme.isDarkMode;

  const bg = isDark ? heroTheme.bg : heroTheme.bgLight;
  const labelColor = isDark ? heroTheme.accentDim : heroTheme.accentDark;
  const titleColor = isDark ? heroTheme.accentLight : heroTheme.accentDark;
  const chevronColor = isDark ? heroTheme.accent : heroTheme.accentDark;
  const tileOpacity = isDark ? 0.12 : 0.18;

  // How many tile rows fit in the card + extra for scroll buffer
  const tilesPerColumn = useMemo(
    () => Math.ceil(CARD_HEIGHT / TILE_STEP) + 4,
    [],
  );

  // How many columns fit in the card width — we'll use a generous count
  // and let flexbox + overflow handle the rest
  const columnCount = COLUMN_CONFIGS.length;

  // Sprint 13 — when the face-collage flag is on, pull reciter image URLs
  // from RECITERS. RECITERS is populated in-place by dataService on app
  // boot; if it's still empty (cold start before fetch), fall back to the
  // colored-tile mosaic for this render.
  const faceCollageEnabled = isFeatureEnabled('qariahReciterFaceCollage');
  const imageUrls = useMemo(() => {
    if (!faceCollageEnabled) return undefined;
    const urls = RECITERS.map(r => r.image_url).filter(
      (u): u is string => typeof u === 'string' && u.length > 0,
    );
    return urls.length > 0 ? urls : undefined;
  }, [faceCollageEnabled]);

  const scale = useSharedValue(1);
  const pressAnimStyle = useAnimatedStyle(() => ({
    transform: [{scale: scale.value}],
  }));
  const handlePressIn = () => {
    scale.value = withSpring(0.98, {damping: 20, stiffness: 400, mass: 0.5});
  };
  const handlePressOut = () => {
    scale.value = withSpring(1, {damping: 20, stiffness: 400, mass: 0.5});
  };

  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Animated.View style={[styles.container, pressAnimStyle, style]}>
      <Link href="/(tabs)/(a.home)/browse-all" asChild>
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={{flex: 1}}>
          {/* Solid background */}
          <View style={[StyleSheet.absoluteFill, {backgroundColor: bg[0]}]} />

          {/* Scrolling mosaic columns */}
          <View style={styles.tilesContainer}>
            {COLUMN_CONFIGS.slice(0, columnCount).map((config, i) => (
              <TileColumn
                key={i}
                colIndex={i}
                tileOpacity={tileOpacity}
                tilesPerColumn={tilesPerColumn}
                speed={config.speed}
                startOffset={config.startOffset}
                imageUrls={imageUrls}
              />
            ))}
          </View>

          {/* Sprint 13 follow-up — readability scrim. The face-collage mosaic
              has uneven brightness across ~63 reciter photos, so the title
              text loses contrast over light-toned tiles. A flat semi-opaque
              scrim between the mosaic and the content layer darkens the
              entire background uniformly when collage is on; the colored-
              tile fallback (already low-contrast by design) skips it. */}
          {imageUrls && (
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  // Dark mode: title is light text → dark scrim.
                  // Light mode: title is dark text → light scrim. Tuned high
                  // enough that the title clearly reads on every reciter
                  // face tile (each photo has different luminance) while
                  // leaving enough of the mosaic visible for the brand feel.
                  backgroundColor: isDark
                    ? 'rgba(0,0,0,0.60)'
                    : 'rgba(255,255,255,0.65)',
                },
              ]}
            />
          )}

          {/* Content */}
          <View style={styles.content}>
            <View style={styles.textContainer}>
              <Text style={[styles.label, {color: labelColor}]}>
                {label.toUpperCase()}
              </Text>
              <Text style={[styles.title, {color: titleColor}]}>{title}</Text>
            </View>
            <View style={styles.chevron}>
              <Svg
                width={moderateScale(16)}
                height={moderateScale(16)}
                viewBox="0 0 24 24">
                <Path
                  d="M9 6l6 6-6 6"
                  stroke={chevronColor}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
            </View>
          </View>
        </Pressable>
      </Link>
    </Animated.View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      height: CARD_HEIGHT,
      borderRadius: moderateScale(20),
      overflow: 'hidden',
    },
    tilesContainer: {
      ...StyleSheet.absoluteFill,
      flexDirection: 'row',
      gap: TILE_GAP,
      justifyContent: 'center',
      overflow: 'hidden',
    },
    content: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: moderateScale(14),
      paddingVertical: moderateScale(8),
    },
    textContainer: {
      flex: 1,
      justifyContent: 'center',
    },
    label: {
      fontFamily: 'Manrope-Bold',
      fontSize: moderateScale(9),
      letterSpacing: 0.5,
      marginBottom: moderateScale(2),
    },
    title: {
      fontFamily: 'Manrope-SemiBold',
      fontSize: moderateScale(13),
    },
    chevron: {
      marginLeft: moderateScale(8),
    },
  });
