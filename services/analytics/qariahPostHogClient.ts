// @ai Qariah (ANR hotfix v2; moved out of app/_layout.tsx for TECH_DEBT #243)
// — the module-scope PostHog client.
//
// `app/_layout.tsx` calls `createQariahPostHogClient()` ONCE at module scope,
// at the same place as the inline code it replaces, so every statement below
// still runs before React mounts and in the same order. Plan:
// planning/anr-hotfix-v2-plan.md, section 2.2.

import {PostHog} from 'posthog-react-native';
import {getBootSplashMode} from '@/modules/qariah-boot-splash';
import {bootSplashExperiment} from '@/services/bootSplash';
import {analyticsService} from '@/services/analytics/AnalyticsService';
import {scrubEventUrls} from '@/services/analytics/scrubEventUrls';

/**
 * Create the PostHog client at module scope, not in PostHogProvider. Reason:
 * the boot-splash experiment must attach to the client before the first flag
 * request, so that the request carries the `boot_risk` person property. The
 * options are the options that the provider used before. The provider set
 * `captureAppLifecycleEvents: true` itself (autocapture is not `false`), so
 * this code sets it explicitly.
 *
 * `analyticsEnabled` is the env kill switch (EXPO_PUBLIC_ANALYTICS_ENABLED)
 * that `app/_layout.tsx` already reads.
 * @ai
 */
export function createQariahPostHogClient(analyticsEnabled: boolean): PostHog {
  const posthogClient = new PostHog(
    process.env.EXPO_PUBLIC_POSTHOG_API_KEY || 'phc_disabled_placeholder',
    {
      host: 'https://us.i.posthog.com',
      flushAt: 20,
      flushInterval: 30000,
      disabled: !process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
      captureAppLifecycleEvents: true,
      // @ai Remove the query string and the fragment from every URL property
      // (issue #609): the lifecycle capture put the launch deep link, with
      // the QF OAuth code, into `Application Opened`. The hook must be HERE:
      // PostHogProvider ignores its `options` when it gets a `client`.
      before_send: scrubEventUrls,
    },
  );
  // Attach in the same synchronous module code, before any await. The
  // controller does nothing on iOS and never throws.
  bootSplashExperiment.attach(posthogClient);
  // @ai Super properties persist across launches. Set this process's mode now,
  // so events sent before AnalyticsConnector mounts (a stalled boot) do not
  // carry the previous launch's mode. Clear the previous launch's flag label;
  // the controller sets it again when the flag resolves in this process.
  {
    const bootMode = getBootSplashMode();
    if (bootMode !== 'unavailable') {
      posthogClient.register({boot_splash_mode: bootMode});
      posthogClient.unregister('boot_splash_flag');
    }
  }
  // @ai Connect analytics now, not when the provider mounts. RootLayout renders
  // nothing until the app is ready, so a hard stall used to drop splash_stalled
  // and boot_risk_enrolled (no instance). Safe before consent is known: every
  // AnalyticsService capture checks the consent gate, which fails closed until
  // the stored choice hydrates (Sprint 36). AnalyticsConnector sets the same
  // instance again later; that is harmless. The env kill switch
  // (EXPO_PUBLIC_ANALYTICS_ENABLED=false) is checked here too, because
  // analyticsService.initialize() has not run yet at module load.
  if (analyticsEnabled) analyticsService.setPostHogInstance(posthogClient);
  return posthogClient;
}
