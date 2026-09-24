/**
 * Persistence for whether the user has completed first-launch onboarding.
 *
 * Backed by AsyncStorage. Single key, boolean value. Read on app boot to
 * decide whether to redirect into the onboarding stack.
 *
 * Qariah-only — upstream has no first-launch sign-in flow.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import branding from '@/config/branding';

const KEY = `${branding.storageKeyPrefix}:onboarded`;

export async function isOnboarded(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === '1';
  } catch {
    // If storage is unreachable, treat as not-onboarded so the user is
    // greeted properly on first install (vs. skipping into a blank app).
    return false;
  }
}

export async function markOnboarded(): Promise<void> {
  await AsyncStorage.setItem(KEY, '1');
}

export async function resetOnboarded(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
