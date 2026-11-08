import {useEffect} from 'react';
import {usePlayerStore} from '@/services/player/store/playerStore';
import {selectForegroundQueue} from '@/services/player/store/foregroundPlayerState'; // @ai Qariah: no new views in the background
import {useTimestampStore} from '@/store/timestampStore';

export function useTimestampLoader() {
  const queue = usePlayerStore(selectForegroundQueue);
  const currentTrack = queue?.tracks?.[queue?.currentIndex ?? -1];
  const rewayatId = currentTrack?.rewayatId;
  const surahId = currentTrack?.surahId;

  useEffect(() => {
    if (!rewayatId || !surahId) {
      useTimestampStore.getState().clearCurrentTimestamps();
      return;
    }

    const surahNumber = parseInt(surahId, 10);
    if (isNaN(surahNumber)) {
      useTimestampStore.getState().clearCurrentTimestamps();
      return;
    }

    useTimestampStore.getState().loadTimestampsForSurah(rewayatId, surahNumber);
  }, [rewayatId, surahId]);
}
