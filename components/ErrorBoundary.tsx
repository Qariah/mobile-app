import React, {Component, ErrorInfo, ReactNode} from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import * as Sentry from '@sentry/react-native';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  retries: number;
  eventId: string | null;
}

// Two retries, then stop offering one. A render throw is usually deterministic,
// so a third attempt just re-throws and the button reads as broken.
const MAX_RETRIES = 2;

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    retries: 0,
    eventId: null,
  };

  // Clear `eventId` here, not just in `handleRetry`. This runs in the RENDER
  // phase, so the error screen's first paint happens before
  // `componentDidCatch` has captured the new event. Without the reset that
  // paint shows the PREVIOUS crash's reference, and a tester who reads it
  // quotes the wrong Sentry event — the exact thing the reference is for.
  public static getDerivedStateFromError(_: Error): Partial<State> {
    return {hasError: true, eventId: null};
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);

    // @ai #455 — report the crash. Until this, a throw below this boundary
    // reached the user as a blank screen and reached Sentry as NOTHING: the
    // boundary catches the error, so no global handler sees it, and
    // `console.error` is not an event. An owner report on 3.2.2 (1974) could
    // not be diagnosed for exactly this reason.
    // Fingerprint by message, for the same reason `captureAndFlush` does in
    // services/diagnostics/diagnostics.ts: without it every boundary crash
    // collapses into ONE issue by call-site, and distinct crashes cannot be
    // triaged apart.
    const eventId = Sentry.captureException(error, {
      tags: {scope: 'error-boundary'},
      contexts: {
        react: {componentStack: errorInfo?.componentStack ?? undefined},
      },
      fingerprint: ['error-boundary', error?.message ?? 'unknown'],
    });
    this.setState(s => ({...s, eventId}));

    // @ai #455 — flush, for the same reason `captureAndFlush` does in
    // services/diagnostics/diagnostics.ts. This screen is what the user sees
    // when the app is already dead, and their next action is a force quit: the
    // owner's own report on 3.2.2 (1974) shows two cold starts three minutes
    // apart. Without a flush the report races the kill and can lose it. This
    // path fires at most a handful of times per process, so the cost is bounded.
    Sentry.flush().catch(() => undefined);
  }

  // `retries` is a per-INCIDENT budget, not a per-process one. Reset it once
  // the children commit without throwing, or a user who recovered twice over
  // a long session would be refused a retry on their next, unrelated error
  // and told "Qariah hit the same error again".
  //
  // The guard is what keeps MAX_RETRIES meaningful. When a retry re-throws,
  // React catches it during the render pass and re-renders with
  // `hasError: true`, so the only `componentDidUpdate` that ever sees
  // `hasError: false` is one where the children actually survived.
  public componentDidUpdate() {
    if (!this.state.hasError && this.state.retries > 0) {
      this.setState(s => ({...s, retries: 0}));
    }
  }

  private handleRetry = () => {
    this.setState(s => ({hasError: false, retries: s.retries + 1}));
  };

  public render() {
    if (this.state.hasError) {
      const canRetry = this.state.retries < MAX_RETRIES;

      // Deliberately no theme, no safe-area hook and no icon set: this screen
      // renders when something below it has already failed, so it must not
      // depend on a provider that may be the thing that failed. The top inset
      // is a fixed value for the same reason — the old screen had none, so the
      // message rendered under the status bar and was cut off.
      return (
        <View style={styles.container} testID="app-error-boundary">
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            {canRetry
              ? 'Qariah hit an unexpected error on this screen. Your downloads and saved items are safe.'
              : 'Qariah hit the same error again. Please close the app fully and open it once more.'}
          </Text>
          {this.state.eventId ? (
            <Text
              style={styles.reference}
              selectable
              testID="app-error-boundary-id">
              Reference {this.state.eventId.slice(0, 8)}
            </Text>
          ) : null}
          {canRetry ? (
            <Pressable
              onPress={this.handleRetry}
              style={styles.button}
              accessibilityRole="button"
              accessibilityLabel="Try again"
              testID="app-error-boundary-retry">
              <Text style={styles.buttonLabel}>Try again</Text>
            </Pressable>
          ) : null}
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAF8F2',
    paddingHorizontal: 32,
    paddingTop: 64,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: '#5A5A5F',
    textAlign: 'center',
    marginBottom: 16,
  },
  // Lets a tester quote the exact Sentry event instead of describing the
  // screen. Selectable so it can be copied; truncated because the first 8 of
  // 32 hex chars already identify the event in a search.
  reference: {
    fontSize: 12,
    color: '#9A9A9F',
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 24,
    backgroundColor: '#1C1C1E',
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default ErrorBoundary;
