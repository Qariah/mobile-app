// Import version information from Git-based generator
const versionInfo = require('./scripts/generate-version');
// Qariah: app identity (config/branding.js, RFC-007) and the iOS App Group rule (TECH_DEBT #289).
const branding = require('./config/branding');
const {appGroupForBundleId} = require('./config/iosAppGroup');
const {
  ARCHIVE_BUNDLE_ID_ENV,
  OAUTH_CALLBACK_SCHEME,
  urlSchemeForBundleId,
} = require('./config/appUrlScheme');

// Get version string
const getVersionString = () => versionInfo.semanticVersion;

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

// The OAuth callback scheme (`com.qariah.app:/quranoauth2redirect`, config/appUrlScheme.js). Android needs it as an
// app scheme. On iOS it breaks ASWebAuthenticationSession, so withIosRemoveOAuthCallbackScheme.js strips it there.

// @ai Qariah (TECH_DEBT #342): the app's own scheme. Only scripts/qariah-ios-archive.sh sets ARCHIVE_BUNDLE_ID_ENV
// (the internal beta gets `qariah-beta`), so the embedded app config names the scheme of that app. Unset: `qariah`.
// Do not set it for a prebuild: the committed ios/ and android/ trees keep the production scheme.
const APP_URL_SCHEME = urlSchemeForBundleId(
  process.env[ARCHIVE_BUNDLE_ID_ENV] || branding.bundleId.ios,
  branding.bundleId.ios,
  branding.urlScheme,
);

// Qariah (TECH_DEBT #289): the App Group of the app, share extension and widget. ios-archive.sh --beta swaps it.
const IOS_APP_GROUP = appGroupForBundleId(branding.bundleId.ios);

// @ai-start
module.exports = {
  expo: {
    name: branding.appName,
    slug: branding.appSlug,
    scheme: [APP_URL_SCHEME, OAUTH_CALLBACK_SCHEME],
    version: getVersionString(),
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
      teamId: APPLE_TEAM_ID,
      appleTeamId: APPLE_TEAM_ID,
      ...(ASSOCIATED_DOMAIN
        ? {associatedDomains: [`applinks:${ASSOCIATED_DOMAIN}`]}
        : {}),
      infoPlist: {
        BayaanAppGroup: IOS_APP_GROUP,
        NSSupportsLiveActivities: true,
        NSAppleMusicUsageDescription:
          'This app uses Apple Music to play audio.',
        UILaunchStoryboardName: 'SplashScreen',
        LSRequiresIPhoneOS: true,
        // @ai Qariah (TECH_DEBT #270): false matches what ships (iPad Split View). Change it only with an iPad test.
        UIRequiresFullScreen: false,
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription: 'This app does not use the camera.',
        // Qariah: keep both lists as they are; expo-background-task and withIosRemoveBackgroundFetch edit them.
        BGTaskSchedulerPermittedIdentifiers: [`${branding.bundleId.ios}.audio`],
        UIBackgroundModes: ['audio', 'remote-notification'],
        // Qariah: no CFBundleURLTypes (Expo builds it from `scheme`; a second copy breaks expo-share-intent's
        // plugin check) and no NSMicrophoneUsageDescription (playback-only).
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
        foregroundImage:
          branding.assets.appIcon.androidAdaptive.foregroundImage,
        backgroundColor:
          branding.assets.appIcon.androidAdaptive.backgroundColor,
      },
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
    // @ai Qariah: the home-screen name per device language. scripts/native-strings-from-review.mjs writes the file.
    locales: {
      ar: './i18n/native/ar.json',
    },
    // Qariah: React Compiler off (Zustand subscription perf). Adopt it only after PERF-01 and Tier 2 (NAT-S2).
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
    // Qariah: EAS Update needs a literal in bare workflow. One runtime per version keeps JS off older binaries.
    runtimeVersion: versionInfo.semanticVersion,
    plugins: [
      'expo-router',
      [
        'expo-localization',
        // Direction is controlled by the in-app language preference. Static
        // supportsRTL/forcesRTL resets I18nManager to the device locale on iOS.
        // @ai Qariah (TECH_DEBT #291): false keeps upstream's configChanges. A language change relaunches the process.
        {
          supportedLocales: {ios: ['en', 'ar']},
          allowDynamicLocaleChangesAndroid: false,
        },
      ],
      '@bacons/apple-targets',
      // Qariah is playback-only. Without these two options, prebuild adds the microphone permissions back (#291).
      [
        'expo-audio',
        {
          enableBackgroundPlayback: true,
          microphonePermission: false,
          recordAudioAndroid: false,
        },
      ],
      'expo-sqlite',
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
      // Qariah: the background catalog check of the local notifications (services/notifications/backgroundTask.ts).
      'expo-background-task',
      // Qariah: remove the unused `fetch` mode that the expo-task-manager auto-plugin adds.
      './withIosRemoveBackgroundFetch.js',
      [
        'expo-share-intent',
        {
          // Qariah (TECH_DEBT #289): the one App Group rule. MMKV also reads the AppGroupIdentifier that this sets.
          iosAppGroupIdentifier: IOS_APP_GROUP,
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
            ],
          ]
        : []),
      './withAndroidSigning.js',
      './withLargeHeap.js',
      './withIOSTeam.js',
      './withRemoveAdIdPermission.js',
      './withIosRemoveOAuthCallbackScheme.js',
      // Qariah (ANR WS-C, H1): Android non-blocking boot splash and lab BuildConfig.
      './withNonBlockingSplash.js',
      // Qariah: no CarPlay audio entitlement until Apple grants it, and Siri off (owner decisions O1, O2).
      // withBayaanWidgets reads scheme[0], so `scheme` must keep the app scheme (APP_URL_SCHEME) first.
      [
        './plugins/withBayaanCar.js',
        {carPlayAudioEntitlement: false, siri: false},
      ],
      './plugins/withAppShortcuts.js',
      './plugins/withBayaanWidgets.js',
      // Qariah: the Arabic widget-picker text (from i18n/native/widget-strings.json).
      './withQariahNativeStrings.js',
    ],
  },
};
// @ai-end
