/**
 * Sprint 19 — Listen-tab top "Browse by" card (Qariah-only).
 *
 * Replaces Sprint 14's 3-tile pill layout (Reciter + Surah stacked on the
 * left, tall Shuffle pill on the right) with a single "Browse by" card
 * that hosts 3 equal-width tiles in a row:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ START LISTENING                              │
 *   │ Browse by                                    │
 *   │ ┌────────┐ ┌────────┐ ┌────────┐             │
 *   │ │ Reciters│ │ Surahs │ │ Shuffle │           │
 *   │ └────────┘ └────────┘ └────────┘             │
 *   └──────────────────────────────────────────────┘
 *
 * Each tile is a white rounded card with a centered Feather glyph + label:
 *   • Reciters → /(tabs)/(a.home)/browse-all
 *   • Surahs   → /(tabs)/(a.home)/browse-all-surahs
 *   • Shuffle  → inlined random-recitation handler (mirrors
 *               `RandomRecitationHero.handleRandomPlay`; Bayaan upstream's
 *               file is untouched).
 *
 * Qariah sets it as `branding.listenTabTopComponent` (RFC-008). Without that
 * field, `RecitersView` falls through to the upstream `RecitersHero`.
 */

import React, {useCallback, useMemo} from 'react';
import {View, Text, StyleSheet, Pressable} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {Link} from 'expo-router';
import {moderateScale} from '@/utils/scale';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import {useTheme} from '@/hooks/useTheme';
import {useResponsive} from '@/hooks/useResponsive';
import {pageSpacing} from '@/utils/gridLayout';
import {RECITERS} from '@/data/reciterData';
import {useRecitersVersion} from '@/hooks/useRecitersVersion';
import {SURAHS} from '@/data/surahData';
import {usePlayerActions} from '@/hooks/usePlayerActions';
import {createTracksForReciter} from '@/utils/track';
import {pickRandomRecitations} from '@/utils/randomRecitation';
import {useRecentlyPlayedStore} from '@/services/player/store/recentlyPlayedStore';
import {Theme} from '@/utils/themeUtils';
import {
  SurahGradientMesh,
  MESH_PALETTES,
} from '@/components/hero/SurahGradientMesh';
import {withoutShadowInLite} from '@/services/lite/liteMode';
import {SESSION_SEED, pickHeroTheme} from '@/components/hero/heroThemes';
import {useTranslation} from 'react-i18next';
import {getReciterDisplayName, getSurahDisplayName} from '@/i18n/format';
import {latinLetterSpacing} from '@/utils/rtl';
import {showToast} from '@/utils/toastUtils'; // @ai TECH_DEBT #220: the cross-platform toast (burnt)

const RECITERS_ACCENT = '#2f5059'; // Sage/Teal — Qariah brand
const SURAHS_ACCENT = '#5645a1'; // lightColors.accent (purple)
const SHUFFLE_ACCENT = '#c97a3b'; // warm amber

// @ai-start Sprint 52 Task 2: iPad. From this window width the title block and
// the three tiles share one row (upstream's 900 pt window class; the mock).
const WIDE_WINDOW_MIN_WIDTH = 900;
const TITLE_BLOCK_SHARE = '20%';
// @ai-end

interface TileProps {
  iconName: React.ComponentProps<typeof Feather>['name'];
  iconColor: string;
  label: string;
  /** One caption line under the label (iPad row layout). */
  caption?: string;
  onPress?: () => void;
  href?: string;
}

function Tile({iconName, iconColor, label, caption, onPress, href}: TileProps) {
  const {theme} = useTheme();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{scale: scale.value}],
  }));
  const handlePressIn = () => {
    scale.value = withSpring(0.97, {damping: 20, stiffness: 400, mass: 0.5});
  };
  const handlePressOut = () => {
    scale.value = withSpring(1, {damping: 20, stiffness: 400, mass: 0.5});
  };
  const styles = useMemo(() => createTileStyles(theme), [theme]);

  const inner = (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      // An expo-router `Link asChild` (Slot) rejects an array style (SDK 58),
      // so flatten it. @ai
      style={
        caption
          ? StyleSheet.flatten([styles.pressable, styles.pressableWide])
          : styles.pressable
      }
      accessibilityRole="button"
      accessibilityLabel={caption ? `${label}, ${caption}` : label}>
      <View style={styles.iconWrap}>
        <Feather name={iconName} size={moderateScale(26)} color={iconColor} />
      </View>
      {/* @ai-start Sprint 52 Task 2: iPad caption, one line. */}
      <View style={caption ? styles.textColumn : undefined}>
        <Text style={styles.label} numberOfLines={caption ? 1 : undefined}>
          {label}
        </Text>
        {caption ? (
          <Text style={styles.caption} numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
      {/* @ai-end */}
    </Pressable>
  );

  return (
    <Animated.View style={[styles.tile, animatedStyle]}>
      {href ? (
        <Link href={href} asChild>
          {inner}
        </Link>
      ) : (
        inner
      )}
    </Animated.View>
  );
}

export function ListenTabTopGrid() {
  const {theme} = useTheme();
  const {t} = useTranslation(['qariah', 'home']);
  const {updateQueue, play} = usePlayerActions();
  const startNewChain = useRecentlyPlayedStore(s => s.startNewChain);
  const styles = useMemo(() => createStyles(theme), [theme]);

  // @ai-start Sprint 52 Task 2: the row layout follows upstream's 900 pt
  // window class on iPad (no measure, so no first-frame jump). Phones: never.
  const {isTablet, width: windowWidth} = useResponsive();
  const wide = isTablet && windowWidth >= WIDE_WINDOW_MIN_WIDTH;
  const tileGap = wide ? pageSpacing(windowWidth).gap : undefined;
  const recitersVersion = useRecitersVersion();
  const reciterCount = useMemo(
    () => RECITERS.length,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recitersVersion is the refill signal of RECITERS
    [recitersVersion],
  );
  // @ai-end

  // Sprint 21 round-4 — apply the Continue-Reading mesh treatment to
  // the "Browse by" hero. Session-seeded so the palette cycles across
  // app launches but stays stable for a single session (matches
  // SurahsHero behavior).
  const heroPalette = useMemo(
    () => MESH_PALETTES[Math.abs(SESSION_SEED) % MESH_PALETTES.length],
    [],
  );

  // Sprint 21 round-5.3 — match the Mushaf-tab Continue-Reading visual
  // density. SurahsHero layers a SOLID colored base under the mesh
  // (`baseBg = heroTheme.bg[0] | bgLight[0]`); without that, the mesh
  // blobs are barely visible against the neutral `backgroundSecondary`
  // card color. Round-4 shipped only the mesh; this round adds the
  // colored underlay so both surfaces read with the same intensity.
  const heroTheme = useMemo(() => pickHeroTheme(), []);
  const baseBg = theme.isDarkMode ? heroTheme.bg[0] : heroTheme.bgLight[0];

  // Shuffle handler — inlines the same logic as
  // RandomRecitationHero.handleRandomPlay so upstream Bayaan's file stays
  // untouched. If Bayaan ever adopts a shared `useRandomRecitation` hook,
  // this collapses to a one-line call.
  // @ai-start TECH_DEBT #220: one cross-platform toast says what started, on iOS too.
  // The pick is synchronous, so the old "Finding…" toast never covered a wait:
  // on Android it only delayed this message, and on iOS two toasts would overlap.
  const handleShuffle = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const picks = pickRandomRecitations(15);
      if (picks.length === 0) {
        showToast(t('home:randomHero.findFailed'), undefined, 'error');
        return;
      }

      const {reciter, surah, rewayatId} = picks[0];
      showToast(
        t('home:randomHero.playing', {
          surah: getSurahDisplayName(surah),
          reciter: getReciterDisplayName(reciter),
        }),
      );

      const trackBatches = await Promise.all(
        picks.map(item =>
          createTracksForReciter(item.reciter, [item.surah], item.rewayatId),
        ),
      );
      const tracks = trackBatches.flat();
      await updateQueue(tracks, 0);
      await play();

      await startNewChain(reciter, surah, 0, 0, rewayatId);
    } catch (error) {
      console.error('Error playing random recitation:', error);
      showToast(t('home:randomHero.playFailed'), undefined, 'error');
    }
  }, [updateQueue, play, startNewChain, t]);
  // @ai-end

  return (
    <View accessible={false} testID="listen-top-pane">
      <View
        style={[styles.card, wide && styles.cardWide]}
        accessible={false}
        testID="listen-top-card">
        {/* Sprint 21 round-5.3 — colored base layer under the mesh, matching
          the Mushaf-tab Continue-Reading hero. Without this the mesh
          radial-gradients sit on a neutral card and read too washed-out. */}
        <View style={[StyleSheet.absoluteFill, {backgroundColor: baseBg}]} />
        <SurahGradientMesh
          palette={heroPalette}
          isDark={theme.isDarkMode}
          viewBoxWidth={400}
          viewBoxHeight={180}
        />
        <View
          style={wide ? styles.titleBlockWide : undefined}
          testID="listen-top-title-block">
          <Text style={styles.eyebrow} numberOfLines={wide ? 1 : undefined}>
            {t('qariah:listenTop.eyebrow')}
          </Text>
          <Text style={styles.title}>{t('qariah:listenTop.title')}</Text>
        </View>
        <View
          style={[
            styles.tiles,
            tileGap !== undefined && {gap: tileGap},
            wide && styles.tilesWide,
          ]}
          accessible={false}
          testID="listen-top-tiles">
          <Tile
            iconName="user"
            iconColor={RECITERS_ACCENT}
            label={t('qariah:listenTop.reciters')}
            caption={
              wide
                ? t('qariah:listenTop.reciterCount', {count: reciterCount})
                : undefined
            }
            href="/(tabs)/(a.home)/browse-all"
          />
          <Tile
            iconName="book-open"
            iconColor={SURAHS_ACCENT}
            label={t('qariah:listenTop.surahs')}
            caption={
              wide
                ? t('qariah:listenTop.surahCount', {count: SURAHS.length})
                : undefined
            }
            href="/(tabs)/(a.home)/browse-all-surahs"
          />
          <Tile
            iconName="shuffle"
            iconColor={SHUFFLE_ACCENT}
            label={t('qariah:listenTop.shuffle')}
            caption={wide ? t('qariah:listenTop.shuffleCaption') : undefined}
            onPress={handleShuffle}
          />
        </View>
      </View>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      // @ai Task 2: marginHorizontal stays at the row inset (16) on iPad too,
      // so the card lines up with the shelf titles below it.
      marginHorizontal: moderateScale(16),
      paddingHorizontal: moderateScale(14),
      paddingTop: moderateScale(16),
      paddingBottom: moderateScale(14),
      backgroundColor: theme.colors.backgroundSecondary,
      borderRadius: moderateScale(22),
      // Round-4 — clip the SurahGradientMesh to the rounded card.
      overflow: 'hidden',
      // Space above the first Listen row (moved here from RecitersView).
      marginBottom: moderateScale(16),
    },
    eyebrow: {
      fontFamily: theme.fonts.bold,
      fontSize: moderateScale(11),
      letterSpacing: latinLetterSpacing(1.2),
      color: theme.colors.textSecondary,
      opacity: 0.65,
      marginHorizontal: moderateScale(4),
      marginBottom: moderateScale(4),
    },
    title: {
      fontFamily: theme.fonts.bold,
      fontSize: moderateScale(22),
      color: theme.colors.text,
      marginHorizontal: moderateScale(4),
      marginBottom: moderateScale(14),
      letterSpacing: latinLetterSpacing(-0.3),
    },
    tiles: {
      flexDirection: 'row',
      gap: moderateScale(10),
    },
    // @ai-start Sprint 52 Task 2: one row, title block on the leading 20%.
    cardWide: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    titleBlockWide: {
      marginEnd: moderateScale(12),
      width: TITLE_BLOCK_SHARE,
      justifyContent: 'center',
    },
    tilesWide: {
      flex: 1,
    },
    // @ai-end
  });

const createTileStyles = (theme: Theme) =>
  StyleSheet.create({
    // Lite mode: no shadow (planning/lite-mode-design.md).
    tile: withoutShadowInLite({
      flex: 1,
      backgroundColor: theme.isDarkMode ? theme.colors.light : '#ffffff',
      borderRadius: moderateScale(16),
      shadowColor: '#06151c',
      shadowOpacity: 0.05,
      shadowOffset: {width: 0, height: 2},
      shadowRadius: 6,
      elevation: 2,
    }),
    pressable: {
      paddingTop: moderateScale(18),
      paddingBottom: moderateScale(16),
      paddingHorizontal: moderateScale(8),
      alignItems: 'center',
      justifyContent: 'center',
      gap: moderateScale(10),
    },
    // @ai-start Sprint 52 Task 2: icon, then label and caption, in a row.
    pressableWide: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      paddingHorizontal: moderateScale(14),
      paddingVertical: moderateScale(18),
      minHeight: 44,
    },
    textColumn: {
      flex: 1,
    },
    caption: {
      fontFamily: theme.fonts.regular,
      fontSize: moderateScale(12),
      color: theme.colors.textSecondary,
    },
    // @ai-end
    iconWrap: {
      width: moderateScale(30),
      height: moderateScale(30),
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      fontFamily: theme.fonts.bold,
      fontSize: moderateScale(14),
      color: theme.colors.text,
      letterSpacing: latinLetterSpacing(-0.1),
    },
  });
