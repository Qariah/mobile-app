// @ai-generated
// Qariah (#680): the reading aids that "Arabic text only" saved are persisted,
// so that turning the switch off after a restart still gives them back.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ARABIC_ONLY_STORE_NAME, useArabicOnlyStore} from '../arabicOnlyStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const SAVED = {
  showTranslation: false,
  showTransliteration: true,
  showWBW: true,
};

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await useArabicOnlyStore.persist.rehydrate();
  useArabicOnlyStore.setState({savedAids: null});
});

it('writes the saved set to storage', async () => {
  useArabicOnlyStore.getState().setSavedAids(SAVED);
  await settle();

  const raw = await AsyncStorage.getItem(ARABIC_ONLY_STORE_NAME);
  expect(raw && JSON.parse(raw).state.savedAids).toEqual(SAVED);
});

it('reads the saved set back after a restart', async () => {
  // The memory state is empty (a new process); only storage has the set.
  // A set() also writes storage, so it must finish before the stored value.
  await settle();
  await AsyncStorage.setItem(
    ARABIC_ONLY_STORE_NAME,
    JSON.stringify({state: {savedAids: SAVED}, version: 1}),
  );

  await useArabicOnlyStore.persist.rehydrate();

  expect(useArabicOnlyStore.getState().savedAids).toEqual(SAVED);
});

it('starts with nothing saved', async () => {
  await AsyncStorage.clear();
  useArabicOnlyStore.setState({savedAids: null});
  await useArabicOnlyStore.persist.rehydrate();

  expect(useArabicOnlyStore.getState().savedAids).toBeNull();
});
