// @ai #455
// A render throw below the root boundary used to reach the user as a blank
// screen and reach Sentry as nothing at all. These tests pin the two halves of
// the fix: the boundary REPORTS, and the user can get out of it.

import React from 'react';
import {Text} from 'react-native';
import {render, fireEvent} from '@testing-library/react-native';
import ErrorBoundary from '../ErrorBoundary';

const mockCaptureException: jest.Mock = jest.fn(() => 'abcdef1234567890');
const mockFlush: jest.Mock = jest.fn(() => Promise.resolve(true));

jest.mock('@sentry/react-native', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
  flush: () => mockFlush(),
}));

// eslint wants a body; a named no-op reads better than an inline empty one.
const noop = () => undefined;

function Boom({throws}: {throws: boolean}) {
  if (throws) throw new Error('kaboom');
  return <Text>recovered</Text>;
}

describe('ErrorBoundary', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    mockCaptureException.mockClear();
    mockFlush.mockClear();
    // React logs the caught error itself; the boundary logs it too.
    consoleError = jest.spyOn(console, 'error').mockImplementation(noop);
  });

  afterEach(() => consoleError.mockRestore());

  it('reports the error to Sentry with a message fingerprint', () => {
    render(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>,
    );

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    const [error, options] = mockCaptureException.mock.calls[0] as [
      Error,
      {
        tags: Record<string, string>;
        fingerprint: string[];
        contexts: {react: {componentStack?: string}};
      },
    ];
    expect(error.message).toBe('kaboom');
    expect(options.tags.scope).toBe('error-boundary');
    expect(options.fingerprint).toEqual(['error-boundary', 'kaboom']);
    // Only that a stack came through: jest's component stack is a babel code
    // frame with ANSI colour codes, so a substring match on a name is brittle.
    expect(typeof options.contexts.react.componentStack).toBe('string');
    expect(options.contexts.react.componentStack?.length).toBeGreaterThan(0);
  });

  it('flushes, so a force quit cannot lose the report', () => {
    render(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>,
    );

    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it('shows the Sentry event reference so a tester can quote it', () => {
    const {getByText} = render(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>,
    );

    getByText('Reference abcdef12');
  });

  it('renders a retry the user can press, and recovers when the child stops throwing', () => {
    const {getByTestId, getByText, rerender} = render(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>,
    );

    getByText('Something went wrong');

    rerender(
      <ErrorBoundary>
        <Boom throws={false} />
      </ErrorBoundary>,
    );
    fireEvent.press(getByTestId('app-error-boundary-retry'));

    getByText('recovered');
  });

  it('stops offering a retry after two attempts', () => {
    const {queryByTestId, getByTestId, getByText} = render(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>,
    );

    fireEvent.press(getByTestId('app-error-boundary-retry'));
    fireEvent.press(getByTestId('app-error-boundary-retry'));

    expect(queryByTestId('app-error-boundary-retry')).toBeNull();
    getByText(/close the app fully/);
  });

  // @ai #455 review follow-up — `retries` is a per-INCIDENT budget. Without the
  // componentDidUpdate reset it was a per-PROCESS counter, so a user who
  // recovered twice over a long session was refused a retry on their next,
  // unrelated error and told "Qariah hit the same error again".
  it('restores the full retry budget after a recovery', () => {
    const {queryByTestId, getByTestId, getByText, rerender} = render(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>,
    );

    // Incident 1: spend both retries, then recover.
    fireEvent.press(getByTestId('app-error-boundary-retry'));
    rerender(
      <ErrorBoundary>
        <Boom throws={false} />
      </ErrorBoundary>,
    );
    fireEvent.press(getByTestId('app-error-boundary-retry'));
    getByText('recovered');

    // Incident 2, unrelated: the retry must be offered again.
    rerender(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>,
    );
    getByText('Something went wrong');
    expect(queryByTestId('app-error-boundary-retry')).not.toBeNull();
    expect(queryByTestId('app-error-boundary-retry')).toBeTruthy();
  });

  // @ai #455 review follow-up — `getDerivedStateFromError` runs in the RENDER
  // phase, before `componentDidCatch` captures the new event, so it must clear
  // `eventId` itself. Otherwise the error screen's first paint after a SECOND
  // crash carries the FIRST crash's reference and a tester quotes the wrong
  // Sentry event.
  //
  // This asserts the static reducer DIRECTLY and deliberately. A rendered
  // assertion cannot detect this bug: React Testing Library flushes
  // `componentDidCatch`'s setState inside the same `act()` as the render, so
  // every query already sees the corrected id and the test passes against the
  // pre-fix code too. That version was tried and dropped for exactly this
  // reason — the stale paint is one intermediate render, which RNTL cannot
  // observe. Do not "upgrade" this to a rendered test.
  it('clears the previous event reference in the render phase', () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error('kaboom'))).toEqual(
      {
        hasError: true,
        eventId: null,
      },
    );
  });

  it('renders its children when nothing throws', () => {
    const {getByText} = render(
      <ErrorBoundary>
        <Boom throws={false} />
      </ErrorBoundary>,
    );

    getByText('recovered');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});
