import {Alert, Linking} from 'react-native';
import * as Sentry from '@sentry/react-native';

/**
 * Open an external URL safely.
 *
 * `Linking.openURL` returns a promise that REJECTS when the platform declines
 * to open the URL. Calling it bare from an `onPress` therefore produces an
 * unhandled promise rejection and the user sees nothing happen at all — that
 * is Sentry QARIAHV2-1Y ("Unable to open URL: https://quranreflect.com/posts/…",
 * production, iOS 26.6), first seen on 3.2.0+1705.
 *
 * Note this is NOT the `canOpenURL` trap Sprint 32 fixed for mailto — these are
 * plain https links, which `canOpenURL` would happily approve. The failure is at
 * open time, so the only correct handling is catching the rejection.
 *
 * We still report to Sentry so the underlying cause stays diagnosable, but as a
 * HANDLED exception with its own scope, so it no longer reads as a crash.
 *
 * Fire-and-forget by design: it handles its own failure, so it returns void
 * rather than a promise and callers can invoke it directly from `onPress`.
 */
export function openExternalUrl(
  url: string,
  destinationLabel = 'this link',
): void {
  Linking.openURL(url).catch((error: unknown) => {
    Sentry.captureException(error, {
      tags: {scope: 'external-link'},
      extra: {url},
      level: 'warning',
    });
    Alert.alert(
      "Couldn't open link",
      `Your device wasn't able to open ${destinationLabel}. Please try again, or open it in your browser.`,
    );
  });
}
