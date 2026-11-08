import React, {
  useEffect,
  useMemo,
  useCallback,
  useRef, // @ai
  useState, // @ai
} from 'react';
import {
  View,
  StyleSheet,
  Pressable, // @ai
  Text, // @ai
} from 'react-native';
import {QariahMushafLoading} from '@/components/QariahMushafLoading'; // @ai Qariah
import {Stack, useLocalSearchParams, useRoute} from 'expo-router';
import {usePhoneOrientation} from '@/hooks/usePhoneOrientation'; // @ai
import {useTheme} from '@/hooks/useTheme';
import {digitalKhattDataService} from '@/services/mushaf/DigitalKhattDataService';
import {mushafPreloadService} from '@/services/mushaf/MushafPreloadService'; // @ai
import {useMushafVerseSelectionStore} from '@/store/mushafVerseSelectionStore';
// @ai-start
import {
  mushafVerseMapService,
  selectionForAnchor,
  whenShownVerseUnitsResolved,
} from '@/services/mushaf/MushafVerseMapService';
// @ai-end
import {mushafSessionStore} from '@/services/mushaf/MushafSessionStore';
import {noteReaderPageDrawn} from '@/services/mushaf/readerRestoreGate'; // @ai
import {
  formatPlaybackInfo, // @ai
  getPlaybackNotice, // @ai
  useMushafPlayerStore,
} from '@/store/mushafPlayerStore';
import {useMushafSettingsStore} from '@/store/mushafSettingsStore'; // @ai
import {showToast} from '@/utils/toastUtils'; // @ai
import {mushafAudioService} from '@/services/audio/MushafAudioService';
import {SheetManager} from 'react-native-actions-sheet';
import {SURAHS} from '@/data/surahData';
import MushafViewer from '@/components/mushaf/main';
import {USE_GLASS} from '@/hooks/useGlassProps';
import {useContentReadyWatchdog} from '@/hooks/useContentReadyWatchdog';
// @ai-start
import {playbackNoticeText} from '@/i18n/playback';
import {useTranslation} from 'react-i18next';
import {getSurahDisplayName, localizeDigits} from '@/i18n/format';
import {useReaderLinkPage} from '@/hooks/useReaderLinkPage';
import {useMushafData} from '@/hooks/useMushafData';
import {isRewayahId, type RewayahId} from '@/services/rewayah/RewayahIdentity';
import {restoreSavedRewayah} from '@/services/verse-annotations/restoreSavedRewayah';
import {useResponsive} from '@/hooks/useResponsive';
import {AYAH_PANEL_WIDTH} from '@/components/mushaf/ayah-panel/ayahPanelStore';
import {useAyahPanelPresentation} from '@/components/mushaf/ayah-panel/useAyahPanelPresentation';
// @ai-end

export type MushafScreenParams = {
  surah?: string;
  page?: string;
  ayah?: string;
  /** '1' on the cold-start session-restore push: a content stall is then the cold-start variant. */
  restored?: string;
  // @ai-start
  // A stored Hafs anchor ('S:A' or 'S:A:W': a bookmark / note / highlight
  // row's verse_key). When given, the flash selects exactly the shown
  // rewayah's verse holding that slot (verse-units contract 4.4) instead of
  // every verse holding Hafs `surah`:`ayah`. Never a rewayah verse number.
  anchor?: string;
  // Qariah (RFC-023 step 1): the rewayah a saved verse was saved in, sent
  // with no page. The screen restores it when the Mushaf data is ready and
  // then opens the page of the verse (savedVerseOpenParams).
  rewayah?: string;
  // Qariah (RFC-023 step 1): '1' from the player's Repeat, sent with no page.
  // The screen shows the player options when the page of the verse is known.
  playerOptions?: string;
  // @ai-end
};

export default function MushafScreen() {
  const {surah, page, ayah, anchor, restored, rewayah, playerOptions} =
    useLocalSearchParams<MushafScreenParams>(); // @ai
  const {theme} = useTheme();
  const {t} = useTranslation(['reader', 'common']); // @ai

  // @ai Qariah (RFC-023 step 1): one data state, with one retry that knows which load to redo.
  const {state: dataState, retry: retryLoad} = useMushafData();
  const dkReady = dataState === 'ready';
  const surahStartPages = dkReady
    ? digitalKhattDataService.getSurahStartPages()
    : {};

  // @ai-start
  // Qariah (RFC-023 step 1): a saved verse opens this screen at once, before
  // the Mushaf data is ready, and names the rewayah it was saved in. Restore
  // that rewayah when the data is ready (a switch before the first load
  // would compete with it), and show the loading view until then.
  const savedRewayah = isRewayahId(rewayah) ? rewayah : undefined;
  const [restoringRewayah, setRestoringRewayah] = useState(() =>
    needsRewayahRestore(savedRewayah),
  );
  useEffect(() => {
    if (!restoringRewayah || !dkReady) return;
    let cancelled = false;
    restoreSavedRewayah(savedRewayah).finally(() => {
      if (!cancelled) setRestoringRewayah(false);
    });
    return () => {
      cancelled = true;
    };
  }, [restoringRewayah, dkReady, savedRewayah]);
  const contentReady = dkReady && !restoringRewayah;
  // @ai-end

  // @ai-start
  // Qariah: a failed load ends the restore's wait, so the splash shows the
  // error view at once (services/mushaf/readerRestoreGate.ts).
  useEffect(() => {
    if (dataState === 'failed') noteReaderPageDrawn();
  }, [dataState]);
  // @ai-end

  // Resolve page number from params
  // @ai Qariah: once for each navigation. A rewayah switch later in the reader moves the reader by itself.
  const {params: routeParams} = useRoute();
  const pageNumber = useMemo(() => {
    if (page) {
      const p = parseInt(page, 10);
      if (!isNaN(p) && p >= 1 && p <= 604) return p;
    }
    // @ai-start
    // Qariah (RFC-023 step 1): with no page (a saved verse opened before the
    // data was ready), the page of the verse in the rewayah on screen, not
    // the start page of its surah.
    if (contentReady && surah && ayah) {
      const versePage = digitalKhattDataService.getPageForVerse(
        `${parseInt(surah, 10)}:${parseInt(ayah, 10)}`,
      );
      if (versePage) return versePage;
    }
    // @ai-end
    if (surah) {
      const s = parseInt(surah, 10);
      if (!isNaN(s) && surahStartPages[s]) return surahStartPages[s];
    }
    return 1;
    // @ai surahStartPages changes with the rewayah; routeParams is a new navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, surah, ayah, contentReady, routeParams]);

  // @ai-start
  // The surah the user asked for, when the page was resolved from it. A page
  // can hold the end of one surah and the start of another (or three, on
  // 601-604), so the page number alone cannot name the surah — this keeps
  // the header honest until the reader turns the page.
  const initialSurahId = useMemo(() => {
    if (page || !surah) return undefined;
    const s = parseInt(surah, 10);
    return !isNaN(s) && surahStartPages[s] ? s : undefined;
  }, [page, surah, surahStartPages]);
  // @ai-end

  // @ai Qariah (#281): a link to this open reader turns it to the link's page and surah.
  useReaderLinkPage(pageNumber, contentReady, initialSurahId);

  // @ai-start
  // RFC-023 step 1: the options of the player's Repeat need the page, so they
  // open here, once, when the page of the verse is known (VerseActionsSheet).
  const playerOptionsShownRef = useRef(false);
  useEffect(() => {
    if (playerOptions !== '1' || !contentReady) return;
    if (playerOptionsShownRef.current) return;
    playerOptionsShownRef.current = true;
    useMushafPlayerStore.setState({currentPage: pageNumber});
    SheetManager.show('mushaf-player-options', {
      payload: {currentPage: pageNumber},
    });
  }, [playerOptions, contentReady, pageNumber]);
  // @ai-end

  // Build initial verse key for highlight
  const initialVerseKey = useMemo(() => {
    if (surah && ayah) return `${surah}:${ayah}`;
    return undefined;
  }, [surah, ayah]);

  // Phones may turn to landscape while the mushaf screen is open and go back
  // to portrait on exit. iPads aren't locked, so leaving the reader in
  // landscape keeps the app in landscape. @ai
  usePhoneOrientation('free'); // @ai

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

  // @ai-start
  // Mushaf 1440 (qcf_v2) draws Hafs only and the settings store pins the
  // rewayah to Hafs there. The DigitalKhatt data service must agree: its
  // words feed the QCF Allah-name highlights now, and the DigitalKhatt pages
  // and their saved layouts after a later switch back. A path that switched
  // the service without the store (opening a bookmark saved in another
  // rewayah used to) would otherwise leave that rewayah's text under a Hafs
  // header, so put the service back on the store's rewayah.
  const mushafRenderer = useMushafSettingsStore(s => s.mushafRenderer);
  const settingsRewayah = useMushafSettingsStore(s => s.rewayah);
  useEffect(() => {
    if (mushafRenderer !== 'qcf_v2') return;
    if (!digitalKhattDataService.initialized) return;
    if (digitalKhattDataService.rewayah === settingsRewayah) return;
    digitalKhattDataService.switchRewayah(settingsRewayah).catch(error => {
      console.error('[MushafScreen] Failed to resync rewayah:', error);
    });
  }, [mushafRenderer, settingsRewayah]);
  // @ai-end

  // @ai-start
  // Qariah (A10s plan F1): the boot starts the Mushaf load only after the
  // splash hides, so a reader that opens first (a restored session, a link)
  // starts it here. initialize() is idempotent.
  useEffect(() => {
    if (mushafPreloadService.state === 'idle') {
      mushafPreloadService.initialize().catch(() => undefined);
    }
  }, []);
  // @ai-end

  // Set verse highlight on mount, auto-clear after 3s, clear on unmount
  useEffect(() => {
    // @ai-start
    // RFC-023 step 1: not before the page is known and on screen.
    if (!contentReady) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flash = () => {
      // The unit a stored anchor names, in the shown rewayah's numbering.
      const unitSelection = anchor ? selectionForAnchor(anchor) : null;
      if (!unitSelection && !initialVerseKey) return;
      const selection = useMushafVerseSelectionStore.getState();
      if (unitSelection) {
        selection.selectUnits(
          unitSelection.rewayah,
          unitSelection.units,
          pageNumber,
        );
      } else if (initialVerseKey) {
        selection.selectVerse(initialVerseKey, pageNumber);
      }
      timer = setTimeout(() => {
        useMushafVerseSelectionStore.getState().clearSelection();
      }, 3000);
    };
    // Verse units are built after interactions, never here: right after a
    // rewayah switch (a bookmark saved in another rewayah) they may still
    // be building. Wait for them, so an anchor selects exactly its verse
    // rather than every verse holding its Hafs verse, and so the 3 s flash
    // of a Hafs verse starts once the pages can paint it (no verse layer is
    // painted while the units build) instead of running out unseen.
    if (
      (anchor || initialVerseKey) &&
      mushafVerseMapService.isShownVerseUnitsPending()
    ) {
      whenShownVerseUnitsResolved().then(() => {
        if (!cancelled) flash();
      });
    } else {
      flash();
    }
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      useMushafVerseSelectionStore.getState().clearSelection();
    };
    // @ai-end
  }, [anchor, initialVerseKey, pageNumber, contentReady]); // @ai: anchor, contentReady

  // @ai REPORT-ONLY content-stall watchdog: no boot instrument sees a stuck `!dkReady` spinner.
  useContentReadyWatchdog({
    screen: 'mushaf',
    ready: contentReady, // @ai RFC-023 step 1: the rewayah restore too
    awaiting: 'digital-khatt-init',
    cold: restored === '1',
  });

  if (!contentReady) {
    // @ai-start
    // When the mushaf text cannot be loaded (e.g. no storage left to copy it to
    // the device), say so and offer a retry, not an endless spinner.
    if (dataState === 'failed') {
      return (
        <View
          style={[styles.loading, {backgroundColor: theme.colors.background}]}
          accessibilityRole="alert">
          <Text style={[styles.errorTitle, {color: theme.colors.text}]}>
            {t('reader:mushaf.loadFailedTitle')}
          </Text>
          <Text style={[styles.errorBody, {color: theme.colors.text}]}>
            {t('reader:mushaf.loadFailedBody')}
          </Text>
          <Pressable
            onPress={retryLoad}
            accessibilityRole="button"
            hitSlop={8}
            style={({pressed}) => [
              styles.retryButton,
              {borderColor: theme.colors.text},
              pressed && styles.retryButtonPressed,
            ]}>
            <Text style={[styles.retryText, {color: theme.colors.text}]}>
              {t('common:actions.tryAgain')}
            </Text>
          </Pressable>
        </View>
      );
    }
    // @ai-end
    return (
      <View
        style={[styles.loading, {backgroundColor: theme.colors.background}]}>
        <QariahMushafLoading color={theme.colors.text} />
      </View>
    );
  }

  return (
    <View
      style={[styles.container, {backgroundColor: theme.colors.background}]}>
      {USE_GLASS && <MushafToolbar />}
      <MushafViewer
        pageNumber={pageNumber}
        initialSurahId={initialSurahId} // @ai
        initialVerseKey={initialVerseKey}
      />
    </View>
  );
}

// ============================================================================
// iOS Native Toolbar (Stack.Toolbar)
// ============================================================================

// @ai-start
/**
 * True when restoreSavedRewayah() would switch the rewayah (its own early
 * return, read before the screen mounts): a saved verse in the rewayah on
 * screen shows no loading view.
 */
function needsRewayahRestore(saved: RewayahId | undefined): boolean {
  if (!saved) return false;
  return (
    saved !== useMushafSettingsStore.getState().rewayah ||
    saved !== digitalKhattDataService.rewayah
  );
}

const surahNameOf = (surah: number): string =>
  surah >= 1 && surah <= 114 ? getSurahDisplayName(SURAHS[surah - 1]) : '';
// @ai-end

// On iOS 26 this toolbar replaces MushafPlayerBar, so it carries what the bar
// shows: the verse label in the numbering of the mushaf on screen, "Verse
// tracking unavailable" (with prev / next disabled), and, as one-off notices,
// refused playback requests.
export function MushafToolbar() {
  const {t} = useTranslation(['reader', 'common']);
  const playbackState = useMushafPlayerStore(s => s.playbackState);
  const currentPage = useMushafPlayerStore(s => s.currentPage);
  const currentSurah = useMushafPlayerStore(s => s.currentSurah);
  // @ai-start
  const currentVerseLabel = useMushafPlayerStore(s => s.currentVerseLabel);
  const numberingMode = useMushafPlayerStore(s => s.numberingMode);
  // @ai-end
  const isImmersive = useMushafPlayerStore(s => s.isImmersive);
  const isSearchMode = useMushafPlayerStore(s => s.isSearchMode);
  // @ai-start Sprint 52 Task 8
  // The toolbar spans the window. Beside the ayah panel, a fixed space as
  // wide as the panel ends it, so its buttons stay over the reader pane.
  const {isTablet} = useResponsive();
  const panelPresentation = useAyahPanelPresentation(isTablet);
  const panelDocked = panelPresentation === 'side';
  const panelSpace = panelDocked ? (
    <Stack.Toolbar.Spacer width={AYAH_PANEL_WIDTH} />
  ) : null;
  // @ai-end

  const isIdle = playbackState === 'idle';
  const isPlaying = playbackState === 'playing';
  const isLoading = playbackState === 'loading';

  // @ai-start
  const surahName = surahNameOf(currentSurah);
  const verseLabel =
    !isIdle && surahName
      ? localizeDigits(
          formatPlaybackInfo(
            surahName,
            {currentVerseLabel, numberingMode},
            t('playback.trackingUnavailable'),
          ),
        )
      : '';
  const verseNavDisabled = numberingMode === 'disabled';

  // The player bar shows refusals and the tracking notice inline; this
  // toolbar has no room for text, so they surface as toasts.
  useEffect(
    () =>
      useMushafPlayerStore.subscribe((state, prev) => {
        const notice = getPlaybackNotice(
          prev,
          state,
          surahNameOf,
          playbackNoticeText(),
        );
        if (notice) showToast(notice.title, notice.message, notice.preset);
      }),
    [],
  );
  // @ai-end

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
  // @ai Sprint 52 Task 8: and while the ayah card (modal) shows.
  if (isImmersive || isSearchMode || panelPresentation === 'card') return null;

  if (isIdle) {
    // Idle: [Search] — spacer — [Play] — spacer — [Options]
    return (
      <Stack.Toolbar>
        <Stack.Toolbar.Button icon="magnifyingglass" onPress={handleSearch}>
          {t('common:actions.search')}
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.Button icon="play.fill" onPress={handlePlay}>
          {t('common:actions.play')}
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.Button icon="ellipsis.circle" onPress={handleOptions}>
          {t('toolbar.options')}
        </Stack.Toolbar.Button>
        {panelSpace /* @ai */}
      </Stack.Toolbar>
    );
  }

  // Active: [Stop] — spacer — [Prev] [Play/Pause] [Next] — spacer — [Options]
  return (
    <Stack.Toolbar>
      <Stack.Toolbar.Button icon="stop.fill" onPress={handleStop}>
        {t('toolbar.stop')}
      </Stack.Toolbar.Button>
      <Stack.Toolbar.Spacer />
      <Stack.Toolbar.Button
        icon="backward.end.fill"
        onPress={handlePrev}
        disabled={verseNavDisabled} // @ai
      />
      <Stack.Toolbar.Button
        icon={isPlaying ? 'pause.fill' : 'play.fill'}
        onPress={handlePlayPause}
        disabled={isLoading}>
        {verseLabel}
      </Stack.Toolbar.Button>
      <Stack.Toolbar.Button
        icon="forward.end.fill"
        onPress={handleNext}
        disabled={verseNavDisabled} // @ai
      />
      <Stack.Toolbar.Spacer />
      <Stack.Toolbar.Button icon="ellipsis.circle" onPress={handleOptions}>
        {t('toolbar.options')}
      </Stack.Toolbar.Button>
      {panelSpace /* @ai */}
    </Stack.Toolbar>
  );
}
// @ai-end

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // @ai-start
  errorTitle: {
    fontSize: 17,
    fontFamily: 'Manrope-SemiBold',
    textAlign: 'center',
    marginHorizontal: 24,
  },
  errorBody: {
    fontSize: 14,
    fontFamily: 'Manrope-Regular',
    textAlign: 'center',
    opacity: 0.7,
    marginTop: 8,
    marginHorizontal: 32,
  },
  retryButton: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  retryButtonPressed: {
    opacity: 0.6,
  },
  retryText: {
    fontSize: 15,
    fontFamily: 'Manrope-SemiBold',
  },
  // @ai-end
});
