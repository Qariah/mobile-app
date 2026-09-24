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
 * Rolled back (entirely) by setting `qariahListenTabTopGrid: false` —
 * `RecitersView` falls through to the upstream `RecitersHero`.
 */

import React, {useCallback, useMemo} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ToastAndroid,
  Platform,
} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {Link} from 'expo-router';
import {moderateScale} from 'react-native-size-matters';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import {useTheme} from '@/hooks/useTheme';
import {usePlayerActions} from '@/hooks/usePlayerActions';
import {createTracksForReciter} from '@/utils/track';
import {getMultipleRandomTracks} from '@/utils/randomRecitation';
import {useRecentlyPlayedStore} from '@/services/player/store/recentlyPlayedStore';
import {Theme} from '@/utils/themeUtils';
import {
  SurahGradientMesh,
  MESH_PALETTES,
} from '@/components/hero/SurahGradientMesh';
import {SESSION_SEED, pickHeroTheme} from '@/components/hero/heroThemes';

const RECITERS_ACCENT = '#2f5059'; // Sage/Teal — Qariah brand
const SURAHS_ACCENT = '#5645a1'; // lightColors.accent (purple)
const SHUFFLE_ACCENT = '#c97a3b'; // warm amber

function showToast(message: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
}

interface TileProps {
  iconName: React.ComponentProps<typeof Feather>['name'];
  iconColor: string;
  label: string;
  onPress?: () => void;
  href?: string;
}

function Tile({iconName, iconColor, label, onPress, href}: TileProps) {
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
      style={styles.pressable}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <View style={styles.iconWrap}>
        <Feather name={iconName} size={moderateScale(26)} color={iconColor} />
      </View>
      <Text style={styles.label}>{label}</Text>
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
  const {updateQueue, play} = usePlayerActions();
  const startNewChain = useRecentlyPlayedStore(s => s.startNewChain);
  const styles = useMemo(() => createStyles(theme), [theme]);

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
  const handleShuffle = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      showToast('Finding random recitations from different reciters...');

      const randomTracks = await getMultipleRandomTracks(15, false);
      if (randomTracks.length === 0) {
        showToast('Failed to find random recitations. Please try again.');
        return;
      }

      const {reciter, surah} = randomTracks[0];
      showToast(`Playing ${surah.name} by ${reciter.name}`);

      const trackPromises = randomTracks.map(item => {
        const availableRewayat = item.reciter.rewayat.filter(r =>
          r.surah_list.includes(item.surah.id),
        );
        const rewayahToUse =
          availableRewayat.length > 0
            ? availableRewayat[
                Math.floor(Math.random() * availableRewayat.length)
              ]
            : item.reciter.rewayat.reduce(
                (prev, current) =>
                  current.surah_total > prev.surah_total ? current : prev,
                item.reciter.rewayat[0],
              );
        return createTracksForReciter(
          item.reciter,
          [item.surah],
          rewayahToUse.id,
        );
      });

      const trackBatches = await Promise.all(trackPromises);
      const tracks = trackBatches.flat();
      await updateQueue(tracks, 0);
      await play();

      const firstRewayah =
        randomTracks[0].reciter.rewayat.filter(r =>
          r.surah_list.includes(randomTracks[0].surah.id),
        )[0] || randomTracks[0].reciter.rewayat[0];
      await startNewChain(reciter, surah, 0, 0, firstRewayah.id);
    } catch (error) {
      console.error('Error playing random recitation:', error);
      showToast('Failed to play random recitation. Please try again.');
    }
  }, [updateQueue, play, startNewChain]);

  return (
    <View style={styles.card}>
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
      <Text style={styles.eyebrow}>START LISTENING</Text>
      <Text style={styles.title}>Browse by</Text>
      <View style={styles.tiles}>
        <Tile
          iconName="user"
          iconColor={RECITERS_ACCENT}
          label="Reciters"
          href="/(tabs)/(a.home)/browse-all"
        />
        <Tile
          iconName="book-open"
          iconColor={SURAHS_ACCENT}
          label="Surahs"
          href="/(tabs)/(a.home)/browse-all-surahs"
        />
        <Tile
          iconName="shuffle"
          iconColor={SHUFFLE_ACCENT}
          label="Shuffle"
          onPress={handleShuffle}
        />
      </View>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      marginHorizontal: moderateScale(16),
      paddingHorizontal: moderateScale(14),
      paddingTop: moderateScale(16),
      paddingBottom: moderateScale(14),
      backgroundColor: theme.colors.backgroundSecondary,
      borderRadius: moderateScale(22),
      // Round-4 — clip the SurahGradientMesh to the rounded card.
      overflow: 'hidden',
    },
    eyebrow: {
      fontFamily: theme.fonts.bold,
      fontSize: moderateScale(11),
      letterSpacing: 1.2,
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
      letterSpacing: -0.3,
    },
    tiles: {
      flexDirection: 'row',
      gap: moderateScale(10),
    },
  });

const createTileStyles = (theme: Theme) =>
  StyleSheet.create({
    tile: {
      flex: 1,
      backgroundColor: theme.isDarkMode ? theme.colors.light : '#ffffff',
      borderRadius: moderateScale(16),
      shadowColor: '#06151c',
      shadowOpacity: 0.05,
      shadowOffset: {width: 0, height: 2},
      shadowRadius: 6,
      elevation: 2,
    },
    pressable: {
      paddingTop: moderateScale(18),
      paddingBottom: moderateScale(16),
      paddingHorizontal: moderateScale(8),
      alignItems: 'center',
      justifyContent: 'center',
      gap: moderateScale(10),
    },
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
      letterSpacing: -0.1,
    },
  });
