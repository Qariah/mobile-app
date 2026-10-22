import {useEffect, useRef} from 'react';
import {Alert, Linking, Platform} from 'react-native';
import {useBackgroundPlaybackStore} from '@/store/backgroundPlaybackStore';
import branding from '@/config/branding';

/** Re-prompt only after a NEW kill at least this long after the last prompt. */
const REPROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
/** Never show the kill-triggered prompt more than this many times, ever. */
const MAX_PROMPTS = 3;

/**
 * The battery-unrestrict guidance, shared by the kill-triggered prompt below
 * and the Settings → Audio & Playback → Background Playback row (always
 * discoverable there, independent of the prompt's bounds).
 */
export function showBackgroundPlaybackGuide(): void {
  Alert.alert(
    'Keep audio playing in the background',
    `On some phones the system stops ${branding.appName}’s audio when the ` +
      'screen is off or the app is in the background. To fix it, open ' +
      `Settings and set ${branding.appName}’s Battery usage to “Unrestricted”.`,
    [
      {text: 'Not now', style: 'cancel'},
      {text: 'Open Settings', onPress: () => void Linking.openSettings()},
    ],
  );
}

/**
 * S33.2 + fast-follow — kill-triggered "keep audio playing in the background"
 * prompt. Shown only to users who actually hit an OEM background-audio kill:
 * the audio pipeline records kills in `backgroundPlaybackStore` from the
 * reliably-caught process-death path (`playback-killed-in-background`,
 * consumed in `app/_layout.tsx`) and the best-effort silent player-death path
 * (`ExpoAudioProvider`). Root cause + repro:
 * planning/background-audio-kill-diagnosis-2026-06-10.md.
 *
 * BOUNDED, not one-shot: the first kill prompts immediately; afterwards only
 * a NEW kill (later than the last prompt) AND ≥7 days of cooldown re-prompts
 * — recurring kills are the only available "the user didn't (or couldn't) fix
 * it" signal, since Android exposes no API to read the app's restriction
 * state. Hard cap of 3 showings ever, so it can never become a nag. The
 * Settings → Background Playback row stays available past the cap.
 *
 * Subscribes to the store reactively, so it fires whether the kill was
 * hydrated from a prior session (persisted) or recorded live this session —
 * no AppState-listener ordering race. `shownRef` guards once-per-session.
 * Android-only.
 */
export function useBackgroundPlaybackPrompt(): void {
  const shownRef = useRef(false);
  const lastKillAt = useBackgroundPlaybackStore(s => s.lastKillAt);
  const lastPromptAt = useBackgroundPlaybackStore(s => s.lastPromptAt);
  const promptCount = useBackgroundPlaybackStore(s => s.promptCount);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (shownRef.current) return;
    if (lastKillAt == null || promptCount >= MAX_PROMPTS) return;
    if (promptCount > 0) {
      const promptedAt = lastPromptAt ?? 0;
      const isNewKill = lastKillAt > promptedAt;
      const cooledDown = Date.now() - promptedAt >= REPROMPT_COOLDOWN_MS;
      if (!isNewKill || !cooledDown) return;
    }

    shownRef.current = true;
    // Record at display time (not on button press) so a dismissal-by-any-path
    // still counts against the cooldown + cap.
    useBackgroundPlaybackStore.getState().recordPromptShown();
    showBackgroundPlaybackGuide();
  }, [lastKillAt, lastPromptAt, promptCount]);
}

/**
 * S39.2 (#104) — guidance shown when the POST_NOTIFICATIONS permission is
 * blocked, used by the one-time prompt below. Distinct from the
 * battery-restriction guide: a blocked notification means the media
 * foreground-service notification can't post at all, so OEMs kill background
 * playback (and the lock-screen / notification controls never appear).
 */
export function showNotificationsBlockedGuide(): void {
  Alert.alert(
    'Allow notifications to play in the background',
    `${branding.appName} uses a playback notification to keep audio running ` +
      'when the screen is off or the app is in the background. Notifications ' +
      'are currently blocked, so background audio may stop. Open Settings to ' +
      'allow notifications.',
    [
      {text: 'Not now', style: 'cancel'},
      {text: 'Open Settings', onPress: () => void Linking.openSettings()},
    ],
  );
}

/**
 * S39.2 (#104) — one-time "allow notifications" prompt, shown only when the
 * audio provider observed that POST_NOTIFICATIONS is denied (Android 13+). The
 * provider records the denial in `backgroundPlaybackStore.notificationsDenied`
 * (and clears it if the permission is later granted), so this fires whether
 * the denial was hydrated from a prior session or recorded live.
 *
 * ONE-SHOT (not the bounded-reprompt of the kill path): the system permission
 * prompt is itself one-per-install, so re-asking on every boot would be a nag
 * with no new information. After the single showing the Settings →
 * Background Playback row remains the discoverable fallback. `shownRef` guards
 * once-per-session; `notificationsPromptShown` guards once-ever. Android-only;
 * a no-op on iOS and whenever the permission is granted (`notificationsDenied`
 * stays false / is cleared).
 */
export function useNotificationsDeniedPrompt(): void {
  const shownRef = useRef(false);
  const notificationsDenied = useBackgroundPlaybackStore(
    s => s.notificationsDenied,
  );
  const notificationsPromptShown = useBackgroundPlaybackStore(
    s => s.notificationsPromptShown,
  );

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (shownRef.current) return;
    if (!notificationsDenied || notificationsPromptShown) return;

    let cancelled = false;
    void (async () => {
      // The persisted `notificationsDenied` can be stale: the audio provider
      // clears it async on a later cold start if the user granted in the
      // meantime, but this effect may fire first. Re-check live so we never
      // show a "notifications are blocked" Alert to a user who just granted.
      try {
        const Notifications = await import('expo-notifications');
        const perm = await Notifications.getPermissionsAsync();
        if (perm?.status === 'granted') {
          useBackgroundPlaybackStore.setState({notificationsDenied: false});
          return;
        }
      } catch {
        // Live check unavailable — fall through to the persisted-state decision.
      }
      if (cancelled || shownRef.current) return;
      shownRef.current = true;
      // Record at display time so a dismissal-by-any-path still counts.
      useBackgroundPlaybackStore.getState().recordNotificationsPromptShown();
      showNotificationsBlockedGuide();
    })();
    return () => {
      cancelled = true;
    };
  }, [notificationsDenied, notificationsPromptShown]);
}
