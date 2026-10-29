// @ai Qariah (TECH_DEBT #287): Sentry for the headless Android Auto root.
//
// Sentry.init runs at the module scope of `app/_layout.tsx`, the phone root.
// Android Auto starts the headless car root (`CarRoot`) when the phone app is
// not open, and that process never loads `app/_layout.tsx`: its boot
// breadcrumbs, `slow-cold-start` and `boot_hook` reports were lost.
// `qariahBootStarted('car')` (services/qariahBoot.ts) calls this first. When
// the phone layout loads later in the same process, its block sees the client
// (`!Sentry.getClient()`) and does not init a second time.

import * as Sentry from '@sentry/react-native';
import {
  qariahSentryOptions,
  initQariahSentryScope,
} from '@/services/diagnostics/qariahSentryOptions';
import {readVersionInfo} from '@/services/diagnostics/debugId';

/**
 * Initializes Sentry for a car-first process, with the phone root's options:
 * upstream's DSN, session tracking and dist, then Qariah's options (release,
 * sample rates, `beforeSend`) and scope. A no-op when a client exists, or when
 * `EXPO_PUBLIC_ANALYTICS_ENABLED` is 'false' (as in `app/_layout.tsx`).
 */
export function initSentryForCarRoot(): void {
  if (Sentry.getClient()) return;
  if (process.env.EXPO_PUBLIC_ANALYTICS_ENABLED === 'false') return;
  const buildNumber = readVersionInfo()?.buildNumber;
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
    enableAutoSessionTracking: true,
    dist: buildNumber != null ? String(buildNumber) : undefined,
    ...qariahSentryOptions(),
  });
  initQariahSentryScope();
}
