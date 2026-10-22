/**
 * Expo config plugin: Android non-blocking boot splash (Qariah, ANR
 * investigation WS-C, hypothesis H1).
 *
 * expo-splash-screen holds the splash with an OnPreDrawListener that blocks
 * the first draw of the app window until JS calls hideAsync(). An undrawn
 * window gets no input focus, so a BACK or VOLUME key during a long boot ANRs
 * with "Input dispatching timed out (No focused window)".
 *
 * This plugin makes two changes. Both are mirrored in the committed native
 * files (android/ is checked in):
 *
 * 1. MainActivity.onCreate, after super.onCreate(null): ask
 *    QariahBootSplash (modules/qariah-boot-splash) whether this launch uses
 *    the non-blocking splash. If yes, call SplashScreenManager.hide() at once
 *    (the pre-draw block never engages) — QariahBootSplash has already added a
 *    native overlay with the splash look, which JS removes when the app is
 *    ready (utils/bootSplash.ts). The default is today's behaviour.
 * 2. app/build.gradle defaultConfig: `BuildConfig.QARIAH_LAB`, false unless
 *    the Gradle property `qariahLab=true` is set. Only a lab build accepts the
 *    launch intent extra `qariah_lab_nonblocking_splash` (same-build A/B).
 *
 * iOS is not touched.
 */

const {withMainActivity, withAppBuildGradle} = require('@expo/config-plugins');
const {addImports} = require('@expo/config-plugins/build/android/codeMod');
const {
  mergeContents,
} = require('@expo/config-plugins/build/utils/generateCode');

const withNonBlockingSplashMainActivity = config =>
  withMainActivity(config, cfg => {
    const {language} = cfg.modResults;
    if (language !== 'kt') {
      throw new Error('withNonBlockingSplash: MainActivity must be Kotlin');
    }
    const withImports = addImports(
      cfg.modResults.contents,
      ['expo.modules.qariahbootsplash.QariahBootSplash'],
      false,
    );
    const merged = mergeContents({
      src: withImports,
      comment: '    //',
      tag: 'qariah-nonblocking-splash',
      offset: 1,
      anchor: /super\.onCreate\(null\)/,
      newSrc: [
        '    if (QariahBootSplash.onActivityCreated(this, BuildConfig.QARIAH_LAB)) {',
        '      SplashScreenManager.hide()',
        '    }',
      ].join('\n'),
    });
    cfg.modResults.contents = merged.contents;
    return cfg;
  });

const withNonBlockingSplashBuildConfig = config =>
  withAppBuildGradle(config, cfg => {
    const merged = mergeContents({
      src: cfg.modResults.contents,
      comment: '        //',
      tag: 'qariah-lab-buildconfig',
      offset: 1,
      anchor: /buildConfigField "String", "REACT_NATIVE_RELEASE_LEVEL"/,
      newSrc:
        '        buildConfigField "boolean", "QARIAH_LAB", "${(findProperty(\'qariahLab\') ?: \'false\').toBoolean()}"',
    });
    cfg.modResults.contents = merged.contents;
    return cfg;
  });

const withNonBlockingSplash = config =>
  withNonBlockingSplashBuildConfig(withNonBlockingSplashMainActivity(config));

module.exports = withNonBlockingSplash;
