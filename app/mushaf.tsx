import React, {
  useEffect,
  useMemo,
  useCallback,
  useSyncExternalStore,
} from 'react';
import {View, ActivityIndicator, StyleSheet} from 'react-native';
import {Stack, useLocalSearchParams} from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import {useTheme} from '@/hooks/useTheme';
import {digitalKhattDataService} from '@/services/mushaf/DigitalKhattDataService';
import {useMushafVerseSelectionStore} from '@/store/mushafVerseSelectionStore';
import {mushafSessionStore} from '@/services/mushaf/MushafSessionStore';
import {useMushafPlayerStore} from '@/store/mushafPlayerStore';
import {mushafAudioService} from '@/services/audio/MushafAudioService';
import {SheetManager} from 'react-native-actions-sheet';
import {SURAHS} from '@/data/surahData';
import MushafViewer from '@/components/mushaf/main';
import {USE_GLASS} from '@/hooks/useGlassProps';
import {useContentReadyWatchdog} from '@/hooks/useContentReadyWatchdog';

export type MushafScreenParams = {
  surah?: string;
  page?: string;
  ayah?: string;
  /** '1' when this mount is the cold-start session-restore push (app/_layout
   *  prepare()). Marks the content-stall as the cold-start "won't open" variant. */
  restored?: string;
};

export default function MushafScreen() {
  const {surah, page, ayah, restored} =
    useLocalSearchParams<MushafScreenParams>();
  const {theme} = useTheme();

  // DigitalKhatt readiness must be REACTIVE. `initialized` is a plain property
  // with no subscription; the old comment here claimed it's "always true by the
  // time MushafScreen mounts" (DK ran as a blocking AppInitializer service).
  // That stopped being true at Sprint 30 (`deferMushafPreload`): DK now inits
  // NON-AWAITED off the splash path (app/_layout.tsx prepare()), so a cold-start
  // session-restore push to /mushaf can mount THIS screen before DK finishes —
  // and on a fresh update-install (DBs re-imported from assets = the slowest DK
  // path, e.g. the very first boot after downloading a new build) it reliably
  // loses that race. A non-reactive read then leaves the `!dkReady` spinner up
  // FOREVER because nothing re-renders when DK completes (the iOS SDK-56 "white
  // screen + spinner + back button on first boot" report). Subscribe to the
  // service's cacheVersion — bumped in _doInit() right after `_initialized`
  // flips true — so this screen re-renders the instant DK becomes ready.
  useSyncExternalStore(
    digitalKhattDataService.subscribeCacheChanges,
    digitalKhattDataService.getCacheVersion,
  );
  const dkReady = digitalKhattDataService.initialized;
  const surahStartPages = dkReady
    ? digitalKhattDataService.getSurahStartPages()
    : {};

  // Defensive: if DK isn't ready at mount (deferred preload still in flight, or
  // it lost/failed the race above), kick initialize() so this screen drives its
  // own readiness instead of depending solely on the fire-and-forget boot
  // preload. initialize() is idempotent (guards on _initialized / _initializing),
  // so this is a no-op when the preload already ran or is in progress.
  useEffect(() => {
    if (!digitalKhattDataService.initialized) {
      void digitalKhattDataService.initialize();
    }
  }, []);

  // Resolve page number from params
  const pageNumber = useMemo(() => {
    if (page) {
      const p = parseInt(page, 10);
      if (!isNaN(p) && p >= 1 && p <= 604) return p;
    }
    if (surah) {
      const s = parseInt(surah, 10);
      if (!isNaN(s) && surahStartPages[s]) return surahStartPages[s];
    }
    return 1;
  }, [page, surah, surahStartPages]);

  // Build initial verse key for highlight
  const initialVerseKey = useMemo(() => {
    if (surah && ayah) return `${surah}:${ayah}`;
    return undefined;
  }, [surah, ayah]);

  // Allow landscape while the mushaf screen is open; re-lock portrait on exit.
  // QARIAHV2-C (#54) — both calls guarded: the unmount-time re-lock especially
  // races OEM Activity teardown (Samsung kills the Activity during playback →
  // cleanup runs → ExpoScreenOrientation rejects with "current activity is no
  // longer available"). Benign — there is nothing to orient anymore.
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {
      /* Activity may be gone (OEM-killed); benign, swallow it. */
    });
    return () => {
      ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      ).catch(() => {
        /* Activity may be gone (OEM-killed); benign, swallow it. */
      });
    };
  }, []);

  // Track mushaf screen for session restore (MMKV — sync writes survive force-kill)
  useEffect(() => {
    mushafSessionStore.setLastScreenWasMushaf(true);
    return () => {
      mushafSessionStore.setLastScreenWasMushaf(false);
      // Reset UI state in store when leaving mushaf
      useMushafPlayerStore.setState({
        isImmersive: false,
        isSearchMode: false,
      });
    };
  }, []);

  // Set verse highlight on mount, auto-clear after 3s, clear on unmount
  useEffect(() => {
    if (initialVerseKey) {
      useMushafVerseSelectionStore
        .getState()
        .selectVerse(initialVerseKey, pageNumber);
      const timer = setTimeout(() => {
        useMushafVerseSelectionStore.getState().clearSelection();
      }, 3000);
      return () => {
        clearTimeout(timer);
        useMushafVerseSelectionStore.getState().clearSelection();
      };
    }
    return () => {
      useMushafVerseSelectionStore.getState().clearSelection();
    };
  }, [initialVerseKey, pageNumber]);

  // @ai REPORT-ONLY content-stall watchdog (the post-boot "spinner forever"
  // class). The `!dkReady` spinner below is exactly what an iOS tester saw stuck
  // for ~7 min on a cold-start restore — DigitalKhatt init never resolved, yet
  // boot + splash had already reported success so nothing else was blind to it.
  // Fires `screen-content-stalled` after the budget if dkReady never flips, and
  // a companion success when it does. Telemetry only; does not touch the gate.
  useContentReadyWatchdog({
    screen: 'mushaf',
    ready: dkReady,
    awaiting: 'digital-khatt-init',
    cold: restored === '1',
  });

  if (!dkReady) {
    return (
      <View
        style={[styles.loading, {backgroundColor: theme.colors.background}]}>
        <ActivityIndicator size="large" color={theme.colors.text} />
      </View>
    );
  }

  return (
    <View
      style={[styles.container, {backgroundColor: theme.colors.background}]}>
      {USE_GLASS && <MushafToolbar />}
      <MushafViewer pageNumber={pageNumber} initialVerseKey={initialVerseKey} />
    </View>
  );
}

// ============================================================================
// iOS Native Toolbar (Stack.Toolbar)
// ============================================================================

function MushafToolbar() {
  const playbackState = useMushafPlayerStore(s => s.playbackState);
  const currentPage = useMushafPlayerStore(s => s.currentPage);
  const currentSurah = useMushafPlayerStore(s => s.currentSurah);
  const currentAyah = useMushafPlayerStore(s => s.currentAyah);
  const isImmersive = useMushafPlayerStore(s => s.isImmersive);
  const isSearchMode = useMushafPlayerStore(s => s.isSearchMode);

  const isIdle = playbackState === 'idle';
  const isPlaying = playbackState === 'playing';
  const isLoading = playbackState === 'loading';

  const surahName =
    currentSurah >= 1 && currentSurah <= 114
      ? SURAHS[currentSurah - 1].name
      : '';
  const verseLabel =
    !isIdle && surahName ? `${surahName} ${currentSurah}:${currentAyah}` : '';

  const handlePlay = useCallback(() => {
    const page = useMushafPlayerStore.getState().currentPage || 1;
    useMushafPlayerStore.setState({currentPage: page});
    SheetManager.show('mushaf-player-options', {
      payload: {currentPage: page},
    });
  }, []);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      mushafAudioService.pause();
      useMushafPlayerStore.getState().setPlaybackState('paused');
    } else {
      mushafAudioService.play();
      useMushafPlayerStore.getState().setPlaybackState('playing');
    }
  }, [isPlaying]);

  const handleStop = useCallback(() => {
    useMushafPlayerStore.getState().stop();
  }, []);

  const handlePrev = useCallback(() => {
    mushafAudioService.seekToPreviousAyah();
  }, []);

  const handleNext = useCallback(() => {
    mushafAudioService.seekToNextAyah();
  }, []);

  const handleOptions = useCallback(() => {
    const page = useMushafPlayerStore.getState().currentPage || 1;
    SheetManager.show('mushaf-player-options', {
      payload: {currentPage: page},
    });
  }, []);

  const handleSearch = useCallback(() => {
    useMushafPlayerStore.setState({isSearchMode: true});
  }, []);

  // Hide toolbar in immersive or search mode
  if (isImmersive || isSearchMode) return null;

  if (isIdle) {
    // Idle: [Search] — spacer — [Play] — spacer — [Options]
    return (
      <Stack.Toolbar>
        <Stack.Toolbar.Button icon="magnifyingglass" onPress={handleSearch}>
          Search
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.Button icon="play.fill" onPress={handlePlay}>
          Play
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.Button icon="ellipsis.circle" onPress={handleOptions}>
          Options
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    );
  }

  // Active: [Stop] — spacer — [Prev] [Play/Pause] [Next] — spacer — [Options]
  return (
    <Stack.Toolbar>
      <Stack.Toolbar.Button icon="stop.fill" onPress={handleStop}>
        Stop
      </Stack.Toolbar.Button>
      <Stack.Toolbar.Spacer />
      <Stack.Toolbar.Button icon="backward.end.fill" onPress={handlePrev} />
      <Stack.Toolbar.Button
        icon={isPlaying ? 'pause.fill' : 'play.fill'}
        onPress={handlePlayPause}
        disabled={isLoading}>
        {verseLabel}
      </Stack.Toolbar.Button>
      <Stack.Toolbar.Button icon="forward.end.fill" onPress={handleNext} />
      <Stack.Toolbar.Spacer />
      <Stack.Toolbar.Button icon="ellipsis.circle" onPress={handleOptions}>
        Options
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
