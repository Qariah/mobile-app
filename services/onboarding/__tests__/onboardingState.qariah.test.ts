// @ai-generated
// Qariah: the onboarding flag keeps the AsyncStorage key that every shipped
// build used. A new key would show onboarding again to every user.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {isOnboarded, markOnboarded, resetOnboarded} from '../onboardingState';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => '1'),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

const KEY = '@qariah:onboarded';

it('reads, writes and removes the @qariah:onboarded key', async () => {
  await expect(isOnboarded()).resolves.toBe(true);
  expect(AsyncStorage.getItem).toHaveBeenCalledWith(KEY);

  await markOnboarded();
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(KEY, '1');

  await resetOnboarded();
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith(KEY);
});
