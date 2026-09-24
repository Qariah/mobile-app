import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  BackHandler,
  Platform,
  LayoutAnimation,
  UIManager,
  Alert,
} from 'react-native';
import {useAuth} from '@/services/auth/AuthContext';
import {ScaledSheet, moderateScale} from 'react-native-size-matters';
import {useTheme} from '@/hooks/useTheme';
import {Theme} from '@/utils/themeUtils';
import ActionSheet, {
  SheetProps,
  SheetManager,
  ScrollView,
} from 'react-native-actions-sheet';
import {Feather, MaterialCommunityIcons} from '@expo/vector-icons';
import {useVerseAnnotationsStore} from '@/store/verseAnnotationsStore';
import {useVerseSelectionStore} from '@/store/verseSelectionStore';
import {useMushafVerseSelectionStore} from '@/store/mushafVerseSelectionStore';
import {verseAnnotationService} from '@/services/verse-annotations/VerseAnnotationService';
import {syncDeleteToQf} from '@/services/userState/notesSync';
import {qulDataService} from '@/services/mushaf/QulDataService';
import {useMushafPlayerStore} from '@/store/mushafPlayerStore';
import {digitalKhattDataService} from '@/services/mushaf/DigitalKhattDataService';
import {lightHaptics} from '@/utils/haptics';
import {
  PlayIcon,
  RepeatIcon,
  StackedVolumesIcon,
  PageQuillIcon,
  MirrorWavesIcon,
  HighlightIcon,
  ChainLinksIcon,
  GroupedLinesIcon,
  BreakdownIcon,
  CopyIcon,
  ShareIcon,
} from '@/components/Icons';
import Color from 'color';
import {router} from 'expo-router';
import {usePlayerStore} from '@/services/player/store/playerStore';
import {useTimestampStore} from '@/store/timestampStore';
import {findAyahTimestamp} from '@/utils/timestampUtils';
import {useMushafSettingsStore} from '@/store/mushafSettingsStore';
import {getTranslationTextRaw} from '@/utils/translationLookup';
import * as Clipboard from 'expo-clipboard';
import {getRewayahShortLabel} from '@/utils/rewayahLabels';
import {HighlightContent} from './verse-actions/HighlightContent';
import {NoteContent} from './verse-actions/NoteContent';
import {ShareContent} from './verse-actions/ShareContent';
import {SimilarVersesContent} from './verse-actions/SimilarVersesContent';
import {TranslationContent} from './verse-actions/TranslationContent';
import {TafseerContent} from './verse-actions/TafseerContent';
import {ThemeContent} from './verse-actions/ThemeContent';
import {CommunityReflectionsContent} from './verse-actions/CommunityReflectionsContent';
import branding from '@/config/branding';
import {WBWContent} from './verse-actions/WBWContent';
import {isFeatureEnabled} from '@/config/featureFlags';

const surahData = require('@/data/surahData.json');
const quranVerses = require('@/data/quran.json');
const transliterationData = require('@/data/transliteration.json');

type ActiveScreen =
  | 'highlight'
  | 'note'
  | 'reflection'
  | 'share'
  | 'similar'
  | 'phrases'
  | 'translation'
  | 'tafseer'
  | 'theme'
  | 'community-reflections'
  | 'wbw'
  | null;

const SCREEN_TITLES: Record<string, string> = {
  highlight: 'Highlight',
  note: 'Add Personal Note',
  reflection: 'Publish Reflection',
  share: 'Share',
  similar: 'Similar Verses',
  phrases: 'Shared Phrases',
  translation: 'Translation',
  tafseer: 'Tafseer',
  theme: 'Theme',
  'community-reflections': 'Community Reflections',
  wbw: 'Word by Word',
};

const SHEET_HEIGHT = Dimensions.get('window').height * 0.85;

// Enable LayoutAnimation on Android
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export const VerseActionsSheet = (props: SheetProps<'verse-actions'>) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const [activeScreen, setActiveScreenRaw] = useState<ActiveScreen>(null);

  const setActiveScreen = useCallback((screen: ActiveScreen) => {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(250, 'easeInEaseOut', 'opacity'),
    );
    setActiveScreenRaw(screen);
  }, []);

  const hideCurrentSheet = useCallback(() => {
    SheetManager.hide(props.sheetId).catch(error => {
      console.warn('[VerseActionsSheet] Failed to hide sheet:', error);
    });
  }, [props.sheetId]);

  const payload = props.payload;
  const verseKey = payload?.verseKey ?? '';
  const surahNumber = payload?.surahNumber ?? 0;
  const ayahNumber = payload?.ayahNumber ?? 0;
  const verseKeys = payload?.verseKeys;
  const isRange = verseKeys && verseKeys.length > 1;
  const source = payload?.source;

  const selectedTranslationId = useMushafSettingsStore(
    s => s.selectedTranslationId,
  );

  const mushafRewayah = useMushafSettingsStore(s => s.rewayah);
  const resolvedRewayah = payload?.rewayah ?? mushafRewayah;

  const {arabicText, translation, transliteration} = useMemo(() => {
    // Prefer the rewayah-specific DK text so copy/share matches what the
    // user is actually reading (or listening to, if player passed its own
    // rewayah). Fall back to the static Hafs JSON only if DK has no entry.
    const resolveArabic = (vk: string): string => {
      const dk = digitalKhattDataService.getVerseText(vk, resolvedRewayah);
      if (dk) return dk;
      const legacy = (
        Object.values(quranVerses) as Array<{verse_key: string; text: string}>
      ).find(v => v.verse_key === vk)?.text;
      return legacy ?? '';
    };

    if (isRange) {
      const arabicParts: string[] = [];
      const translationParts: string[] = [];
      const transliterationParts: string[] = [];
      for (const vk of verseKeys) {
        const arabic = resolveArabic(vk);
        if (arabic) arabicParts.push(arabic);
        const trans = getTranslationTextRaw(vk, selectedTranslationId);
        if (trans) translationParts.push(trans);
        const translit = transliterationData[vk]?.t;
        if (translit) transliterationParts.push(translit);
      }
      return {
        arabicText: arabicParts.join('\n'),
        translation: translationParts.join('\n'),
        transliteration: transliterationParts.join('\n'),
      };
    }

    const resolvedArabic = payload?.arabicText || resolveArabic(verseKey);
    const resolvedTranslation =
      payload?.translation ||
      getTranslationTextRaw(verseKey, selectedTranslationId) ||
      '';
    const resolvedTransliteration =
      payload?.transliteration || transliterationData[verseKey]?.t || '';
    return {
      arabicText: resolvedArabic as string,
      translation: resolvedTranslation as string,
      transliteration: resolvedTransliteration as string,
    };
  }, [
    verseKey,
    verseKeys,
    isRange,
    payload?.arabicText,
    payload?.translation,
    payload?.transliteration,
    selectedTranslationId,
    resolvedRewayah,
  ]);

  const surah = surahData.find(
    (s: {id: number; name: string}) => s.id === surahNumber,
  );
  const surahName = surah?.name ?? '';

  const verseRefText = useMemo(() => {
    if (!isRange) return `${surahNumber}:${ayahNumber}`;
    const firstKey = verseKeys[0];
    const lastKey = verseKeys[verseKeys.length - 1];
    const [firstSurah, firstAyah] = firstKey.split(':');
    const [lastSurah, lastAyah] = lastKey.split(':');
    if (firstSurah === lastSurah) {
      return `${firstSurah}:${firstAyah}-${lastAyah}`;
    }
    return `${firstSurah}:${firstAyah} - ${lastSurah}:${lastAyah}`;
  }, [isRange, verseKeys, surahNumber, ayahNumber]);

  const isBookmarked = useVerseAnnotationsStore(state => {
    const keys = isRange ? verseKeys : [verseKey];
    return keys.every(vk => state.isBookmarked(vk));
  });
  const isHighlighted = useVerseAnnotationsStore(
    state => !!state.highlights[verseKey],
  );
  const hasNote = useVerseAnnotationsStore(state => state.hasNote(verseKey));

  // Sprint 21 round-3 split — distinguish Personal Notes (private) from
  // Reflections (published to QuranReflect). The store's `hasNote(vk)` is
  // type-agnostic; we partition by `qf_post_id` at sheet open via a
  // one-shot async fetch. Refresh isn't wired to mid-sheet writes — the
  // sheet dismisses on save and the next open re-fetches.
  const [personalNoteId, setPersonalNoteId] = useState<string | null>(null);
  const [reflectionNoteId, setReflectionNoteId] = useState<string | null>(null);
  useEffect(() => {
    if (!verseKey || isRange) {
      setPersonalNoteId(null);
      setReflectionNoteId(null);
      return;
    }
    let cancelled = false;
    verseAnnotationService.getNotesForVerse(verseKey).then(list => {
      if (cancelled) return;
      const reflection = list.find(n => n.qfPostId) ?? null;
      const personal = list.find(n => !n.qfPostId) ?? null;
      setReflectionNoteId(reflection?.id ?? null);
      setPersonalNoteId(personal?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [verseKey, isRange]);
  const hasPersonalNote = !!personalNoteId;
  const hasReflection = !!reflectionNoteId;

  const {status: authStatus} = useAuth();
  const signedIn = authStatus === 'authenticated';
  // `authStatus` can be `'loading'` during cold-start token refresh; only
  // treat the explicit `'unauthenticated'` state as the trigger for the
  // sign-in Alert. A `'loading'` tap is a no-op so the user doesn't get a
  // false "please sign in" prompt while their token is still being
  // restored from SecureStore. Caught in the Sprint 26 PR #42 code review
  // (post-close, replacing the GHA claude-review check that couldn't run).
  const authUnsettled = authStatus === 'loading';

  const handleToggleBookmark = useCallback(async () => {
    lightHaptics();
    const keys = isRange ? verseKeys : [verseKey];
    const store = useVerseAnnotationsStore.getState();
    if (isBookmarked) {
      for (const vk of keys) {
        await verseAnnotationService.removeBookmark(vk);
        store.removeBookmark(vk);
      }
    } else {
      for (const vk of keys) {
        const [s, a] = vk.split(':');
        await verseAnnotationService.addBookmark(
          vk,
          parseInt(s, 10),
          parseInt(a, 10),
          resolvedRewayah,
        );
        store.addBookmark(vk);
      }
    }
    await SheetManager.hide(props.sheetId);
  }, [
    verseKey,
    verseKeys,
    isRange,
    isBookmarked,
    resolvedRewayah,
    props.sheetId,
  ]);

  const handleHighlight = useCallback(async () => {
    if (isHighlighted) {
      lightHaptics();
      const keys = isRange ? verseKeys : [verseKey];
      const store = useVerseAnnotationsStore.getState();
      for (const vk of keys) {
        await verseAnnotationService.removeHighlight(vk);
        store.removeHighlight(vk);
      }
      hideCurrentSheet();
    } else {
      setActiveScreen('highlight');
    }
  }, [verseKey, verseKeys, isRange, isHighlighted, hideCurrentSheet]);

  /**
   * Re-fetch existing notes inside the click handler (rather than relying
   * on the useEffect-populated `personalNoteId` / `reflectionNoteId`
   * state) so we never race the async fetch. Without this, tapping
   * "Edit X" before the lookup resolved would fall through to the
   * inline Add path and create a duplicate local row + duplicate QF
   * post (see sprint-20 round-2 bug A).
   */
  const handlePersonalNote = useCallback(async () => {
    if (!isRange && verseKey) {
      const existing = await verseAnnotationService.getNotesForVerse(verseKey);
      const personal = existing.find(n => !n.qfPostId);
      if (personal?.id) {
        await SheetManager.hide(props.sheetId);
        SheetManager.show('verse-note', {
          payload: {
            verseKey,
            surahNumber,
            ayahNumber,
            noteId: personal.id,
            rewayah: resolvedRewayah,
          },
        });
        return;
      }
    }
    setActiveScreen('note');
  }, [
    isRange,
    verseKey,
    surahNumber,
    ayahNumber,
    resolvedRewayah,
    props.sheetId,
    setActiveScreen,
  ]);

  const handleReflection = useCallback(async () => {
    // Reflections publish to QuranReflect under the signed-in user's name —
    // require a Quran Foundation sign-in before opening the editor. Without
    // this gate, signed-out users land in the editor and silently degrade
    // to a personal-note save (the publish path is `if (signedIn)`-gated in
    // NoteContent), creating a "I thought I published" surprise. Surfaced
    // by the user during Sprint 26 sim smoke (2026-05-25).
    if (authUnsettled) {
      // Auth still loading — don't fire the sign-in Alert; user likely IS
      // signed in and the token is still being restored. Bail silently.
      return;
    }
    if (!signedIn) {
      await SheetManager.hide(props.sheetId);
      Alert.alert(
        'Sign in to publish',
        'Reflections publish to the QuranReflect community under your name. Sign in with your Quran Foundation account to continue, or save a personal note instead (no sign-in needed).',
        [
          {text: 'Cancel', style: 'cancel'},
          {
            text: 'Sign in',
            onPress: () => router.push('/(d.settings)/sign-in'),
          },
        ],
      );
      return;
    }
    if (!isRange && verseKey) {
      const existing = await verseAnnotationService.getNotesForVerse(verseKey);
      const reflection = existing.find(n => n.qfPostId);
      if (reflection?.id) {
        await SheetManager.hide(props.sheetId);
        SheetManager.show('verse-note', {
          payload: {
            verseKey,
            surahNumber,
            ayahNumber,
            noteId: reflection.id,
            rewayah: resolvedRewayah,
          },
        });
        return;
      }
    }
    setActiveScreen('reflection');
  }, [
    authUnsettled,
    signedIn,
    isRange,
    verseKey,
    surahNumber,
    ayahNumber,
    resolvedRewayah,
    props.sheetId,
    setActiveScreen,
  ]);

  /**
   * Remove only the Personal Note row for this verse, leaving any
   * Reflection in place. Sync the QF delete first so a fresh-install
   * restore doesn't pull the deleted note back (sprint-20 round-2 bug B).
   */
  const handleRemovePersonalNote = useCallback(async () => {
    if (!verseKey || isRange) return;
    lightHaptics();
    const store = useVerseAnnotationsStore.getState();
    const notes = await verseAnnotationService.getNotesForVerse(verseKey);
    const personals = notes.filter(n => !n.qfPostId);
    for (const n of personals) {
      await syncDeleteToQf(n);
      await verseAnnotationService.deleteNoteById(n.id);
    }
    // Only fire the verse-level `removeNote` if no Reflection row remains;
    // otherwise the store's `hasNote(vk)` would lie and the verse-anchor
    // pin / list visibility would flip off prematurely.
    const remaining = notes.length - personals.length;
    if (remaining === 0) {
      store.removeNote(verseKey);
    }
    await SheetManager.hide(props.sheetId);
  }, [verseKey, isRange, props.sheetId]);

  /**
   * Remove a Reflection (unpublish from QuranReflect + delete the local
   * note row). Mirrors `handleRemovePersonalNote` but partitions on the
   * `qf_post_id` side.
   */
  const handleRemoveReflection = useCallback(async () => {
    if (!verseKey || isRange) return;
    lightHaptics();
    const store = useVerseAnnotationsStore.getState();
    const notes = await verseAnnotationService.getNotesForVerse(verseKey);
    const reflections = notes.filter(n => n.qfPostId);
    for (const n of reflections) {
      // syncDeleteToQf handles BOTH the QR post deletion AND the
      // auth-service Note deletion in the right order.
      await syncDeleteToQf(n);
      await verseAnnotationService.deleteNoteById(n.id);
    }
    const remaining = notes.length - reflections.length;
    if (remaining === 0) {
      store.removeNote(verseKey);
    }
    await SheetManager.hide(props.sheetId);
  }, [verseKey, isRange, props.sheetId]);

  const handleCopy = useCallback(async () => {
    lightHaptics();
    const parts: string[] = [];
    if (arabicText) parts.push(arabicText);
    if (translation) parts.push(translation);
    const ref =
      resolvedRewayah === 'hafs'
        ? `Quran ${verseRefText}`
        : `Quran ${verseRefText} · ${getRewayahShortLabel(resolvedRewayah)}`;
    parts.push(ref);
    await Clipboard.setStringAsync(parts.join('\n\n'));
    await SheetManager.hide(props.sheetId);
  }, [arabicText, translation, verseRefText, resolvedRewayah, props.sheetId]);

  const handleShare = useCallback(() => {
    lightHaptics();
    setActiveScreen('share');
  }, []);

  const handleTranslation = useCallback(() => {
    setActiveScreen('translation');
  }, []);

  const handleTafseer = useCallback(() => {
    setActiveScreen('tafseer');
  }, []);

  const handleTheme = useCallback(() => {
    setActiveScreen('theme');
  }, []);

  const handleCommunityReflections = useCallback(() => {
    setActiveScreen('community-reflections');
  }, []);

  const handleWBW = useCallback(() => {
    setActiveScreen('wbw');
  }, []);

  // QUL data: theme label and per-feature availability
  const [hasSimilarVerses, setHasSimilarVerses] = useState(false);
  const [hasSharedPhrases, setHasSharedPhrases] = useState(false);

  useEffect(() => {
    if (!surahNumber || !ayahNumber || isRange) return;
    let cancelled = false;
    const vk = `${surahNumber}:${ayahNumber}`;

    (async () => {
      const [similar, phrases] = await Promise.all([
        qulDataService.hasSimilarVerses(vk),
        qulDataService.hasSharedPhrases(vk),
      ]);
      if (cancelled) return;
      setHasSimilarVerses(similar);
      setHasSharedPhrases(phrases);
    })();

    return () => {
      cancelled = true;
    };
  }, [surahNumber, ayahNumber, isRange]);

  const handleSimilarVerses = useCallback(() => {
    setActiveScreen('similar');
  }, []);

  const handleSharedPhrases = useCallback(() => {
    setActiveScreen('phrases');
  }, []);

  const startPlaybackForSelection = useCallback(
    async (loop: boolean) => {
      lightHaptics();
      const store = useMushafPlayerStore.getState();

      if (!store.rewayatId) {
        const keys = isRange ? verseKeys! : [verseKey];
        const firstKey = keys[0];
        const page =
          digitalKhattDataService.getPageForVerse(firstKey) ||
          store.currentPage ||
          1;
        useMushafPlayerStore.setState({
          currentPage: page,
          pendingStartVerseKey: firstKey,
        });
        await SheetManager.hide(props.sheetId);
        SheetManager.show('mushaf-player-options', {
          payload: {currentPage: page},
        });
        return;
      }

      const keys = isRange ? verseKeys! : [verseKey];
      const firstKey = keys[0];
      const lastKey = keys[keys.length - 1];
      const [startS, startA] = firstKey.split(':').map(Number);
      const [endS, endA] = lastKey.split(':').map(Number);

      const page =
        digitalKhattDataService.getPageForVerse(firstKey) ||
        store.currentPage ||
        1;

      store.stop();

      if (loop) {
        store.setRange(
          {surah: startS, ayah: startA},
          {surah: endS, ayah: endA},
        );
        store.setVerseRepeatCount(isRange ? 1 : 0);
        store.setRangeRepeatCount(0);
      } else {
        const surahInfo = surahData.find((s: {id: number}) => s.id === startS);
        const lastAyah = surahInfo?.verses_count ?? endA;
        store.setRange(
          {surah: startS, ayah: startA},
          {surah: startS, ayah: lastAyah},
        );
        store.setVerseRepeatCount(1);
        store.setRangeRepeatCount(1);
      }

      hideCurrentSheet();
      store.startPlayback(page, firstKey);
    },
    [verseKey, verseKeys, isRange, props.sheetId, hideCurrentSheet],
  );

  const handlePlaySelection = useCallback(
    () => startPlaybackForSelection(false),
    [startPlaybackForSelection],
  );

  const handleRepeatSelection = useCallback(
    () => startPlaybackForSelection(true),
    [startPlaybackForSelection],
  );

  const isCurrentTrackTimestamped = useCallback(() => {
    const playerState = usePlayerStore.getState();
    const currentTrack =
      playerState.queue.tracks[playerState.queue.currentIndex];
    const trackRewayatId = currentTrack?.rewayatId;
    if (!trackRewayatId) return false;
    return useTimestampStore.getState().supportedRewayatIds.has(trackRewayatId);
  }, []);

  const handleShowFollowAlong = useCallback(async () => {
    lightHaptics();
    await SheetManager.hide(props.sheetId);
    SheetManager.show('follow-along');
  }, [props.sheetId]);

  const handlePlayerPlayFromHere = useCallback(() => {
    lightHaptics();
    const keys = isRange ? verseKeys! : [verseKey];
    const firstKey = keys[0];
    const [, ayahStr] = firstKey.split(':');
    const ayahNumber = parseInt(ayahStr, 10);

    const timestamps = useTimestampStore.getState().currentSurahTimestamps;
    if (!timestamps) return;

    const ts = findAyahTimestamp(timestamps, ayahNumber);
    if (!ts) return;

    const playerState = usePlayerStore.getState();
    playerState.seekTo(ts.timestampFrom / 1000);
    if (playerState.playback.state !== 'playing') {
      playerState.play();
    }
    useTimestampStore.getState().setCurrentAyah({
      surahNumber: ts.surahNumber,
      ayahNumber: ts.ayahNumber,
      verseKey: firstKey,
      timestampFrom: ts.timestampFrom,
      timestampTo: ts.timestampTo,
    });

    hideCurrentSheet();
  }, [verseKey, verseKeys, isRange, hideCurrentSheet]);

  const handlePlayerRepeat = useCallback(async () => {
    lightHaptics();
    const keys = isRange ? verseKeys! : [verseKey];
    const firstKey = keys[0];
    const [sStr, aStr] = firstKey.split(':');
    const sNum = parseInt(sStr, 10);
    const aNum = parseInt(aStr, 10);

    const playerState = usePlayerStore.getState();
    const currentTrack =
      playerState.queue.tracks[playerState.queue.currentIndex];
    const trackRewayatId = currentTrack?.rewayatId;
    const trackReciterName = currentTrack?.reciterName;

    const page =
      digitalKhattDataService.getPageForVerse(firstKey) ||
      useMushafPlayerStore.getState().currentPage ||
      1;

    const mushafStore = useMushafPlayerStore.getState();
    if (trackRewayatId && trackReciterName) {
      mushafStore.setReciter(trackRewayatId, trackReciterName);
    }
    useMushafPlayerStore.setState({currentPage: page});

    if (playerState.playback.state === 'playing') {
      playerState.pause();
    }

    await SheetManager.hide(props.sheetId);
    playerState.setSheetMode('hidden');

    useMushafPlayerStore.setState({
      currentPage: page,
      pendingStartVerseKey: firstKey,
    });

    router.push({
      pathname: '/mushaf',
      params: {
        page: String(page),
        surah: String(sNum),
        ayah: String(aNum),
      },
    });

    SheetManager.show('mushaf-player-options', {
      payload: {currentPage: page},
    });
  }, [verseKey, verseKeys, isRange, props.sheetId]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !activeScreen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setActiveScreen(null);
      return true;
    });
    return () => sub.remove();
  }, [activeScreen]);

  const handleOnClose = useCallback(() => {
    setActiveScreen(null);
    useVerseSelectionStore.getState().clearSelection();
    useMushafVerseSelectionStore.getState().clearSelection();
  }, []);

  const handleDismiss = useCallback(() => {
    hideCurrentSheet();
  }, [hideCurrentSheet]);

  const handleBack = useCallback(() => {
    setActiveScreen(null);
  }, []);

  if (!payload) return null;

  const isSimilar = activeScreen === 'similar' || activeScreen === 'phrases';
  const isFullScreen =
    activeScreen === 'translation' ||
    activeScreen === 'tafseer' ||
    activeScreen === 'theme' ||
    activeScreen === 'community-reflections' ||
    activeScreen === 'wbw';

  return (
    <ActionSheet
      id={props.sheetId}
      containerStyle={[
        styles.sheetContainer,
        activeScreen && {height: SHEET_HEIGHT},
      ]}
      indicatorStyle={activeScreen ? {height: 0} : styles.indicator}
      gestureEnabled={true}
      onClose={handleOnClose}>
      <View style={[styles.container, activeScreen && {flex: 1}]}>
        {!activeScreen && (
          <View style={styles.header}>
            <Text style={styles.surahName}>{surahName}</Text>
            <Text style={styles.verseRef}>{verseRefText}</Text>
          </View>
        )}

        {activeScreen ? (
          <>
            <View style={styles.backRowContainer}>
              <Pressable
                onPress={handleBack}
                style={({pressed}) => [
                  styles.backRow,
                  pressed && {opacity: 0.6},
                ]}
                hitSlop={8}>
                <Feather
                  name="chevron-left"
                  size={moderateScale(16)}
                  color={theme.colors.text}
                />
                <Text style={styles.backRowText}>
                  {SCREEN_TITLES[activeScreen] ?? 'Back'}
                </Text>
              </Pressable>
              {(activeScreen === 'translation' ||
                activeScreen === 'tafseer') && (
                <Pressable
                  onPress={() => {
                    lightHaptics();
                    hideCurrentSheet();
                    usePlayerStore.getState().setSheetMode('hidden');
                    setTimeout(() => {
                      router.push('/(tabs)/(a.home)/translations');
                    }, 300);
                  }}
                  style={({pressed}) => [
                    styles.settingsButton,
                    pressed && {opacity: 0.6},
                  ]}
                  hitSlop={8}>
                  <Feather
                    name="settings"
                    size={moderateScale(16)}
                    color={Color(theme.colors.text).alpha(0.5).toString()}
                  />
                </Pressable>
              )}
            </View>
            {isFullScreen ? (
              <View style={{flex: 1}}>
                {activeScreen === 'translation' && (
                  <TranslationContent
                    surahNumber={surahNumber}
                    ayahNumber={ayahNumber}
                    rewayah={resolvedRewayah}
                    onBack={handleBack}
                  />
                )}
                {activeScreen === 'tafseer' && (
                  <TafseerContent
                    surahNumber={surahNumber}
                    ayahNumber={ayahNumber}
                    rewayah={resolvedRewayah}
                    onBack={handleBack}
                  />
                )}
                {activeScreen === 'theme' && (
                  <ThemeContent
                    surahNumber={surahNumber}
                    ayahNumber={ayahNumber}
                    onBack={handleBack}
                  />
                )}
                {activeScreen === 'community-reflections' && (
                  <CommunityReflectionsContent
                    surahNumber={surahNumber}
                    ayahNumber={ayahNumber}
                    rewayah={resolvedRewayah}
                    onBack={handleBack}
                  />
                )}
                {isFeatureEnabled('wordByWordTransliteration') &&
                  activeScreen === 'wbw' && (
                    <WBWContent
                      surahNumber={surahNumber}
                      ayahNumber={ayahNumber}
                    />
                  )}
              </View>
            ) : (
              <>
                {isFeatureEnabled('coloredHighlights') &&
                  activeScreen === 'highlight' && (
                    <HighlightContent
                      verseKey={verseKey}
                      surahNumber={surahNumber}
                      ayahNumber={ayahNumber}
                      verseKeys={verseKeys}
                      rewayah={resolvedRewayah}
                      onDone={handleDismiss}
                    />
                  )}
                {isFeatureEnabled('verseNotes') &&
                  (activeScreen === 'note' ||
                    activeScreen === 'reflection') && (
                    <NoteContent
                      verseKey={verseKey}
                      surahNumber={surahNumber}
                      ayahNumber={ayahNumber}
                      verseKeys={verseKeys}
                      rewayah={resolvedRewayah}
                      defaultPublish={activeScreen === 'reflection'}
                      onDone={handleDismiss}
                    />
                  )}
                {activeScreen === 'share' && (
                  <ShareContent
                    verseKey={verseKey}
                    surahNumber={surahNumber}
                    ayahNumber={ayahNumber}
                    verseKeys={verseKeys}
                    rewayah={resolvedRewayah}
                    onDone={handleDismiss}
                  />
                )}
                {isSimilar && (
                  <SimilarVersesContent
                    verseKey={verseKey}
                    surahNumber={surahNumber}
                    ayahNumber={ayahNumber}
                    section={activeScreen === 'similar' ? 'similar' : 'phrases'}
                    onDone={handleDismiss}
                  />
                )}
              </>
            )}
          </>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={{paddingBottom: moderateScale(10)}}>
            {/* LISTEN */}
            <View style={styles.card}>
              <Pressable
                style={({pressed}) => [
                  styles.option,
                  pressed && styles.optionPressed,
                ]}
                onPress={
                  source === 'player'
                    ? isCurrentTrackTimestamped()
                      ? handlePlayerPlayFromHere
                      : handleShowFollowAlong
                    : handlePlaySelection
                }>
                <PlayIcon size={moderateScale(18)} color={theme.colors.text} />
                <Text style={styles.optionText}>
                  {isRange ? 'Play Selection' : 'Play from Here'}
                </Text>
              </Pressable>
              <View style={styles.divider} />
              <Pressable
                style={({pressed}) => [
                  styles.option,
                  pressed && styles.optionPressed,
                ]}
                onPress={
                  source === 'player'
                    ? isCurrentTrackTimestamped()
                      ? handlePlayerRepeat
                      : handleShowFollowAlong
                    : handleRepeatSelection
                }>
                <RepeatIcon
                  size={moderateScale(24)}
                  color={theme.colors.text}
                />
                <Text style={styles.optionText}>Repeat</Text>
              </Pressable>
            </View>

            {/* STUDY */}
            <View style={styles.card}>
              <Pressable
                style={({pressed}) => [
                  styles.option,
                  pressed && styles.optionPressed,
                ]}
                onPress={handleToggleBookmark}>
                <Feather
                  name={isBookmarked ? 'minus-circle' : 'bookmark'}
                  size={moderateScale(18)}
                  color={theme.colors.text}
                />
                <Text style={styles.optionText}>
                  {isBookmarked ? 'Remove Bookmark' : 'Bookmark'}
                </Text>
              </Pressable>
              {isFeatureEnabled('coloredHighlights') && (
                <>
                  <View style={styles.divider} />
                  <Pressable
                    style={({pressed}) => [
                      styles.option,
                      pressed && styles.optionPressed,
                    ]}
                    onPress={handleHighlight}>
                    {isHighlighted ? (
                      <Feather
                        name="minus-circle"
                        size={moderateScale(18)}
                        color={theme.colors.text}
                      />
                    ) : (
                      <HighlightIcon
                        size={moderateScale(18)}
                        color={theme.colors.text}
                      />
                    )}
                    <Text style={styles.optionText}>
                      {isHighlighted ? 'Remove Highlight' : 'Highlight'}
                    </Text>
                  </Pressable>
                </>
              )}
              {/* Sprint 21 round-3 — Personal Notes (private, not synced
                  to QuranReflect) and Reflections (published to QF /
                  QuranReflect) are now two distinct entry points. Same
                  underlying VerseNote row schema, partitioned by
                  qf_post_id at click time. */}
              {isFeatureEnabled('verseNotes') && (
                <>
                  <View style={styles.divider} />
                  <Pressable
                    style={({pressed}) => [
                      styles.option,
                      pressed && styles.optionPressed,
                    ]}
                    onPress={handlePersonalNote}>
                    <PageQuillIcon
                      size={moderateScale(18)}
                      color={theme.colors.text}
                    />
                    <Text style={styles.optionText}>
                      {hasPersonalNote && !isRange
                        ? 'Edit Personal Note'
                        : 'Add Personal Note'}
                    </Text>
                  </Pressable>
                  {hasPersonalNote && !isRange ? (
                    <>
                      <View style={styles.divider} />
                      <Pressable
                        style={({pressed}) => [
                          styles.option,
                          pressed && styles.optionPressed,
                        ]}
                        onPress={handleRemovePersonalNote}>
                        <Feather
                          name="minus-circle"
                          size={moderateScale(18)}
                          color={theme.colors.text}
                        />
                        <Text style={styles.optionText}>
                          Remove Personal Note
                        </Text>
                      </Pressable>
                    </>
                  ) : null}
                </>
              )}
              {/* Reflection entry — published to QuranReflect on save.
                  Hidden for ranges (QR API takes a single verseKey). */}
              {isFeatureEnabled('verseNotes') && !isRange ? (
                <>
                  <View style={styles.divider} />
                  <Pressable
                    style={({pressed}) => [
                      styles.option,
                      pressed && styles.optionPressed,
                    ]}
                    onPress={handleReflection}>
                    <Feather
                      name="users"
                      size={moderateScale(18)}
                      color={theme.colors.text}
                    />
                    <Text style={styles.optionText}>
                      {hasReflection ? 'Edit Reflection' : 'Publish Reflection'}
                    </Text>
                  </Pressable>
                  {hasReflection ? (
                    <>
                      <View style={styles.divider} />
                      <Pressable
                        style={({pressed}) => [
                          styles.option,
                          pressed && styles.optionPressed,
                        ]}
                        onPress={handleRemoveReflection}>
                        <Feather
                          name="minus-circle"
                          size={moderateScale(18)}
                          color={theme.colors.text}
                        />
                        <Text style={styles.optionText}>Remove Reflection</Text>
                      </Pressable>
                    </>
                  ) : null}
                </>
              ) : null}
            </View>

            {/* EXPLORE */}
            <View style={styles.card}>
              <Pressable
                style={({pressed}) => [
                  styles.option,
                  pressed && styles.optionPressed,
                ]}
                onPress={handleTranslation}>
                <MaterialCommunityIcons
                  name="translate"
                  size={moderateScale(19)}
                  color={theme.colors.text}
                />
                <Text style={styles.optionText}>Translation</Text>
              </Pressable>
              {!isRange ? (
                <>
                  <View style={styles.divider} />
                  <Pressable
                    style={({pressed}) => [
                      styles.option,
                      pressed && styles.optionPressed,
                    ]}
                    onPress={handleTafseer}>
                    <StackedVolumesIcon
                      size={moderateScale(18)}
                      color={theme.colors.text}
                    />
                    <Text style={styles.optionText}>Tafseer</Text>
                  </Pressable>
                </>
              ) : null}
              {!isRange ? (
                <>
                  <View style={styles.divider} />
                  <Pressable
                    style={({pressed}) => [
                      styles.option,
                      pressed && styles.optionPressed,
                    ]}
                    onPress={handleTheme}>
                    <GroupedLinesIcon
                      size={moderateScale(18)}
                      color={theme.colors.text}
                    />
                    <Text style={styles.optionText}>Theme</Text>
                  </Pressable>
                </>
              ) : null}
              {branding.communityReflectionsProvider && !isRange ? (
                <>
                  <View style={styles.divider} />
                  <Pressable
                    style={({pressed}) => [
                      styles.option,
                      pressed && styles.optionPressed,
                    ]}
                    onPress={handleCommunityReflections}>
                    <Feather
                      name="users"
                      size={moderateScale(18)}
                      color={theme.colors.text}
                    />
                    <Text style={styles.optionText}>Community Reflections</Text>
                  </Pressable>
                </>
              ) : null}
              {isFeatureEnabled('wordByWordTransliteration') && !isRange ? (
                <>
                  <View style={styles.divider} />
                  <Pressable
                    style={({pressed}) => [
                      styles.option,
                      pressed && styles.optionPressed,
                    ]}
                    onPress={handleWBW}>
                    <BreakdownIcon
                      size={moderateScale(18)}
                      color={theme.colors.text}
                    />
                    <Text style={styles.optionText}>Word by Word</Text>
                  </Pressable>
                </>
              ) : null}
              {hasSimilarVerses && !isRange ? (
                <>
                  <View style={styles.divider} />
                  <Pressable
                    style={({pressed}) => [
                      styles.option,
                      pressed && styles.optionPressed,
                    ]}
                    onPress={handleSimilarVerses}>
                    <MirrorWavesIcon
                      size={moderateScale(18)}
                      color={theme.colors.text}
                    />
                    <Text style={styles.optionText}>Similar Verses</Text>
                  </Pressable>
                </>
              ) : null}
              {hasSharedPhrases && !isRange ? (
                <>
                  <View style={styles.divider} />
                  <Pressable
                    style={({pressed}) => [
                      styles.option,
                      pressed && styles.optionPressed,
                    ]}
                    onPress={handleSharedPhrases}>
                    <ChainLinksIcon
                      size={moderateScale(18)}
                      color={theme.colors.text}
                    />
                    <Text style={styles.optionText}>Shared Phrases</Text>
                  </Pressable>
                </>
              ) : null}
            </View>

            {/* SHARE */}
            <View style={styles.card}>
              <Pressable
                style={({pressed}) => [
                  styles.option,
                  pressed && styles.optionPressed,
                ]}
                onPress={handleCopy}>
                <CopyIcon size={moderateScale(18)} color={theme.colors.text} />
                <Text style={styles.optionText}>Copy</Text>
              </Pressable>
              <View style={styles.divider} />
              <Pressable
                style={({pressed}) => [
                  styles.option,
                  pressed && styles.optionPressed,
                ]}
                onPress={handleShare}>
                <ShareIcon size={moderateScale(18)} color={theme.colors.text} />
                <Text style={styles.optionText}>Share</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}
      </View>
    </ActionSheet>
  );
};

const createStyles = (theme: Theme) =>
  ScaledSheet.create({
    sheetContainer: {
      backgroundColor: theme.colors.background,
      borderTopLeftRadius: moderateScale(20),
      borderTopRightRadius: moderateScale(20),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderColor: Color(theme.colors.text).alpha(0.08).toString(),
      paddingTop: moderateScale(8),
    },
    indicator: {
      backgroundColor: Color(theme.colors.text).alpha(0.3).toString(),
      width: moderateScale(40),
      height: 2.5,
    },
    container: {
      paddingHorizontal: moderateScale(20),
      paddingBottom: moderateScale(30),
    },
    header: {
      alignItems: 'center',
      marginTop: moderateScale(4),
      marginBottom: moderateScale(14),
      gap: moderateScale(2),
    },
    surahName: {
      fontSize: moderateScale(18),
      fontFamily: 'Manrope-Bold',
      color: theme.colors.text,
      textAlign: 'center',
    },
    verseRef: {
      fontSize: moderateScale(13),
      fontFamily: 'Manrope-Medium',
      color: Color(theme.colors.textSecondary).alpha(0.5).toString(),
      textAlign: 'center',
    },
    card: {
      backgroundColor: Color(theme.colors.text).alpha(0.04).toString(),
      borderWidth: 1,
      borderColor: Color(theme.colors.text).alpha(0.06).toString(),
      borderRadius: moderateScale(12),
      overflow: 'hidden',
      marginBottom: moderateScale(8),
    },
    divider: {
      height: 1,
      backgroundColor: Color(theme.colors.text).alpha(0.06).toString(),
      marginHorizontal: moderateScale(14),
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: moderateScale(11),
      paddingHorizontal: moderateScale(14),
    },
    optionPressed: {
      backgroundColor: Color(theme.colors.text).alpha(0.06).toString(),
    },
    optionText: {
      flex: 1,
      fontSize: moderateScale(14),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.text,
      marginLeft: moderateScale(10),
    },
    backRowContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: moderateScale(10),
    },
    backRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(2),
    },
    settingsButton: {
      padding: moderateScale(4),
    },
    backRowText: {
      fontSize: moderateScale(13),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.text,
    },
  });
