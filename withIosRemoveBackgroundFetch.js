/**
 * Expo config plugin: remove the `fetch` iOS background mode.
 *
 * WHY (Sprint 48, S48.6):
 * `expo-task-manager` is a "legacy" Expo package, so `expo prebuild` applies
 * its config plugin on its own (even when `app.config.ts` does not list it),
 * and that plugin adds `fetch` to UIBackgroundModes. Qariah uses
 * `expo-background-task` (the `processing` mode and BGTaskScheduler), not the
 * old background fetch, so `fetch` would declare a background mode that no
 * code uses. This plugin removes it and keeps every other mode (`audio`,
 * `remote-notification`, `processing`).
 *
 * ORDER: Expo runs the Info.plist mods in the REVERSE order of registration.
 * The auto plugin of `expo-task-manager` is registered after the plugins of
 * `app.config.ts`, so its mod runs first and this mod runs after it.
 *
 * The committed `ios/Qariah/Info.plist` is also edited directly (the build
 * uses the committed file when no prebuild runs); this plugin keeps a
 * re-prebuild from adding `fetch` again.
 */

const {withInfoPlist} = require('@expo/config-plugins');

const BACKGROUND_FETCH_MODE = 'fetch';

const withIosRemoveBackgroundFetch = config => {
  return withInfoPlist(config, cfg => {
    const modes = cfg.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) {
      cfg.modResults.UIBackgroundModes = modes.filter(
        mode => mode !== BACKGROUND_FETCH_MODE,
      );
    }
    return cfg;
  });
};

module.exports = withIosRemoveBackgroundFetch;
