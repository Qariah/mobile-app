/**
 * Onboarding stack layout.
 *
 * First-launch flow: welcome → sign-in → done. The router pushes here from
 * `app/_layout.tsx` when `@qariah:onboarded` is unset; on completion the
 * flow writes the flag and replaces the stack with `/(tabs)/(a.home)`.
 *
 * Qariah-only addition. Upstream has no auth and no first-launch flow beyond
 * the WhatsNewModal (which still runs for version-bump pages).
 */

import {Stack} from 'expo-router';
import React from 'react';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        gestureEnabled: false,
      }}
    />
  );
}
