// @ai Qariah (Lite mode plan, section 7h) — the Listen route while a reader
// that the launch restores opens (services/mushaf/readerRestoreGate.ts).
import React, {useEffect} from 'react';
import {View} from 'react-native';
import {useNavigation} from 'expo-router';
import {
  endReaderRestore,
  useListenWaitingForReader,
} from '@/services/mushaf/readerRestoreGate';

/** True while Listen waits for the restored reader. A return to Listen (a
 *  focus after a blur) ends the wait at once. */
export function useListenWaitsForReader(): boolean {
  const waiting = useListenWaitingForReader();
  const navigation = useNavigation();
  useEffect(() => {
    if (!waiting) return undefined;
    let blurred = false;
    const offBlur = navigation.addListener('blur', () => {
      blurred = true;
    });
    const offFocus = navigation.addListener('focus', () => {
      if (blurred) endReaderRestore();
    });
    return () => {
      offBlur();
      offFocus();
    };
  }, [navigation, waiting]);
  return waiting;
}

/** The empty Listen screen under the restored reader. */
export function ListenWaitingForReader() {
  return <View style={{flex: 1}} testID="listen-waiting-for-reader" />;
}
