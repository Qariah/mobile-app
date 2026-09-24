import React, {useCallback, useMemo, useRef, useEffect, useState} from 'react';
import {
  StyleSheet,
  StatusBar,
  View,
  Platform,
  BackHandler,
  LayoutChangeEvent,
} from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetHandleProps,
} from '@gorhom/bottom-sheet';
import {usePlayerActions} from '@/hooks/usePlayerActions';
import {usePlayerStore} from '@/services/player/store/playerStore';
import {useTheme} from '@/hooks/useTheme';
import PlayerContent from './PlayerContent';
import TabletPlayer from './TabletPlayer';
import Color from 'color';
import {SURAHS} from '@/data/surahData';
import {useReciterNavigation} from '@/hooks/useReciterNavigation';
import {SheetManager} from 'react-native-actions-sheet';
import {useTimestampStore} from '@/store/timestampStore';
import {useRewayatFollowAlong} from '@/hooks/useFollowAlong';
import {usePlayingRewayahObserver} from '@/hooks/usePlayingRewayahObserver';
import {
  registerPlayerSheetRef,
  unregisterPlayerSheetRef,
} from '@/services/player/sheetRef';
import {useResponsive} from '@/hooks/useResponsive';
import {TabletPlayerReciterColumn} from '@/components/tablet/TabletPlayerReciterColumn';
import {TabletPlayerControlsColumn} from '@/components/tablet/TabletPlayerControlsColumn';
import {isFeatureEnabled} from '@/config/featureFlags';

export const PlayerSheet = () => {
  const {theme} = useTheme();
  const {isTablet, orientation} = useResponsive();
  const bottomSheetRef = useRef<BottomSheet>(null);
  const [remainingTime, setRemainingTime] = useState<number | null>(null);
  const [leftPaneWidth, setLeftPaneWidth] = useState<number | undefined>(
    undefined,
  );
  const [tabletShowQueue, setTabletShowQueue] = useState(false);
  const handleTabletQueueToggle = useCallback(
    () => setTabletShowQueue(v => !v),
    [],
  );
  const {navigateToReciterProfile} = useReciterNavigation();

  // Fires a "Now reading <rewayah>" toast whenever the currently-playing
  // track's resolved rewayah transitions. Mounted here (not deeper) so the
  // observation outlives the sheet's open/close cycles — the toast fires
  // on track changes regardless of whether the sheet is visible.
  usePlayingRewayahObserver();

  const {setSheetMode, setRate, updateSettings, setImmersive} =
    usePlayerActions();
  const queue = usePlayerStore(s => s.queue);
  const loading = usePlayerStore(s => s.loading);
  const sheetMode = usePlayerStore(s => s.sheetMode);
  const isImmersive = usePlayerStore(s => s.isImmersive);
  const playbackRate = usePlayerStore(s => s.playback.rate);
  const settings = usePlayerStore(s => s.settings);

  // Register ref so MiniPlayer/FloatingPlayer can call expand() directly
  useEffect(() => {
    registerPlayerSheetRef(bottomSheetRef);
    return () => unregisterPlayerSheetRef();
  }, []);

  // Handle Android hardware back button
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const handleBackPress = () => {
      if (sheetMode === 'full') {
        if (isImmersive) {
          setImmersive(false);
          return true;
        }
        setSheetMode('hidden');
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      handleBackPress,
    );

    return () => subscription.remove();
  }, [sheetMode, isImmersive, setSheetMode, setImmersive]);

  // Effect to handle sleep timer remaining time
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (settings.sleepTimerEnd) {
      interval = setInterval(() => {
        // Calculate remaining time based on the end timestamp
        const now = Date.now();
        const timeRemaining = settings.sleepTimerEnd
          ? settings.sleepTimerEnd - now
          : 0;

        if (timeRemaining > 0) {
          // For very short timers (less than 1 minute), display seconds
          if (timeRemaining < 60 * 1000) {
            const remainingSeconds = Math.ceil(timeRemaining / 1000);
            setRemainingTime(remainingSeconds / 60); // Convert to fractional minutes
          } else {
            const remainingMinutes = Math.ceil(timeRemaining / (60 * 1000));
            setRemainingTime(remainingMinutes);
          }
        } else {
          setRemainingTime(null);
        }
      }, 500); // Update more frequently for short timers
    } else {
      setRemainingTime(null);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [settings.sleepTimerEnd]);

  // Effect to handle sheet mode changes
  useEffect(() => {
    if (!bottomSheetRef.current) return;

    const sheet = bottomSheetRef.current;
    if (sheetMode === 'hidden') {
      setImmersive(false);
      sheet.close();
    } else if (sheetMode === 'full') {
      sheet.expand();
    }
  }, [sheetMode, setImmersive]);

  const currentTrack = queue?.tracks?.[queue?.currentIndex ?? -1];
  const shouldShow = !loading?.stateRestoring && !!currentTrack;

  const snapPoints = useMemo(() => ['100%'], []);

  const handleSheetChanges = useCallback(
    (index: number) => {
      const newMode = index === 0 ? 'full' : 'hidden';
      if (sheetMode !== newMode) {
        setSheetMode(newMode);
      }
    },
    [setSheetMode, sheetMode],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => {
      // Redmi play-freeze fix (sibling of the Body `sheetUntouchable` guard below).
      // gorhom's BottomSheetBackdrop MOUNTS with pointerEvents:'auto' and only flips
      // to 'none' via a reanimated `useAnimatedReaction` -> `runOnJS` -> `setState`
      // chain gated on its internal `animatedIndex` settling to disappearsOnIndex (-1).
      // On the slow Helio G85 the closed-sheet layout race delays that settle, so the
      // full-screen backdrop (opacity 0 but still hit-testable, wrapped in a Tap
      // GestureDetector) keeps eating EVERY touch while the sheet is logically hidden
      // -> the whole app goes unresponsive though audio + the JS thread keep running,
      // and only the hardware BACK key works. Don't render the backdrop at all unless
      // the sheet is the full player; keyed off the LOGICAL `sheetMode` so it is immune
      // to gorhom's racing internal `animatedIndex`. The Body `pointerEvents:'none'`
      // guard alone was INSUFFICIENT (build 1362 still froze) precisely because the
      // backdrop is a separate sibling view the Body style never reaches.
      if (sheetMode !== 'full') {
        return null;
      }
      return (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.5}
        />
      );
    },
    [sheetMode],
  );

  const handleSpeedChange = useCallback(
    (speed: number) => {
      setRate(speed);
    },
    [setRate],
  );

  const handleSleepTimerChange = useCallback(
    (minutes: number) => {
      updateSettings({sleepTimer: minutes});
    },
    [updateSettings],
  );

  const handleTurnOffTimer = useCallback(() => {
    updateSettings({sleepTimer: 0});
  }, [updateSettings]);

  const handleGoToReciter = useCallback(() => {
    if (!currentTrack?.reciterId) return;
    setSheetMode('hidden');
    // Small delay to ensure sheet is closing before navigation
    setTimeout(() => {
      navigateToReciterProfile(currentTrack.reciterId);
    }, 100);
  }, [currentTrack, setSheetMode, navigateToReciterProfile]);

  // Handlers for showing sheets via SheetManager
  const handleShowSpeedSheet = useCallback(() => {
    SheetManager.show('playback-speed', {
      payload: {
        currentSpeed: playbackRate,
        onSpeedChange: handleSpeedChange,
      },
    });
  }, [playbackRate, handleSpeedChange]);

  const handleShowSleepTimerSheet = useCallback(() => {
    SheetManager.show('sleep-timer', {
      payload: {
        sleepTimer: remainingTime || 0,
        remainingTime,
        onTimerChange: handleSleepTimerChange,
        onTurnOffTimer: handleTurnOffTimer,
      },
    });
  }, [remainingTime, handleSleepTimerChange, handleTurnOffTimer]);

  const handleShowMushafLayoutSheet = useCallback(() => {
    SheetManager.show('mushaf-layout', {payload: {context: 'player'}});
  }, []);

  const handleShowAmbientSheet = useCallback(() => {
    SheetManager.show('ambient-sounds');
  }, []);

  const followAlongAvailable = useRewayatFollowAlong(currentTrack?.rewayatId);

  const handleFollowAlongPress = useCallback(() => {
    if (!followAlongAvailable) {
      SheetManager.show('follow-along');
      return;
    }

    const state = useTimestampStore.getState();

    // If follow along is enabled but user scrolled away (not locked), re-lock
    if (state.followAlongEnabled && !state.isLocked) {
      state.setIsLocked(true);
      return;
    }

    // Otherwise toggle follow along on/off
    state.toggleFollowAlong();
    // When enabling, also lock
    if (!state.followAlongEnabled) {
      state.setIsLocked(true);
    }
  }, [followAlongAvailable]);

  const handleShowOptionsSheet = useCallback(() => {
    if (!currentTrack) return;

    const surahNumber = currentTrack.surahId
      ? parseInt(currentTrack.surahId, 10)
      : undefined;
    const currentSurahData = surahNumber
      ? SURAHS.find(s => s.id === surahNumber)
      : undefined;

    // Upload tracks — always show options
    if (currentTrack.isUserUpload) {
      SheetManager.show('player-options', {
        payload: {
          surah: currentSurahData,
          reciterId: currentTrack.reciterId || undefined,
          rewayatId: currentTrack.rewayatId,
          onGoToReciter: currentTrack.reciterId ? handleGoToReciter : undefined,
          isUserUpload: true,
          userRecitationId: currentTrack.userRecitationId,
        },
      });
      return;
    }

    // System tracks — existing behavior
    if (currentSurahData && currentTrack.reciterId) {
      SheetManager.show('player-options', {
        payload: {
          surah: currentSurahData,
          reciterId: currentTrack.reciterId,
          rewayatId: currentTrack.rewayatId,
          onGoToReciter: handleGoToReciter,
        },
      });
    }
  }, [currentTrack, handleGoToReciter]);

  const renderHandleComponent = useCallback(
    (_props: BottomSheetHandleProps) => <View />,
    [],
  );

  const handleLeftPaneLayout = useCallback((e: LayoutChangeEvent) => {
    setLeftPaneWidth(e.nativeEvent.layout.width);
  }, []);

  // Only render modals once settings are loaded to prevent hydration issues
  if (!shouldShow) {
    return null;
  }

  const textColor = Color(theme.colors.text);
  const isLightText = textColor.isLight();

  // Landscape keeps the reciter-list split (only when there's a reciter).
  // Portrait always splits on iPad: mushaf on the left, player controls on
  // the right (replacing the reciter list in portrait).
  const isTabletFull = isTablet && sheetMode === 'full';
  const landscapeSplit =
    isTabletFull && orientation === 'landscape' && !!currentTrack?.reciterId;
  const portraitSplit = isTabletFull && orientation === 'portrait';
  const showTabletSplit = landscapeSplit || portraitSplit;

  const playerContentEl = isTablet ? (
    <TabletPlayer
      measuredParentWidth={showTabletSplit ? leftPaneWidth : undefined}
      bodyOnly={portraitSplit}
      showQueue={portraitSplit ? tabletShowQueue : undefined}
      onQueueToggle={portraitSplit ? handleTabletQueueToggle : undefined}
      onSpeedPress={handleShowSpeedSheet}
      onSleepTimerPress={handleShowSleepTimerSheet}
      onMushafLayoutPress={handleShowMushafLayoutSheet}
      onAmbientPress={
        isFeatureEnabled('ambientAudioOverlay')
          ? handleShowAmbientSheet
          : undefined
      }
      onOptionsPress={handleShowOptionsSheet}
      onFollowAlongPress={handleFollowAlongPress}
    />
  ) : (
    <PlayerContent
      onSpeedPress={handleShowSpeedSheet}
      onSleepTimerPress={handleShowSleepTimerSheet}
      onMushafLayoutPress={handleShowMushafLayoutSheet}
      onAmbientPress={
        isFeatureEnabled('ambientAudioOverlay')
          ? handleShowAmbientSheet
          : undefined
      }
      onOptionsPress={handleShowOptionsSheet}
      onFollowAlongPress={handleFollowAlongPress}
    />
  );

  return (
    <>
      {sheetMode === 'full' && (
        <StatusBar
          barStyle={isLightText ? 'light-content' : 'dark-content'}
          hidden={isImmersive}
          animated
        />
      )}
      <BottomSheet
        ref={bottomSheetRef}
        snapPoints={snapPoints}
        onChange={handleSheetChanges}
        enablePanDownToClose
        enableDynamicSizing={false}
        backdropComponent={renderBackdrop}
        index={-1}
        animateOnMount={false}
        handleComponent={renderHandleComponent}
        enableContentPanningGesture
        enableOverDrag={false}
        style={[styles.sheet, sheetMode !== 'full' && styles.sheetUntouchable]}
        backgroundStyle={[styles.background, {backgroundColor: 'transparent'}]}>
        {/* Play-path UI-freeze fix (companion to the SurahItem selector narrowing —
            QARIAHV2-J / incident #184): only MOUNT the heavy Skia player content
            (PlayerContent → QuranView mushaf) when the sheet is actually expanded. On
            play the sheet stays at index={-1} and the mini-player renders via a SEPARATE
            component (tabs/_layout), so mounting the full mushaf behind a hidden sheet
            paid a Skia render/allocation cost on every play with nothing visible. Keyed
            off the LOGICAL `sheetMode` (immune to gorhom's internal position race — same
            signal `sheetUntouchable` uses). Audio + the mini-player live outside
            PlayerContent, so they are unaffected. */}
        {sheetMode !== 'full' ? null : showTabletSplit ? (
          <View style={styles.tabletSplitRoot}>
            <View
              style={styles.tabletSplitPlayerPane}
              onLayout={handleLeftPaneLayout}>
              {playerContentEl}
            </View>
            <View
              style={[
                styles.tabletSplitDivider,
                {
                  backgroundColor: Color(theme.colors.text)
                    .alpha(0.08)
                    .toString(),
                },
              ]}
            />
            <View style={styles.tabletSplitReciterPane}>
              {portraitSplit ? (
                <TabletPlayerControlsColumn
                  showQueue={tabletShowQueue}
                  onQueueToggle={handleTabletQueueToggle}
                  onSpeedPress={handleShowSpeedSheet}
                  onSleepTimerPress={handleShowSleepTimerSheet}
                  onMushafLayoutPress={handleShowMushafLayoutSheet}
                  onAmbientPress={
                    isFeatureEnabled('ambientAudioOverlay')
                      ? handleShowAmbientSheet
                      : undefined
                  }
                  onOptionsPress={handleShowOptionsSheet}
                  onFollowAlongPress={handleFollowAlongPress}
                />
              ) : (
                <TabletPlayerReciterColumn
                  reciterId={currentTrack!.reciterId!}
                  initialRewayatId={currentTrack!.rewayatId}
                />
              )}
            </View>
          </View>
        ) : (
          playerContentEl
        )}
      </BottomSheet>
    </>
  );
};

const styles = StyleSheet.create({
  sheet: {
    zIndex: 2000,
    elevation: 20,
  },
  // Redmi play-time UI-freeze ROOT FIX (H3 touch-capturing overlay). gorhom applies
  // the `style` above to its BottomSheetBody (an Animated.View), so the elevation:20
  // lives there. On a slow CPU the *closed* sheet's container-height measurement can
  // race the mount, leaving that empty full-screen Body sitting over the app — and
  // because it's elevated, it swallows EVERY touch while the app renders underneath
  // (JS thread alive + heartbeat ticking, audio plays on its native thread, only the
  // hardware BACK key works). Confirmed on the tester's Redmi Note 9 via UI Inspector:
  // taps over the app's buttons resolved to MIUI launcher nodes, nothing clickable.
  // pointerEvents:'none' removes the Body from hit-testing whenever the sheet is not
  // the full player, so a mis-positioned *closed* sheet can never capture touches.
  // Keyed off the LOGICAL sheetMode → correct even when gorhom's internal position is
  // wrong. The mini-player is a separate component (tabs/_layout), unaffected.
  // Inherited from Bayaan (#26) → upstream candidate. See
  // planning/redmi-play-freeze-investigation.md.
  sheetUntouchable: {
    pointerEvents: 'none',
  },
  background: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  tabletSplitRoot: {
    flex: 1,
    flexDirection: 'row',
    minHeight: '100%',
  },
  tabletSplitPlayerPane: {
    flex: 11,
    minWidth: 0,
  },
  tabletSplitDivider: {
    width: StyleSheet.hairlineWidth,
  },
  tabletSplitReciterPane: {
    flex: 9,
    minWidth: 0,
    maxWidth: 560,
  },
});
