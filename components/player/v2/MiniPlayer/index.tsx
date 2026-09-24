import React, {useCallback, useMemo, useRef} from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {useTheme} from '@/hooks/useTheme';
import {usePlayerActions} from '@/hooks/usePlayerActions';
import {usePlayerStore} from '@/services/player/store/playerStore';
import {expandPlayerSheet} from '@/services/player/sheetRef';
import {PlayIcon, PauseIcon} from '@/components/Icons';
import {LoadingIndicator} from '@/components/LoadingIndicator';
import {ReciterImage} from '@/components/ReciterImage';
import Color from 'color';

function MiniPlayerInner() {
  const {theme} = useTheme();
  const {play, pause, stop} = usePlayerActions();
  const playbackState = usePlayerStore(state => state.playback.state);
  const queueTracks = usePlayerStore(state => state.queue.tracks);
  const currentIndex = usePlayerStore(state => state.queue.currentIndex);
  const trackLoading = usePlayerStore(state => state.loading.trackLoading);
  const stateRestoring = usePlayerStore(state => state.loading.stateRestoring);
  const prevTrackIdRef = useRef<string | null>(null);

  const currentTrack = useMemo(
    () => queueTracks?.[currentIndex],
    [queueTracks, currentIndex],
  );

  const isLoadingNewTrack = useMemo(() => {
    const isTrackChanging = currentTrack?.id !== prevTrackIdRef.current;
    if (currentTrack?.id) {
      prevTrackIdRef.current = currentTrack.id;
    }
    return (trackLoading && isTrackChanging) || playbackState === 'buffering';
  }, [trackLoading, playbackState, currentTrack?.id]);

  const handlePlayPause = useCallback(async () => {
    if (playbackState === 'playing') {
      await pause();
    } else {
      await play();
    }
  }, [playbackState, pause, play]);

  const handlePress = useCallback(() => {
    expandPlayerSheet();
  }, []);

  const handleDismiss = useCallback(() => {
    stop();
  }, [stop]);

  if (stateRestoring || !currentTrack) return null;

  const textColor = theme.colors.text;

  return (
    // #179 / #401 a11y -- plain View row (not a grouping Pressable) so the
    // play/pause control and the x are INDIVIDUALLY focusable. A Pressable is
    // `accessible` by default, and on iOS an accessible container ABSORBS its
    // children into one composed label ("Ad-Dukhan, <reciter>, Close player")
    // -- which is why neither VoiceOver nor Maestro could reach the x on its
    // own. The expand action lives on the inner body only.
    <View style={styles.row} testID="mini-player-bar">
      <Pressable
        onPress={handlePress}
        style={styles.body}
        accessibilityRole="button"
        accessibilityLabel={`${currentTrack.title}, ${currentTrack.artist}`}
        accessibilityHint="Opens the full player"
        testID="mini-player-expand">
        <ReciterImage
          reciterName={currentTrack.reciterName}
          style={styles.artwork}
        />

        <View style={styles.trackInfo}>
          <Text style={[styles.title, {color: textColor}]} numberOfLines={1}>
            {currentTrack.title}
          </Text>
          <Text
            style={[
              styles.subtitle,
              {color: Color(textColor).alpha(0.5).toString()},
            ]}
            numberOfLines={1}>
            {currentTrack.artist}
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={handlePlayPause}
        style={styles.playButton}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={playbackState === 'playing' ? 'Pause' : 'Play'}
        accessibilityState={{busy: isLoadingNewTrack}}
        testID="mini-player-play-pause">
        {isLoadingNewTrack ? (
          <LoadingIndicator color={textColor} />
        ) : playbackState === 'playing' ? (
          <PauseIcon color={textColor} size={22} />
        ) : (
          <PlayIcon color={textColor} size={22} />
        )}
      </Pressable>

      <Pressable
        onPress={handleDismiss}
        style={styles.closeButton}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Close player"
        testID="mini-player-close">
        <Feather
          name="x"
          size={18}
          color={Color(textColor).alpha(0.5).toString()}
        />
      </Pressable>
    </View>
  );
}

export const MiniPlayer: React.FC = React.memo(MiniPlayerInner);

const styles = StyleSheet.create({
  row: {
    // #270 — symmetric horizontal insets (was 14) so the artwork and the
    // play/close cluster sit the same distance from each pill edge (the play
    // control read cramped against the right edge), even 12px rhythm between
    // every element, and balanced top/bottom padding (was 8/20) so the content
    // is vertically centred in the native BottomAccessory (see #421 below for
    // why the row must fill the accessory frame).
    // @ai #421 — fill the accessory height. The accessory does NOT size to
    // content: its content view is absoluteFill inside a native frame of a
    // fixed height (about 46pt on iOS 26.5), which is shorter than this row's
    // 60pt. Without flex: 1 the row sits at the top of that frame, so the
    // content reads low and the bottom of the artwork clips. With flex: 1 the
    // row takes the frame height, and the symmetric padding plus
    // alignItems: 'center' centre the content in it.
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 12,
  },
  // #401 — the expand target. It carries the artwork + the two text lines, so
  // it reproduces exactly the row spacing those elements had as direct
  // children of `row` (same 12px gap, same flex:1 growth): the bar looks
  // identical, it just gained its own accessibility element.
  body: {
    // #179 / #401 a11y -- the expand-to-full-player hit target (artwork +
    // track info). Preserves the artwork|trackInfo rhythm of the old grouping
    // row, so the layout is visually unchanged.
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  artwork: {
    width: 36,
    height: 36,
    borderRadius: 8,
    overflow: 'hidden',
    flexShrink: 0,
  },
  trackInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  title: {
    fontSize: 13,
    fontFamily: 'Manrope-SemiBold',
  },
  subtitle: {
    fontSize: 11,
    fontFamily: 'Manrope-Medium',
  },
  playButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  closeButton: {
    width: 32,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
