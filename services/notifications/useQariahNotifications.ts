// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): the root hook of the local
// notifications. `components/QariahRootEffects.tsx` calls it once, inside
// `PostHogProvider` and the router.
//
// - The holdout enrollment (`holdoutEnrollment.ts`): the arm is decided as
//   soon as the consent and the flags allow, so the Settings row (which reads
//   the arm on focus) and the next boot step see it.
// - The tap router (`tapRouter.ts`): a tap on a notice opens its screen, on a
//   cold start, a warm start and while the app is open, and sends
//   `notification_opened`. It starts only for the arm `notify` (or an unknown
//   arm in DEV, `isNotificationsHoldout()`), so a holdout user never loads
//   `expo-notifications` (review of Task 16, L1). When the arm is written
//   later, `handleHoldoutAssigned` starts it.
import {useEffect, useRef} from 'react';
import {usePostHog} from 'posthog-react-native';
import {useNavigationContainerRef, useRouter} from 'expo-router';
import {onNotificationsHoldoutAssigned} from './backgroundTask';
import {isNotificationsHoldout} from './holdout';
import {
  startHoldoutEnrollment,
  type HoldoutAssignment,
  type HoldoutFlagClient,
} from './holdoutEnrollment';
import {
  openNotificationTap,
  startNotificationTapRouter,
  type NotificationTap,
  type OpenTapResult,
  type TapRouterNavigation,
} from './tapRouter';

/** Starts the tap router with the hook's router; set while the hook is mounted. */
let startTapRouterForNotify: (() => void) | null = null;

/** The arm is known: log it in DEV; a new arm syncs the native state. */
export function handleHoldoutAssigned(
  assignment: HoldoutAssignment,
  isNew: boolean,
): void {
  if (assignment.arm === 'notify') startTapRouterForNotify?.();
  if (__DEV__) {
    console.log(
      `[notifications] holdout arm: ${assignment.arm} (${assignment.enrollment})` +
        (isNew ? ', written now' : ', stored'),
    );
  }
  if (isNew) onNotificationsHoldoutAssigned(assignment.arm);
}

/** `notification_opened` for a tap (`notificationAnalytics.ts`). */
function reportTapOpened(
  tap: NotificationTap,
  coldStart: boolean,
  result: OpenTapResult,
): void {
  const {trackNotificationOpened} =
    require('./notificationAnalytics') as typeof import('./notificationAnalytics');
  void trackNotificationOpened(tap, coldStart, result);
}

/** The root hook (see the file header). */
export function useQariahNotifications(): void {
  const posthog = usePostHog();
  useEffect(() => {
    const client = (posthog ?? null) as HoldoutFlagClient | null;
    return startHoldoutEnrollment({client, onAssigned: handleHoldoutAssigned});
  }, [posthog]);

  const router = useRouter();
  const navigationRef = useNavigationContainerRef();
  // The latest router, read at tap time (the router starts once).
  const routerRef = useRef<TapRouterNavigation>(router);
  routerRef.current = router;

  useEffect(() => {
    // Once for each process; an unmount does not stop it (the root mounts
    // once, and a tap must still open after a remount).
    const start = (): void => {
      startNotificationTapRouter({
        open: tap => {
          const {appTapDeps} =
            require('./tapActions') as typeof import('./tapActions');
          const navigation: TapRouterNavigation = {
            push: href => routerRef.current.push(href as never),
            navigate: href => routerRef.current.navigate(href as never),
          };
          return openNotificationTap(
            tap,
            appTapDeps(navigation, () =>
              Boolean(navigationRef.current?.isReady()),
            ),
          );
        },
        onOpened: reportTapOpened,
      });
    };
    startTapRouterForNotify = start;
    // The holdout (and, in a release, an unknown arm): no router.
    if (!isNotificationsHoldout()) start();
    return () => {
      if (startTapRouterForNotify === start) startTapRouterForNotify = null;
    };
  }, [navigationRef]);
}
