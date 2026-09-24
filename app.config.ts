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
    ...(ASSOCIATED_DOMAIN
      ? {associatedDomains: [`applinks:${ASSOCIATED_DOMAIN}`]}
      : {}),
    infoPlist: {
      NSAppleMusicUsageDescription: 'This app uses Apple Music to play audio.',
      UILaunchStoryboardName: 'SplashScreen',
      LSRequiresIPhoneOS: true,
      UIRequiresFullScreen: true,
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription: 'This app does not use the camera.',
      // So Linking.canOpenURL('mailto:') returns true on iOS 9+ (schemes must
      // be whitelisted here or canOpenURL always returns false). Settings →
      // Help & Support / Feature Requests open mailto: to branding.supportEmail.
      // Mirrored into the committed ios/*/Info.plist so it ships without a
      // re-prebuild (keep both in sync — Sprint 32).
      LSApplicationQueriesSchemes: ['mailto'],
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
    // microphonePermission:false — Qariah is playback-only; this stops expo-audio
    // from injecting NSMicrophoneUsageDescription (iOS) + RECORD_AUDIO (Android),
    // which the app never uses. (Sprint 32 — privacy hygiene.)
    [
      'expo-audio',
      {enableBackgroundPlayback: true, microphonePermission: false},
    ],
    'expo-sqlite',
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
  ],
};

export default {expo: config};
