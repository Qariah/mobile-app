import React, {useEffect} from 'react';
import {View, ActivityIndicator} from 'react-native';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {useTheme} from '@/hooks/useTheme';
import {useReciterStore} from '@/store/reciterStore';
import {getReciterBySlug} from '@/services/dataService';
import {generateSmartAudioUrl} from '@/utils/audioUtils';
import {getReciterArtwork} from '@/utils/artworkUtils';
import {SURAHS} from '@/data/surahData';
import {usePlayerStore} from '@/services/player/store/playerStore';
// @ai-start
import i18n from '@/i18n';
import {getSurahDisplayName} from '@/i18n/format';
import {findRewayatForSurah} from '@/utils/rewayatForSurah';
import {showToast} from '@/utils/toastUtils';
// @ai-end

// @ai-start
export default function RecitationDeepLinkReceiver(): React.ReactElement {
  const {slug, surah, rewayah, t} = useLocalSearchParams<{
    slug: string;
    surah: string;
    rewayah?: string;
    t?: string;
  }>();
  const router = useRouter();
  const {theme} = useTheme();
  const isInitialized = useReciterStore(s => s.isInitialized);

  useEffect(() => {
    if (!isInitialized || !slug || !surah) return;

    const reciter = getReciterBySlug(slug);
    if (!reciter) {
      router.replace('/');
      return;
    }

    const surahNum = parseInt(surah, 10);
    if (Number.isNaN(surahNum)) {
      router.replace('/');
      return;
    }

    const openReciterProfile = (rewayatId?: string): void => {
      router.replace('/(tabs)/(a.home)');
      setTimeout(() => {
        router.push({
          pathname: '/(tabs)/(a.home)/reciter/[id]',
          params: {id: reciter.id, ...(rewayatId ? {rewayatId} : {})},
        });
      }, 100);
    };

    // The requested rewayah when it has the surah, else the first rewayah that
    // has it. A reciter's first rewayah need not have every surah (#732): a
    // track for a rewayah without the surah gives a player that cannot play.
    const rw = findRewayatForSurah(reciter, surahNum, rewayah);
    if (!rw) {
      showToast(
        i18n.t('qariah:deepLink.recitationUnavailableTitle'),
        i18n.t('qariah:deepLink.recitationUnavailableBody'),
        'error',
      );
      openReciterProfile();
      return;
    }

    const surahMeta = SURAHS.find(s => s.id === surahNum);
    const artwork = getReciterArtwork(reciter);
    const track = {
      id: `${reciter.id}:${surahNum}`,
      url: generateSmartAudioUrl(reciter, surahNum.toString(), rw.id),
      title: surahMeta
        ? getSurahDisplayName(surahMeta)
        : i18n.t('common:labels.surahNumber', {number: surahNum}),
      artist: reciter.name,
      reciterId: reciter.id,
      artwork,
      surahId: surahNum.toString(),
      reciterName: reciter.name,
      rewayatId: rw.id,
    };

    const startPlaybackAndNavigate = async (): Promise<void> => {
      await usePlayerStore.getState().updateQueue([track], 0);

      const tSec = t ? parseInt(t, 10) : NaN;
      if (!Number.isNaN(tSec) && tSec > 0) {
        try {
          await usePlayerStore.getState().seekTo(tSec);
        } catch {
          // Seek failures are non-fatal — playback still starts at 0.
        }
      }

      openReciterProfile(rw.id);
    };

    startPlaybackAndNavigate();
  }, [isInitialized, slug, surah, rewayah, t, router]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.background,
      }}>
      <ActivityIndicator color={theme.colors.text} />
    </View>
  );
}
// @ai-end
