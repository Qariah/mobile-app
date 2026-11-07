// @ai
// PostHog `before_send` hook: remove the query string and the fragment from
// every URL-valued event property before the event leaves the device.
//
// WHY: posthog-react-native's lifecycle capture (`captureAppLifecycleEvents`,
// on by default) puts the launch deep link into `Application Opened` as
// `url`. When the QF OAuth redirect cold-starts the app, that link is
// `com.qariah.app:/quranoauth2redirect?code=…&state=…`, so the authorization
// code reached PostHog (found 2026-10-12, three stored events). The scheme
// and the path stay, so a funnel can still see "opened from the OAuth
// redirect"; the parameters, where a secret can be, do not.
//
// The hook keeps every event, so `Application Installed` / `Application
// Updated` still reach the daily card. It drops an event only when the scrub
// throws (see `scrubEventUrls`).

import type {PostHogOptions} from 'posthog-react-native';

type BeforeSendFn = Exclude<
  NonNullable<PostHogOptions['before_send']>,
  unknown[]
>;
type CaptureEvent = NonNullable<Parameters<BeforeSendFn>[0]>;
type Properties = NonNullable<CaptureEvent['properties']>;

// A property is URL-valued when its key ends in "url", "uri", "href" or
// "link" (or the plural), in any case: `url`, `$current_url`, `imageUrl`,
// `redirectUri`, `href`, `deepLink`, `urls`.
const URL_KEY = /(url|uri|href|link)s?$/i;

// Nested objects and arrays (`$set`, `$set_once`, a caller's own object) are
// scrubbed to this depth. The limit also stops a cycle. A nested value past
// the limit is replaced, never sent unchanged, because it can hold a URL.
const MAX_DEPTH = 4;
const TOO_DEEP = '[scrubbed: too deep]';

/** Return `value` without its query string (`?…`) and fragment (`#…`). */
export function stripQueryAndFragment(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

function isPlainObject(value: unknown): value is Properties {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

// Scrub one value. `isUrl` is true when the value sits under a URL key, so a
// string in it (also in an array under that key) loses its query.
function scrubValue(value: unknown, isUrl: boolean, depth: number): unknown {
  if (typeof value === 'string') {
    return isUrl ? stripQueryAndFragment(value) : value;
  }
  if (Array.isArray(value) || isPlainObject(value)) {
    if (depth >= MAX_DEPTH) return TOO_DEEP;
    if (Array.isArray(value)) {
      return value.map(item => scrubValue(item, isUrl, depth + 1));
    }
    return scrubObject(value, depth + 1);
  }
  return value;
}

function scrubObject(props: Properties, depth: number): Properties {
  const out: Properties = {};
  for (const [key, value] of Object.entries(props)) {
    out[key] = scrubValue(value, URL_KEY.test(key), depth) as never;
  }
  return out;
}

/**
 * The `before_send` hook. It returns a new event; it does not change the
 * input.
 *
 * FAILS CLOSED: when the SDK's hook throws, the SDK logs the error and sends
 * the event UNCHANGED (`_runBeforeSend` in @posthog/core). So any error here
 * drops the event, because the unscrubbed event can carry a secret.
 */
export const scrubEventUrls: BeforeSendFn = event => {
  if (!event) return event;
  try {
    return {
      ...event,
      properties: event.properties && scrubObject(event.properties, 0),
      // The SDK copies `$set` / `$set_once` from the returned event over
      // `properties.$set` / `properties.$set_once`, so scrub them too.
      $set: event.$set && scrubObject(event.$set, 0),
      $set_once: event.$set_once && scrubObject(event.$set_once, 0),
    };
  } catch {
    return null;
  }
};
