import React, {Component, ErrorInfo, ReactNode} from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import * as Sentry from '@sentry/react-native';
// @ai-start
import i18n from '@/i18n';
// @ai-end

/** @ai Qariah: translated text with an English fallback, so the boundary renders if i18n failed. */
function safeT(
  key: string,
  fallback: string,
  options?: Record<string, unknown>,
): string {
  try {
    const value = i18n.t(key as never, options as never) as unknown;
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  retries: number;
  eventId: string | null;
}

// @ai-start
// A render throw is usually deterministic: stop the retry offer after two.
const MAX_RETRIES = 2;

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    retries: 0,
    eventId: null,
  };

  // Clear `eventId` here: the first paint comes before componentDidCatch captures the new event.
  public static getDerivedStateFromError(_: Error): Partial<State> {
    return {hasError: true, eventId: null};
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);

    // @ai #455 — report the crash (no global handler sees it). Fingerprint by message, not call-site.
    const eventId = Sentry.captureException(error, {
      tags: {scope: 'error-boundary'},
      contexts: {
        react: {componentStack: errorInfo?.componentStack ?? undefined},
      },
      fingerprint: ['error-boundary', error?.message ?? 'unknown'],
    });
    this.setState(s => ({...s, eventId}));

    // @ai #455 — flush: the next user action is usually a force quit.
    Sentry.flush().catch(() => undefined);
  }

  // `retries` is per incident: reset it once the children commit without a throw.
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

      // No theme, safe-area hook or icon set: a provider may be the thing that failed.
      return (
        <View style={styles.container} testID="app-error-boundary">
          <Text style={styles.title}>
            {safeT('common:status.error', 'Something went wrong')}
          </Text>
          <Text style={styles.body}>
            {canRetry
              ? safeT(
                  'qariah:errorBoundary.first',
                  'Qariah hit an unexpected error on this screen. Your downloads and saved items are safe.',
                )
              : safeT(
                  'qariah:errorBoundary.repeat',
                  'Qariah hit the same error again. Please close the app fully and open it once more.',
                )}
          </Text>
          {this.state.eventId ? (
            <Text
              style={styles.reference}
              selectable
              testID="app-error-boundary-id">
              {/* No post-processing: the id keeps its Latin digits. */}
              {safeT(
                'qariah:errorBoundary.reference',
                `Reference ${this.state.eventId.slice(0, 8)}`,
                {id: this.state.eventId.slice(0, 8), postProcess: []},
              )}
            </Text>
          ) : null}
          {canRetry ? (
            <Pressable
              onPress={this.handleRetry}
              style={styles.button}
              accessibilityRole="button"
              accessibilityLabel={safeT(
                'settings:mushafSettings.fallback.retry',
                'Try again',
              )}
              testID="app-error-boundary-retry">
              <Text style={styles.buttonLabel}>
                {safeT('settings:mushafSettings.fallback.retry', 'Try again')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      );
    }

    return this.props.children;
  }
}
// @ai-end

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
  // The first 8 hex chars identify the Sentry event in a search.
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
