/**
 * Expo config plugin: add Android 13+ POST_NOTIFICATIONS permission so the
 * expo-audio background-playback foreground service can keep its media
 * notification posted.
 *
 * Why: Android 13 (API 33+) gates ALL notification posting behind the
 * `android.permission.POST_NOTIFICATIONS` runtime permission. The media
 * notification posted by expo-audio's `AudioControlsService` is what
 * makes the foreground service eligible to stay alive past the OS's
 * background-kill timer. On vanilla Android the absence of POST_NOTIFICATIONS
 * is mostly cosmetic (service may still play briefly), but Samsung One UI
 * 6.1, OnePlus OxygenOS, and Xiaomi MIUI all interpret a missing notification
 * as a strong signal that the service is "abandoned" — they kill it within
 * seconds of the app being backgrounded.
 *
 * Symptom: user starts playing audio, presses home, returns to the app a
 * few minutes later — mini-player shows the play button (not pause), audio
 * has stopped, the "Continue Listening" card has appeared with a fresh
 * position. The foreground service was killed mid-track.
 *
 * Expo-audio's own plugin only adds POST_NOTIFICATIONS when
 * `enableBackgroundRecording=true`; it should also add it when
 * `enableBackgroundPlayback=true` since the playback foreground service
 * has the same notification requirement. Filed as a goodwill upstream PR
 * candidate against expo/expo (track in TECH_DEBT for Sprint 25).
 *
 * Sprint 24 S24.1 (FB-1) — addresses Greta's Samsung Galaxy A55 / Android 14 /
 * One UI 6.1 feedback that audio stops when backgrounding.
 */

const {withAndroidManifest} = require('@expo/config-plugins');

const POST_NOTIFICATIONS = 'android.permission.POST_NOTIFICATIONS';

const withAndroidNotificationPermission = config => {
  return withAndroidManifest(config, async cfg => {
    const manifest = cfg.modResults.manifest;
    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }

    const already = manifest['uses-permission'].some(
      entry => entry?.$?.['android:name'] === POST_NOTIFICATIONS,
    );
    if (!already) {
      manifest['uses-permission'].push({
        $: {'android:name': POST_NOTIFICATIONS},
      });
    }

    return cfg;
  });
};

module.exports = withAndroidNotificationPermission;
