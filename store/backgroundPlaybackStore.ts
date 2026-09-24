import {create} from 'zustand';
import {persist} from 'zustand/middleware';
import {guardedJSONStorage} from '@/services/storage/hydrationGuardedStorage';

/**
 * S33.2 + fast-follow — background-playback health state.
 *
 * The audio pipeline calls `recordKill` when it observes an INVOLUNTARY
 * background stop: a prior-launch mid-playback process death (the MMKV
 * playback sentinel, consumed in `app/_layout.tsx`) or a silent player death
 * caught on foreground (`ExpoAudioProvider`). That is the OEM
 * battery-restriction path (Samsung "Sleeping apps" → the system stops the
 * media foreground service "due to app idle" — see
 * planning/background-audio-kill-diagnosis-2026-06-10.md).
 *
 * `useBackgroundPlaybackPrompt` turns this into a BOUNDED battery-unrestrict
 * prompt: the first kill prompts immediately; after that only a NEW kill at
 * least 7 days after the last prompt re-prompts, capped at 3 showings ever.
 * Android exposes no API to read whether the user actually set Battery usage
 * to "Unrestricted" (react-native-device-info v14 dropped the check), so a
 * recurring kill IS the "still broken" signal. Android-only in practice.
 */
interface BackgroundPlaybackState {
  /** Last time an involuntary background stop was detected (ms epoch). */
  lastKillAt: number | null;
  /** Last time the battery-unrestrict prompt was shown (ms epoch). */
  lastPromptAt: number | null;
  /** Total times the prompt has been shown. */
  promptCount: number;
  /**
   * S39.2 (#104) — set true when the audio provider observes that the
   * POST_NOTIFICATIONS permission is denied (Android 13+). Without it the
   * media foreground-service notification can't post, so aggressive OEMs kill
   * background playback. A distinct failure from the OEM battery-restriction
   * path above.
   */
  notificationsDenied: boolean;
  /**
   * S39.2 (#104) — whether the notifications-blocked guidance has been shown.
   * The prompt is one-shot (unlike the bounded-reprompt kill path): once the
   * user has seen it, the Settings → Background Playback row stays the
   * discoverable fallback.
   */
  notificationsPromptShown: boolean;
  recordKill: () => void;
  recordPromptShown: () => void;
  recordNotificationsDenied: () => void;
  recordNotificationsPromptShown: () => void;
}

export const useBackgroundPlaybackStore = create<BackgroundPlaybackState>()(
  persist(
    set => ({
      lastKillAt: null,
      lastPromptAt: null,
      promptCount: 0,
      notificationsDenied: false,
      notificationsPromptShown: false,
      recordKill: () => set({lastKillAt: Date.now()}),
      recordPromptShown: () =>
        set(s => ({lastPromptAt: Date.now(), promptCount: s.promptCount + 1})),
      recordNotificationsDenied: () => set({notificationsDenied: true}),
      recordNotificationsPromptShown: () =>
        set({notificationsPromptShown: true}),
    }),
    {
      name: 'background-playback',
      storage: guardedJSONStorage('background-playback'),
      version: 2,
      // v0 (build 1301) persisted `{stopDetected, promptDismissed}` booleans.
      // Map a dismissed prompt to "shown once just now" so upgrading users are
      // not immediately re-prompted — they re-qualify only via a NEW kill
      // landing ≥7 days after the upgrade.
      // v1 → v2 (S39.2) just adds the two notifications-* fields, defaulted off.
      migrate: (persisted, version) => {
        if (version === 0) {
          const old = persisted as {
            stopDetected?: boolean;
            promptDismissed?: boolean;
          };
          const now = Date.now();
          return {
            lastKillAt: old.stopDetected ? now : null,
            lastPromptAt: old.promptDismissed ? now : null,
            promptCount: old.promptDismissed ? 1 : 0,
            notificationsDenied: false,
            notificationsPromptShown: false,
          } as BackgroundPlaybackState;
        }
        if (version === 1) {
          // Explicitly map the v1 state fields (no spread of the full type —
          // that would pull the action-function types into the cast source and
          // mask a future regression). Zustand overlays the real actions over
          // this return.
          const old = persisted as Pick<
            BackgroundPlaybackState,
            'lastKillAt' | 'lastPromptAt' | 'promptCount'
          >;
          return {
            lastKillAt: old.lastKillAt ?? null,
            lastPromptAt: old.lastPromptAt ?? null,
            promptCount: old.promptCount ?? 0,
            notificationsDenied: false,
            notificationsPromptShown: false,
          } as BackgroundPlaybackState;
        }
        return persisted as BackgroundPlaybackState;
      },
    },
  ),
);
