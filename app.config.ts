import type {ExpoConfig} from 'expo/config';

import branding from './config/branding';

// Import version information from Git-based generator
// eslint-disable-next-line @typescript-eslint/no-var-requires
const versionInfo = require('./scripts/generate-version');

// ─── Fork-configurable identifiers ───────────────────────────────────────────
// Defaults are the maintainer's values so local builds work with no extra
// setup. Forks override via environment variables documented in .env.example.
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID ?? 'S4W5Q2L53W';
const EAS_PROJECT_ID_FROM_ENV = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
const EAS_PROJECT_ID =
  EAS_PROJECT_ID_FROM_ENV ?? '9da1070a-0852-40df-ac56-6f97a1dce359';
// Only enable Expo OTA updates when the EAS project ID is explicitly set via
// env. Forks that don't set it get no update checks (no phone-home to the
// maintainer's Expo project).
const OTA_UPDATES_ENABLED = Boolean(EAS_PROJECT_ID_FROM_ENV);
// Associated/deep-link domain. Forks must set their own; leaving unset means
// no universal-link registration, avoiding conflicts with the maintainer's app.
const ASSOCIATED_DOMAIN =
  process.env.EXPO_PUBLIC_ASSOCIATED_DOMAIN ?? branding.associatedDomain;
const PRIVACY_POLICY_URL =
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL ?? branding.privacyUrl;

// Secondary URL scheme used as the OAuth callback host. The QF OAuth client
// registered the redirect URI `com.qariah.app:/quranoauth2redirect`.
//
// This scheme is needed on ANDROID (its Chrome-Custom-Tabs OAuth flow returns
// the redirect to the app via the `com.qariah.app` intent-filter) but is
// HARMFUL on iOS: ASWebAuthenticationSession captures the callback scheme at
// the session level without it being registered, and registering it as an app
// URL scheme makes iOS deliver the redirect via openURL — foregrounding the
// app and cancelling the auth session, so sign-in silently fails to persist
// (the 2026-06 public-beta breakage). It stays in `scheme` for Android; the
// `withIosRemoveOAuthCallbackScheme.js` plugin strips it from iOS at prebuild.
// See services/auth/config.ts and planning/adr-qariah-0002-auth-and-user-state.md.
const OAUTH_CALLBACK_SCHEME = 'com.qariah.app';

const config: ExpoConfig = {
  name: branding.appName,
  slug: branding.appSlug,
  scheme: [branding.urlScheme, OAUTH_CALLBACK_SCHEME],
  version: versionInfo.semanticVersion,
  orientation: 'portrait',
  cli: {
    appVersionSource: 'remote',
    version: '>= 5.9.1',
  },
  ios: {
    bundleIdentifier: branding.bundleId.ios,
    buildNumber: versionInfo.buildNumber,
    supportsTablet: true,
    config: {
      usesNonExemptEncryption: false,
    },
    // @ts-expect-error -- `teamId` is a runtime-supported but not-yet-typed Expo
    // config field. Tracked upstream at expo/expo (the IOS type def lags the
    // runtime; teamId is consumed by withIOSTeam.js + xcodebuild). Inherited
    // bug #19, closed in qariah-v2 Sprint 6 (S6.7).
    teamId: APPLE_TEAM_ID,
    // Upstream Pass B (fca03eed): @bacons/apple-targets signs the widget
    // extension with this team.
    appleTeamId: APPLE_TEAM_ID,
    ...(ASSOCIATED_DOMAIN
      ? {associatedDomains: [`applinks:${ASSOCIATED_DOMAIN}`]}
      : {}),
    infoPlist: {
      // Upstream Pass B (fca03eed, RFC-021): the App Group the widgets and the
      // Live Activity share with the app. Upstream reads IOS_BUNDLE_ID; Qariah
      // derives it from branding (group.com.qariah.app).
      BayaanAppGroup: `group.${branding.bundleId.ios}`,
      NSSupportsLiveActivities: true,
      NSAppleMusicUsageDescription: 'This app uses Apple Music to play audio.',
      UILaunchStoryboardName: 'SplashScreen',
      LSRequiresIPhoneOS: true,
      // @ai Qariah (TECH_DEBT #270): false matches what ships. The committed
      // ios/Qariah/Info.plist and every shipped build have false, so iPad
      // Split View and Stage Manager stay on. Change it only with an iPad test.
      UIRequiresFullScreen: false,
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription: 'This app does not use the camera.',
      // So Linking.canOpenURL('mailto:') returns true on iOS 9+ (schemes must
      // be whitelisted here or canOpenURL always returns false). Settings →
      // Help & Support / Feature Requests open mailto: to branding.supportEmail.
      // Mirrored into the committed ios/*/Info.plist so it ships without a
      // re-prebuild (keep both in sync — Sprint 32).
      LSApplicationQueriesSchemes: ['mailto'],
      // Qariah (Sprint 48, S48.6): the `expo-background-task` plugin (in
      // `plugins` below) appends `com.expo.modules.backgroundtask.processing`
      // to this list and `processing` to UIBackgroundModes. The legacy
      // `expo-task-manager` auto-plugin appends `fetch`, and
      // ./withIosRemoveBackgroundFetch.js removes it again. Keep both lists
      // as they are here; the plugins change them.
      BGTaskSchedulerPermittedIdentifiers: [`${branding.bundleId.ios}.audio`],
      UIBackgroundModes: ['audio', 'remote-notification'],
      // CFBundleURLTypes intentionally omitted: Expo auto-generates URL
      // schemes from the top-level `scheme` field above (which is the
      // `[branding.urlScheme, OAUTH_CALLBACK_SCHEME]` array). Setting this
      // explicitly here as well causes a nested-array merge that breaks
      // expo-share-intent's plugin compatibility check.
      NSPrivacyPolicyURL: PRIVACY_POLICY_URL,
      UISupportedInterfaceOrientations: [
        'UIInterfaceOrientationPortrait',
        'UIInterfaceOrientationLandscapeLeft',
        'UIInterfaceOrientationLandscapeRight',
      ],
      'UISupportedInterfaceOrientations~ipad': [
        'UIInterfaceOrientationPortrait',
        'UIInterfaceOrientationPortraitUpsideDown',
        'UIInterfaceOrientationLandscapeLeft',
        'UIInterfaceOrientationLandscapeRight',
      ],
    },
    icon: {
      dark: branding.assets.appIcon.ios.dark,
      light: branding.assets.appIcon.ios.light,
      tinted: branding.assets.appIcon.ios.tinted,
    },
  },
  fonts: [
    'assets/fonts/Manrope-Regular.ttf',
    'assets/fonts/Manrope-Bold.ttf',
    'assets/fonts/Manrope-Medium.ttf',
    'assets/fonts/Manrope-SemiBold.ttf',
    'assets/fonts/Manrope-Light.ttf',
    'assets/fonts/Manrope-ExtraLight.ttf',
    'assets/fonts/Manrope-ExtraBold.ttf',
    'assets/fonts/surah_names.ttf',
    'assets/fonts/surah_names_2.ttf',
    'assets/fonts/ScheherazadeNew-Regular.ttf',
    'assets/fonts/ScheherazadeNew-Medium.ttf',
    'assets/fonts/ScheherazadeNew-Bold.ttf',
    'assets/fonts/ScheherazadeNew-SemiBold.ttf',
  ],
  extra: {
    // Add your environment variables here
    eas: {
      projectId: EAS_PROJECT_ID,
    },
    isDevelopmentMode: false,
    // Add version information for runtime access
    version: {
      semanticVersion: versionInfo.semanticVersion,
      buildNumber: versionInfo.buildNumber,
      gitHash: versionInfo.gitHash,
      gitBranch: versionInfo.gitBranch,
      buildTime: versionInfo.buildTime,
      fullVersion: versionInfo.fullVersion,
    },
  },
  android: {
    package: branding.bundleId.android,
    versionCode: versionInfo.versionCode,
    userInterfaceStyle: 'automatic',
    adaptiveIcon: {
      foregroundImage: branding.assets.appIcon.androidAdaptive.foregroundImage,
      backgroundColor: branding.assets.appIcon.androidAdaptive.backgroundColor,
    },
    // @ts-expect-error -- `screenOrientation` on Android is runtime-supported
    // (consumed by Expo to configure AndroidManifest.xml) but not typed in
    // expo's Android config. Tracked upstream at expo/expo. Inherited bug
    // #19, closed in qariah-v2 Sprint 6 (S6.7).
    screenOrientation: 'portrait',
    ...(ASSOCIATED_DOMAIN
      ? {
          intentFilters: [
            {
              action: 'VIEW',
              autoVerify: true,
              data: [
                {
                  scheme: 'https',
                  host: ASSOCIATED_DOMAIN,
                  pathPrefix: '/quran',
                },
                {
                  scheme: 'https',
                  host: ASSOCIATED_DOMAIN,
                  pathPrefix: '/reciter',
                },
                {
                  scheme: 'https',
                  host: ASSOCIATED_DOMAIN,
                  pathPrefix: '/mushaf',
                },
                {
                  scheme: 'https',
                  host: ASSOCIATED_DOMAIN,
                  pathPrefix: '/adhkar',
                },
              ],
              category: ['BROWSABLE', 'DEFAULT'],
            },
          ],
        }
      : {}),
  },
  // @ai Qariah (Sprint 47, Pass C Task 7): the home-screen name per device
  // language ("قارئة" in Arabic, README decision 1). Expo writes the `ios`
  // values of each file to ios/Qariah/Supporting/<lang>.lproj/InfoPlist.strings
  // and the `android` values to res/values-b+<lang>/strings.xml.
  // scripts/native-strings-from-review.mjs writes the file from the review
  // pack; scripts/ios-archive.sh gives the beta name to these files too. The
  // widget text is in withQariahNativeStrings.js (Android) and
  // targets/widgets/_shared/Localizable.xcstrings (iOS).
  locales: {
    ar: './i18n/native/ar.json',
  },
  // React Compiler disabled - causes performance issues with Zustand subscriptions
  // experiments: {
  //   reactCompiler: true,
  // },
  updates: OTA_UPDATES_ENABLED
    ? {
        enabled: true,
        checkAutomatically: 'ON_LOAD',
        fallbackToCacheTimeout: 2000,
        url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
      }
    : {enabled: false},
  // Required by EAS Update. Bare workflow (has ios/ + android/ dirs)
  // doesn't support `{ policy: 'appVersion' }` — must be a literal
  // string. Tying it to versionInfo.semanticVersion means each version
  // bump produces a fresh runtime channel: 3.1.1 dev clients won't
  // accept 3.1.2 bundles, which prevents JS-only updates from being
  // delivered to native binaries that lack the matching native code.
  runtimeVersion: versionInfo.semanticVersion,
  plugins: [
    'expo-router',
    // Upstream Pass C (91c63554, Bayaan #349): the Arabic UI. Direction comes
    // from the in-app language preference. A static supportsRTL/forcesRTL
    // resets I18nManager to the device locale on iOS.
    // @ai Qariah (TECH_DEBT #291): allowDynamicLocaleChangesAndroid:false keeps
    // MainActivity configChanges as upstream ships it (no locale or
    // layoutDirection). The plugin default (true) added both on every Android
    // prebuild. The app relaunches its process for a language change.
    [
      'expo-localization',
      {
        supportedLocales: {ios: ['en', 'ar']},
        allowDynamicLocaleChangesAndroid: false,
      },
    ],
    // Upstream Pass B (fca03eed): generates the widget extension target from
    // targets/widgets/.
    '@bacons/apple-targets',
    // Qariah is playback-only (Sprint 32 — privacy hygiene).
    // microphonePermission:false stops NSMicrophoneUsageDescription (iOS).
    // recordAudioAndroid:false stops RECORD_AUDIO (Android); without it every
    // Android prebuild added the permission back (TECH_DEBT #291).
    [
      'expo-audio',
      {
        enableBackgroundPlayback: true,
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    'expo-sqlite',
    // Upstream Pass C (91c63554, Bayaan #345, SDK 57): config plugins with no
    // options.
    'expo-asset',
    'expo-font',
    'expo-image',
    'expo-sharing',
    'expo-status-bar',
    'expo-web-browser',
    [
      'expo-splash-screen',
      {
        image: branding.assets.splash.image,
        resizeMode: 'native',
        backgroundColor: branding.assets.splash.backgroundColor,
        imageResizeMode: 'native',
        imageWidth: 500,
        dark: {
          image: branding.assets.splash.imageDark,
          backgroundColor: branding.assets.splash.backgroundColorDark,
        },
        android: {
          image: branding.assets.splash.image,
          dark: {
            image: branding.assets.splash.imageDark,
          },
        },
        userInterfaceStyle: 'automatic',
      },
    ],
    [
      'expo-notifications',
      {
        icon: branding.assets.appIcon.androidNotification,
        color: '#ffffff',
        sounds: [],
      },
    ],
    // Qariah (Sprint 48, S48.6): the background catalog check of the local
    // notifications (services/notifications/backgroundTask.ts). iOS:
    // BGTaskScheduler (the `processing` mode and the
    // `com.expo.modules.backgroundtask.processing` identifier). Android:
    // WorkManager (no manifest entry of its own).
    'expo-background-task',
    // Qariah (Sprint 48, S48.6): remove the unused `fetch` mode that the
    // expo-task-manager auto-plugin adds (see the plugin file).
    './withIosRemoveBackgroundFetch.js',
    [
      'expo-share-intent',
      {
        iosActivationRules: {
          NSExtensionActivationSupportsFileWithMaxCount: 10,
        },
        androidIntentFilters: ['audio/*'],
        androidMultiIntentFilters: ['audio/*'],
      },
    ],
    // Only wire up the Sentry Expo plugin (adds the source-map + debug-symbol
    // upload build phases) when a DSN is configured. Forks/contributors
    // without Sentry credentials can build and archive without running the
    // upload scripts.
    ...(process.env.EXPO_PUBLIC_SENTRY_DSN
      ? [
          [
            '@sentry/react-native/expo',
            {
              organization: process.env.SENTRY_ORG ?? branding.appSlug,
              project: process.env.SENTRY_PROJECT ?? branding.appSlug,
            },
          ] as [string, Record<string, unknown>],
        ]
      : []),
    './withAndroidSigning.js',
    './withLargeHeap.js',
    './withIOSTeam.js',
    './withRemoveAdIdPermission.js',
    './withAndroidNotificationPermission.js',
    './withIosRemoveOAuthCallbackScheme.js',
    // Qariah (ANR WS-C, H1): Android non-blocking boot splash + lab BuildConfig.
    './withNonBlockingSplash.js',
    // Upstream Pass B (fca03eed): CarPlay, Android Auto, Siri, App Shortcuts
    // and the native widgets. Owner decisions 2026-10-18 (Sprint 46): no
    // CarPlay audio entitlement until Apple grants it (O1), and Siri off (O2).
    // withBayaanWidgets reads scheme[0], so `scheme` must keep
    // branding.urlScheme first (the OAuth callback scheme second).
    [
      './plugins/withBayaanCar.js',
      {carPlayAudioEntitlement: false, siri: false},
    ],
    './plugins/withAppShortcuts.js',
    './plugins/withBayaanWidgets.js',
    // Qariah (Sprint 47, Pass C): the widget-picker text in Arabic
    // (res/values-ar/bayaan_widgets.xml, from i18n/native/widget-strings.json).
    './withQariahNativeStrings.js',
  ],
};

export default {expo: config};
