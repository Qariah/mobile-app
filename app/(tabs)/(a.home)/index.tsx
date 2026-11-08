import React, {useCallback, useLayoutEffect} from 'react';
import {useRouter, useNavigation} from 'expo-router';
import RecitersView from '@/components/RecitersView';
import {Reciter} from '@/data/reciterData';
// @ai Qariah: a reader that the launch restores opens first.
import {
  ListenWaitingForReader,
  useListenWaitsForReader,
} from '@/hooks/useListenWaitsForReader';

function HomeScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const waitForReader = useListenWaitsForReader(); // @ai

  useLayoutEffect(() => {
    navigation.setOptions({headerShown: false});
  }, [navigation]);

  const handleReciterPress = useCallback(
    (reciter: Reciter) => {
      router.push({
        pathname: '/(tabs)/(a.home)/reciter/[id]',
        params: {id: reciter.id},
      });
    },
    [router],
  );

  if (waitForReader) return <ListenWaitingForReader />; // @ai
  return <RecitersView onReciterPress={handleReciterPress} />;
}

export default React.memo(HomeScreen);
