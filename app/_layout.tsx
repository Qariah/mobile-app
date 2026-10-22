// @ai-start
import i18n from '@/i18n';
import {uiFontFiles} from '@/i18n/fonts';
import {bootstrapDirection} from '@/i18n/language';
import {appDirection, appLayoutDirection, isRTL} from '@/utils/rtl';
// @ai-end
import React, {useEffect, useState, useRef, useCallback, useMemo} from 'react';
import {Stack, useRouter} from 'expo-router';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {useFonts} from 'expo-font';
// Qariah (ANR WS-C): same API as expo-splash-screen; hideAsync() also removes
// the Android non-blocking boot overlay. See utils/bootSplash.ts.
import * as SplashScreen from '@/utils/bootSplash';
import * as SystemUI from 'expo-system-ui';
import {usePlayerStore} from '@/services/player/store/playerStore';
import ErrorBoundary from '@/components/ErrorBoundary';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {
  AppState,
  View,
  Text,
  Platform,
  StatusBar as RNStatusBar,
  Appearance,
  InteractionManager,
  type AppStateStatus,
} from 'react-native';
import {useTheme} from '@/hooks/useTheme';
// @ai-start
import {LocaleDirContext, ThemeProvider} from 'expo-router/react-navigation';
// @ai-end
import {PlayerSheet} from '@/components/player/v2/PlayerSheet';
import {
  WhatsNewModal,
  WhatsNewModalRef,
} from '@/components/modals/WhatsNewOnboarding';
import {DevMenu} from '@/components/DevMenu';
import {SheetProvider} from 'react-native-actions-sheet';
import '@/components/sheets/sheets'; // Register action sheets
import {
  configureReanimatedLogger,
  ReanimatedLogLevel,
} from 'react-native-reanimated';
import {preloadTajweedData} from '@/utils/tajweedLoader';
import {bootApp} from '@/services/appBoot';
import {NetworkStatusMonitor} from '@/components/NetworkStatusMonitor';
import {useNetworkMonitor} from '@/hooks/useNetworkMonitor';
import {PostHogProvider, usePostHog} from 'posthog-react-native';
import {startWidgetSync} from '@/services/widgets/syncWidgets';
import {startContentWidgetSync} from '@/services/widgets/syncContentWidgets';
import {startConfiguredWidgetSync} from '@/services/widgets/syncConfiguredWidgets';
import {startLiveActivitySync} from '@/services/widgets/live-activity/syncLiveActivity';
import {analyticsService} from '@/services/analytics/AnalyticsService';
import {ExpoAudioProvider} from '@/services/audio';
import {useShareIntent} from 'expo-share-intent';
import {useUploadsStore} from '@/store/uploadsStore';
import {SheetManager} from 'react-native-actions-sheet';
import {showToast} from '@/utils/toastUtils';
import {mushafSessionStore} from '@/services/mushaf/MushafSessionStore';
import {USE_GLASS} from '@/hooks/useGlassProps';
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
// Qariah: the Qariah-only imports sit in this one block (TECH_DEBT #243).
import {AuthTelemetry} from '@/services/analytics/AuthTelemetry';
import {createQariahPostHogClient} from '@/services/analytics/qariahPostHogClient';
import {
  qariahSentryOptions,
  initQariahSentryScope,
} from '@/services/diagnostics/qariahSentryOptions';
import {whenColdStartDeepLinkKnown} from '@/services/diagnostics/deepLinkColdStartReplay';
import {markMushafRestoreHandled} from '@/services/mushafRestoreSignal';
import {QariahRootEffects} from '@/components/QariahRootEffects';
import {useSplashRevealWatchdog} from '@/hooks/useSplashRevealWatchdog';
import {AuthProvider} from '@/services/auth';
import {UserStateProvider} from '@/services/userState';
import {isOnboarded} from '@/services/onboarding/onboardingState';

// Configure Reanimated logger
configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

// Cache for expo-navigation-bar module (Android only)
let NavigationBarModule: any = null;

// Prevent the splash screen from auto-hiding
SplashScreen.preventAutoHideAsync().catch(() => {
  /* reloading the app might trigger some race conditions, ignore them */
});

// Set native root view background immediately (before any component renders)
// This prevents the white flash between splash screen and first frame.
// QARIAHV2-C — guard the rejection: on OEM-killed Activities (Samsung/OnePlus/
// Xiaomi) ExpoSystemUI.setBackgroundColorAsync rejects with "current activity
// is no longer available"; it's benign cosmetic cleanup, not a real failure.
void SystemUI.setBackgroundColorAsync(
  Appearance.getColorScheme() === 'dark' ? '#07121a' : '#f4f3ec',
).catch(() => {
  /* Activity may be gone (OEM-killed); benign cleanup, swallow it. */
});

const analyticsEnabled = process.env.EXPO_PUBLIC_ANALYTICS_ENABLED !== 'false';

// Narrows the `any`-typed expoConfig.extra.version without an `as` cast.
function isVersionInfo(
  value: unknown,
): value is {semanticVersion: string; buildNumber: string | number} {
  if (value == null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.semanticVersion === 'string' &&
    (typeof v.buildNumber === 'string' || typeof v.buildNumber === 'number')
  );
}

if (analyticsEnabled) {
  // Explicit release + dist tagging. Android events were landing with no
  // release (`release: None`), so crashes/ANRs couldn't be tied to a build.
  // Derive both from the build-time version injected into
  // expoConfig.extra.version by scripts/generate-version.js — reliable on both
  // platforms, unlike Sentry's native auto-detection. `undefined` is a safe
  // no-op (Sentry falls back to auto-detect), so a missing manifest can't
  // regress the current behavior.
  const rawVersion: unknown = Constants.expoConfig?.extra?.version;
  const versionInfo = isVersionInfo(rawVersion) ? rawVersion : undefined;
  const appId =
    Constants.expoConfig?.ios?.bundleIdentifier ??
    Constants.expoConfig?.android?.package;
  // Require appId too — without it the template literal would stringify
  // `undefined` into the release name (e.g. "undefined@2.2.1+935"). Falling
  // back to an undefined release is the safe no-op (Sentry auto-detects).
  const sentryRelease =
    versionInfo != null && appId != null
      ? `${appId}@${versionInfo.semanticVersion}+${versionInfo.buildNumber}`
      : undefined;
  const sentryDist =
    versionInfo?.buildNumber != null
      ? String(versionInfo.buildNumber)
      : undefined;

  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
    tracesSampleRate: 0.2,
    enableAutoSessionTracking: true,
    release: sentryRelease,
    dist: sentryDist,
    // Qariah: the Qariah options win (services/diagnostics/qariahSentryOptions.ts).
    ...qariahSentryOptions(),
  });
  // Qariah: debug_id tag, diagnostics build flag, memory watch.
  initQariahSentryScope();
}

// Qariah (ANR hotfix v2): the PostHog client is created at module scope, before
// React mounts (services/analytics/qariahPostHogClient.ts).
const posthogClient = createQariahPostHogClient(analyticsEnabled);

/** Connects PostHog SDK to our analytics service and tracks app lifecycle. */
function AnalyticsConnector(): null {
  const posthog = usePostHog();

  // Connect PostHog instance to analytics service
  useEffect(() => {
    if (posthog) {
      analyticsService.setPostHogInstance(posthog);
      analyticsService.trackAppOpened();
    }
  }, [posthog]);

  // Track app foreground/background transitions
  useEffect(() => {
    function handleAppStateChange(nextState: AppStateStatus): void {
      if (nextState === 'background' || nextState === 'inactive') {
        analyticsService.trackAppBackgrounded();
      } else if (nextState === 'active') {
        analyticsService.trackAppOpened();
      }
    }
    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange,
    );
    return () => subscription.remove();
  }, []);

  return null;
}

// @ai-start
function RootLayout() {
  // Start reloads after the root has mounted, when native reload listeners are
  // ready, rather than as a side effect of importing translation resources.
  useEffect(bootstrapDirection, []);
  const [appIsReady, setAppIsReady] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [mushafRestoreHandled, setMushafRestoreHandled] = useState(false);
  const [setupError, setSetupError] = useState<Error | null>(null);
  const router = useRouter();
  const initializationRef = useRef(false);
  const whatsNewModalRef = useRef<WhatsNewModalRef>(null);
  const {theme, isDarkMode} = useTheme();
  useNetworkMonitor();

  // Build React Navigation theme so card/background colors match during transitions
  const navigationTheme = useMemo(
    () => ({
      dark: isDarkMode,
      colors: {
        primary: theme.colors.text,
        background: theme.colors.background,
        card: theme.colors.background,
        text: theme.colors.text,
        border: theme.colors.border,
        notification: theme.colors.error,
      },
      fonts: {
        regular: {fontFamily: 'Manrope-Regular', fontWeight: '400' as const},
        medium: {fontFamily: 'Manrope-Medium', fontWeight: '500' as const},
        bold: {fontFamily: 'Manrope-Bold', fontWeight: '700' as const},
        heavy: {fontFamily: 'Manrope-ExtraBold', fontWeight: '800' as const},
      },
    }),
    [isDarkMode, theme.colors],
  );

  // Critical fonts — block splash screen on these only
  const [fontsLoaded, fontError] = useFonts({
    ...uiFontFiles,
    SurahNames: require('@/assets/fonts/surah_names.ttf'),
    SurahNames2: require('@/assets/fonts/surah_names_2.ttf'),
  });

  // Handle share intents from other apps
  const {hasShareIntent, shareIntent, resetShareIntent} = useShareIntent({
    debug: __DEV__,
    resetOnBackground: true,
  });

  // Lock to portrait by default; mushaf.tsx unlocks when that screen is active.
  // QARIAHV2-C (#54) — guard the rejection: when the OEM kills the Activity
  // (Samsung/OnePlus/Xiaomi during playback), in-flight ExpoScreenOrientation
  // calls reject with "current activity is no longer available". Same benign
  // class as the existing SystemUI/KeepAwake guards; orientation is
  // meaningless on a dead Activity.
  useEffect(() => {
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => {
      /* Activity may be gone (OEM-killed); benign, swallow it. */
    });
  }, []);

  // Start after init so the first snapshot sees the restored session and
  // stores instead of overwriting the widgets with an empty state.
  useEffect(() => {
    if (!appIsReady) return;
    const stopLiveActivity = startLiveActivitySync();
    const stopSnapshot = startWidgetSync();
    const stopConfigured = startConfiguredWidgetSync();
    const stopContent = startContentWidgetSync();
    return () => {
      stopSnapshot();
      stopConfigured();
      stopContent();
      stopLiveActivity();
    };
  }, [appIsReady]);

  // Tajweed data — defer until after first frame + interactions complete
  useEffect(() => {
    InteractionManager.runAfterInteractions(() => {
      if (__DEV__) console.log('[App] Preloading tajweed data...');
      preloadTajweedData();
    });
  }, []);

  // Qariah: splash TTI watchdog + the #53 force-reveal (useSplashRevealWatchdog).
  const {forceReveal, recordSplashHidden} = useSplashRevealWatchdog({
    appIsReady,
    fontsLoaded,
    isPlayerReady,
    mushafRestoreHandled,
    hasShareIntent,
  });

  const onLayoutRootView = useCallback(async () => {
    try {
      if (
        (appIsReady &&
          fontsLoaded &&
          isPlayerReady &&
          !hasShareIntent &&
          mushafRestoreHandled) ||
        forceReveal
      ) {
        await SplashScreen.hideAsync();
        // @ai REPORT-ONLY — splash actually hidden; record TTI success (§3).
        recordSplashHidden();
      }
    } catch (e) {
      if (__DEV__) console.warn('Error hiding splash screen:', e);
    }
  }, [
    appIsReady,
    fontsLoaded,
    isPlayerReady,
    hasShareIntent,
    mushafRestoreHandled,
    forceReveal,
    recordSplashHidden,
  ]);

  // Initialize app with expo-audio
  useEffect(() => {
    if (initializationRef.current) {
      return;
    }

    async function prepare() {
      // @ai Qariah (Pass B): the Qariah boot steps and boot instrumentation
      // (sentinel, furthest step, slow-cold-start, deferred Mushaf preload,
      // catalog-version polling) run inside bootApp() through
      // services/qariahBoot.ts.
      try {
        await bootApp();

        // Mark app as ready
        setIsPlayerReady(true);
        setAppIsReady(true);
        initializationRef.current = true;
        if (__DEV__) console.log('[App] Initialization complete');
      } catch (error) {
        console.error('[App] Preparation error:', error);

        setSetupError(
          error instanceof Error ? error : new Error('Setup failed'),
        );
        usePlayerStore
          .getState()
          .setError(
            'system',
            error instanceof Error ? error : new Error('Setup failed'),
          );

        setIsPlayerReady(false);
        setAppIsReady(false);
        initializationRef.current = false;
      }
    }

    prepare();
  }, []);

  // Set native root view background + configure Android navigation bar to match theme
  useEffect(() => {
    // QARIAHV2-C — guard against the "current activity is no longer available"
    // rejection when the OS has killed the Activity (see module-scope call above).
    void SystemUI.setBackgroundColorAsync(theme.colors.background).catch(() => {
      /* Activity may be gone (OEM-killed); benign cleanup, swallow it. */
    });

    async function setupNavigationBar() {
      if (Platform.OS === 'android') {
        try {
          if (!NavigationBarModule) {
            NavigationBarModule = await import('expo-navigation-bar').then(
              module => module.default,
            );
            RNStatusBar.setTranslucent(true);
          }

          if (NavigationBarModule) {
            await NavigationBarModule.setBackgroundColorAsync(
              theme.colors.background,
            );
            await NavigationBarModule.setButtonStyleAsync(
              isDarkMode ? 'light' : 'dark',
            );
          }
        } catch (error) {
          if (__DEV__)
            console.warn(
              '[NavBar Debug] Failed to configure navigation bar:',
              error,
            );
        }
      }
    }

    setupNavigationBar();
  }, [theme.colors.background, isDarkMode]);

  // Handle share intent (uploads from other apps)
  useEffect(() => {
    if (!hasShareIntent || !appIsReady || !isPlayerReady) return;

    const handleShareIntent = async () => {
      try {
        const files = shareIntent.files;
        if (!files || files.length === 0) {
          resetShareIntent();
          await SplashScreen.hideAsync();
          return;
        }

        const audioFiles = files.filter(f => f.mimeType?.startsWith('audio/'));

        if (audioFiles.length === 0) {
          resetShareIntent();
          await SplashScreen.hideAsync();
          return;
        }

        const {importFile, importFiles} = useUploadsStore.getState();

        if (audioFiles.length === 1) {
          const file = audioFiles[0];
          const recitation = await importFile(
            file.path,
            file.fileName || i18n.t('app.sharedAudio'),
          );
          resetShareIntent();
          await SplashScreen.hideAsync();
          showToast(i18n.t('app.fileImported'));
          SheetManager.show('organize-recitation', {
            payload: {recitation},
          });
        } else {
          const mapped = audioFiles.map(f => ({
            uri: f.path,
            name: f.fileName || i18n.t('app.sharedAudio'),
          }));
          await importFiles(mapped);
          resetShareIntent();
          await SplashScreen.hideAsync();
          showToast(i18n.t('app.filesImported', {count: audioFiles.length}));
          router.push('/collection/uploads');
        }
      } catch (error) {
        console.error('[ShareIntent] Import failed:', error);
        resetShareIntent();
        await SplashScreen.hideAsync();
      }
    };

    handleShareIntent();
  }, [
    hasShareIntent,
    appIsReady,
    isPlayerReady,
    shareIntent,
    resetShareIntent,
  ]);

  // First-launch onboarding redirect, OR mushaf-screen restore if last open.
  // Onboarding wins over mushaf restore: a fresh-install user shouldn't be
  // dropped into a restored mushaf state. AsyncStorage read is async; gate
  // mushafRestoreHandled until both checks complete.
  // Qariah-only: upstream has no first-launch flow.
  useEffect(() => {
    if (!appIsReady || !isPlayerReady || hasShareIntent) return;

    let cancelled = false;
    // Qariah (#53/#71): this flag gates the splash, so flipping it must NEVER
    // depend solely on unbounded steps. Two such steps live in this effect:
    // the AsyncStorage `isOnboarded()` read, and the
    // `InteractionManager.runAfterInteractions` defer — the latter is starved
    // for as long as any interaction handle is held (nav transitions,
    // JS-driven animations), which a Sentry `splash-hide-timeout` event from a
    // Samsung A35 caught doing exactly that (gate still false at 17s with
    // every other gate true). The deadline bounds the WHOLE effect: the
    // redirect logic still completes whenever its async steps land, but the
    // splash gate flips by the deadline no matter what.
    const gateDeadline = setTimeout(() => {
      if (!cancelled) setMushafRestoreHandled(true);
    }, 4000);
    (async () => {
      const onboarded = await isOnboarded();
      if (cancelled) return;
      if (!onboarded) {
        router.replace('/onboarding');
        InteractionManager.runAfterInteractions(() => {
          if (!cancelled) setMushafRestoreHandled(true);
        });
        return;
      }

      // #105: a cold-start deep link wins over last-session mushaf restore. If
      // the app was launched from a share link or a widget tap, the user wants
      // the link target, not their previous mushaf page — pushing /mushaf here
      // would land on top of the replayed route and eject them from it. Skip
      // the restore push and let the deep-link replay own navigation; still
      // settle the splash gate. Upstream (fca03eed) waits for the launch URL
      // here; Qariah waits for it too, classified, so an OAuth or share-intent
      // launch still restores. The gate deadline above bounds the wait.
      const hasColdStartDeepLink = await whenColdStartDeepLinkKnown();
      if (cancelled) return;

      const lastScreenWasMushaf = mushafSessionStore.getLastScreenWasMushaf();
      const lastReadPage = mushafSessionStore.getLastReadPage();

      if (lastScreenWasMushaf && !hasColdStartDeepLink) {
        router.push({
          pathname: '/mushaf',
          // restored:'1' marks this as the cold-start restore destination so the
          // content-stall watchdog tags a hang here as the "won't open" variant.
          params: lastReadPage
            ? {page: String(lastReadPage), restored: '1'}
            : {restored: '1'},
        });
        InteractionManager.runAfterInteractions(() => {
          if (!cancelled) setMushafRestoreHandled(true);
        });
      } else {
        setMushafRestoreHandled(true);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(gateDeadline);
    };
  }, [appIsReady, isPlayerReady, hasShareIntent]);

  // Hide splash once mushaf restore (if any) has settled.
  // onLayout only fires once, so this effect covers the case where
  // mushafRestoreHandled flips after the initial layout.
  useEffect(() => {
    if (
      (appIsReady &&
        fontsLoaded &&
        isPlayerReady &&
        !hasShareIntent &&
        mushafRestoreHandled) ||
      forceReveal
    ) {
      SplashScreen.hideAsync().catch(() => {});
      // @ai REPORT-ONLY — splash hidden via the late-settle path; record TTI
      // success once (guarded by splashHiddenRef) so the watchdog's denominator
      // is correct regardless of which gate completed last (§3).
      recordSplashHidden();
    }
  }, [
    appIsReady,
    fontsLoaded,
    isPlayerReady,
    hasShareIntent,
    mushafRestoreHandled,
    forceReveal,
    recordSplashHidden,
  ]);

  // Qariah (Sprint 48): a cold-start notification tap waits for the restore.
  useEffect(() => {
    if (mushafRestoreHandled) markMushafRestoreHandled();
  }, [mushafRestoreHandled]);

  if (fontError) {
    SplashScreen.hideAsync();
    return (
      <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
        <Text>{i18n.t('app.fontError')}</Text>
      </View>
    );
  }

  if (setupError) {
    SplashScreen.hideAsync();
    return (
      <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
        <Text>{i18n.t('app.initError', {message: setupError.message})}</Text>
      </View>
    );
  }

  // Qariah (#53): forceReveal must bypass this guard too — hiding the splash
  // while still returning null would swap an infinite splash for an infinite
  // blank window (caught in PR review). Revealing with these flags false is
  // the intended degraded state: system fonts fall back, screens render empty
  // states, and services that finish late still hydrate their stores (SQLite
  // calls against an uninitialized service throw catchable JS errors, not
  // native crashes — the accepted #53 tradeoff).
  if (!forceReveal && (!fontsLoaded || !isPlayerReady || !appIsReady)) {
    return null;
  }

  return (
    <ErrorBoundary>
      <PostHogProvider
        client={posthogClient}
        autocapture={{
          captureScreens: true,
        }}>
        {/* Qariah: the Qariah root effects run around AnalyticsConnector. */}
        <QariahRootEffects>
          <AnalyticsConnector />
        </QariahRootEffects>
        <AuthProvider>
          {/* Observes AuthContext state to emit the sign-in funnel. Renders
              null and swallows its own errors — see AuthTelemetry's header for
              why this is an observer rather than a call inside signIn(). */}
          <AuthTelemetry />
          <LocaleDirContext.Provider value={appDirection}>
            <ThemeProvider value={navigationTheme}>
              <SafeAreaProvider>
                <ExpoAudioProvider>
                  <GestureHandlerRootView
                    style={[
                      {flex: 1, backgroundColor: theme.colors.background},
                      appLayoutDirection,
                    ]}
                    // @ts-ignore - RN supports this on iOS to override system theme for native UI (keyboard, menus, alerts)
                    overrideUserInterfaceStyle={isDarkMode ? 'dark' : 'light'}
                    onLayout={onLayoutRootView}>
                    {/* UserStateProvider must live inside GestureHandlerRootView */}
                    {/* because the V1RestoreModal it renders post-sign-in uses */}
                    {/* gorhom BottomSheet's GestureDetector internally. Pre-S17 */}
                    {/* this provider was a sibling of GHR; the bug only surfaced */}
                    {/* when a fresh QF sign-in produced a v1 candidate match.    */}
                    <UserStateProvider>
                      <NetworkStatusMonitor />
                      <SheetProvider>
                        <Stack
                          screenOptions={{
                            headerShown: false,
                            contentStyle: {
                              direction: appDirection,
                              paddingTop: 0,
                              backgroundColor: theme.colors.background,
                            },
                            animation: 'fade',
                          }}>
                          <Stack.Screen
                            name="(tabs)"
                            options={{headerShown: false}}
                          />
                          <Stack.Screen
                            name="onboarding"
                            options={{headerShown: false, animation: 'fade'}}
                          />
                          <Stack.Screen
                            name="adhkar-playing"
                            options={{headerShown: false, animation: 'none'}}
                          />
                          <Stack.Screen
                            name="mushaf"
                            options={{
                              headerShown: USE_GLASS,
                              headerTransparent: true,
                              headerStyle: {backgroundColor: 'transparent'},
                              headerShadowVisible: false,
                              headerTitle: '',
                              headerTitleAlign: 'center',
                              headerBackButtonDisplayMode: 'minimal',
                              animation: isRTL
                                ? 'slide_from_left'
                                : 'slide_from_right',
                              fullScreenGestureEnabled: false,
                            }}
                          />
                        </Stack>
                        <PlayerSheet />
                        <WhatsNewModal ref={whatsNewModalRef} />
                        <DevMenu whatsNewModalRef={whatsNewModalRef} />
                      </SheetProvider>
                    </UserStateProvider>
                  </GestureHandlerRootView>
                </ExpoAudioProvider>
              </SafeAreaProvider>
            </ThemeProvider>
          </LocaleDirContext.Provider>
        </AuthProvider>
      </PostHogProvider>
    </ErrorBoundary>
  );
}
// @ai-end

// A deep link (widget, Live Activity, App Link) that opens a screen in this
// stack lands on top of its first screen, so back always has a target.
export const unstable_settings = {initialRouteName: '(tabs)'};

export default Sentry.wrap(RootLayout);
