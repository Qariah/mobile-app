/**
 * The PostHog `before_send` URL scrubber. The 2026-10-12 leak: the automatic
 * `Application Opened` event stored the QF OAuth redirect, with its
 * authorization code, as `url`. These cases are the evidence that the code
 * no longer leaves the device, and that the scrubber keeps every event.
 */
import {Linking} from 'react-native';
import {PostHog} from 'posthog-react-native';
import {scrubEventUrls, stripQueryAndFragment} from '../scrubEventUrls';

const OAUTH_REDIRECT =
  'com.qariah.app:/quranoauth2redirect?code=ory_ac_SECRET&scope=openid&state=STATE123';

describe('stripQueryAndFragment', () => {
  it('removes the query string from the OAuth redirect', () => {
    expect(stripQueryAndFragment(OAUTH_REDIRECT)).toBe(
      'com.qariah.app:/quranoauth2redirect',
    );
  });

  it('removes a fragment, and a fragment that comes before a query', () => {
    expect(stripQueryAndFragment('qariah://reciter/x#access_token=T')).toBe(
      'qariah://reciter/x',
    );
    expect(stripQueryAndFragment('https://a.example/p#f?code=C')).toBe(
      'https://a.example/p',
    );
  });

  it('keeps a URL that has no query string and no fragment', () => {
    expect(stripQueryAndFragment('qariah://reciter/abdul-basit')).toBe(
      'qariah://reciter/abdul-basit',
    );
    expect(stripQueryAndFragment('')).toBe('');
  });
});

describe('scrubEventUrls', () => {
  it('removes the OAuth code from Application Opened and keeps the event', () => {
    const out = scrubEventUrls({
      event: 'Application Opened',
      properties: {url: OAUTH_REDIRECT, $app_build: '2600'},
    });
    expect(out).toEqual({
      event: 'Application Opened',
      properties: {
        url: 'com.qariah.app:/quranoauth2redirect',
        $app_build: '2600',
      },
    });
    expect(JSON.stringify(out)).not.toContain('SECRET');
    expect(JSON.stringify(out)).not.toContain('STATE123');
  });

  it('scrubs any key that ends in "url", in any case', () => {
    const out = scrubEventUrls({
      event: '$screen',
      properties: {
        $current_url: 'qariah://x?code=1',
        imageUrl: 'https://cdn.example/p.jpg?v=2',
        URL: 'qariah://y#z',
      },
    });
    expect(out?.properties).toEqual({
      $current_url: 'qariah://x',
      imageUrl: 'https://cdn.example/p.jpg',
      URL: 'qariah://y',
    });
  });

  it('does not change a property whose key does not end in "url"', () => {
    // search_performed `query` and error text can hold a "?"; only URL keys
    // are scrubbed.
    const props = {
      query: 'what is this?',
      message: 'Error: fetch failed? https://x.example/?a=1',
      count: 3,
      ok: true,
      none: null,
    };
    expect(scrubEventUrls({event: 'e', properties: props})?.properties).toEqual(
      props,
    );
  });

  it('does not change a non-string value under a URL key', () => {
    const out = scrubEventUrls({event: 'e', properties: {url: null, myUrl: 5}});
    expect(out?.properties).toEqual({url: null, myUrl: 5});
  });

  it('scrubs nested objects, $set and $set_once', () => {
    const out = scrubEventUrls({
      event: 'e',
      properties: {
        link: {url: 'qariah://a?code=1'},
        $set: {last_url: 'qariah://b?code=2'},
      },
      $set: {last_url: 'qariah://b?code=2'},
      $set_once: {$initial_url: 'qariah://c?code=3'},
    });
    expect(out?.properties).toEqual({
      link: {url: 'qariah://a'},
      $set: {last_url: 'qariah://b'},
    });
    // The SDK copies these over properties.$set / properties.$set_once.
    expect(out?.$set).toEqual({last_url: 'qariah://b'});
    expect(out?.$set_once).toEqual({$initial_url: 'qariah://c'});
  });

  it('keeps Application Installed and Application Updated unchanged', () => {
    // The daily card counts these two events as its "Installed" line.
    for (const event of ['Application Installed', 'Application Updated']) {
      const input = {
        event,
        properties: {version: '3.2.2', build: '2600'},
      };
      expect(scrubEventUrls(input)).toEqual(input);
    }
  });

  it('does not change the input event', () => {
    const props = {url: OAUTH_REDIRECT};
    scrubEventUrls({event: 'Application Opened', properties: props});
    expect(props.url).toBe(OAUTH_REDIRECT);
  });

  it('keeps the uuid, the timestamp, and a Date property', () => {
    const timestamp = new Date('2026-10-17T00:00:00Z');
    const out = scrubEventUrls({
      uuid: 'u-1',
      event: 'e',
      // The type allows only JSON values, but a JS caller can pass a Date.
      // The scrubber must not turn it into `{}`.
      properties: {when: timestamp as never},
      timestamp,
    });
    expect(out?.uuid).toBe('u-1');
    expect(out?.timestamp).toBe(timestamp);
    expect(out?.properties?.when).toBe(timestamp);
  });

  it('passes through an event with no properties, and a null event', () => {
    expect(scrubEventUrls({event: 'e'})).toEqual({event: 'e'});
    expect(scrubEventUrls(null)).toBeNull();
  });

  it('scrubs href, uri and link keys, arrays, and an object under a URL key', () => {
    const out = scrubEventUrls({
      event: 'e',
      properties: {
        href: 'qariah://a?code=1',
        redirectUri: 'com.qariah.app:/quranoauth2redirect?code=2',
        deepLink: 'qariah://b#t=3',
        urls: ['qariah://c?code=4', {href: 'qariah://d?code=5'}],
        url: {href: 'qariah://e?code=6'},
      },
    });
    expect(out?.properties).toEqual({
      href: 'qariah://a',
      redirectUri: 'com.qariah.app:/quranoauth2redirect',
      deepLink: 'qariah://b',
      urls: ['qariah://c', {href: 'qariah://d'}],
      url: {href: 'qariah://e'},
    });
  });

  it('replaces a nested value past the depth limit, never sends it unchanged', () => {
    const deep = {a: {b: {c: {d: {e: {url: 'qariah://x?code=SECRET'}}}}}};
    const out = scrubEventUrls({event: 'e', properties: deep});
    expect(JSON.stringify(out)).not.toContain('SECRET');
    expect(JSON.stringify(out)).toContain('[scrubbed: too deep]');
  });

  it('stops at a cycle', () => {
    const props: Record<string, unknown> = {url: 'qariah://a?code=1'};
    props.self = props;
    const out = scrubEventUrls({event: 'e', properties: props as never});
    expect(out?.properties?.url).toBe('qariah://a');
  });

  it('drops the event when the scrub throws (fail closed)', () => {
    // The SDK sends the event unchanged when a hook throws, so the hook must
    // drop it instead.
    const props = {};
    Object.defineProperty(props, 'url', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    expect(
      scrubEventUrls({event: 'Application Opened', properties: props}),
    ).toBeNull();
  });
});

describe('the real SDK lifecycle capture', () => {
  // The leak path itself: posthog-react-native reads the launch deep link with
  // Linking.getInitialURL() and captures it as `url` on `Application Opened`.
  async function captureLaunch(
    beforeSend?: typeof scrubEventUrls,
  ): Promise<Array<{event: string; url: unknown}>> {
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(OAUTH_REDIRECT);
    const posthog = new PostHog('phc_test', {
      host: 'http://127.0.0.1:9',
      persistence: 'memory',
      preloadFeatureFlags: false,
      flushAt: 1000,
      flushInterval: 0,
      before_send: beforeSend,
    });
    const seen: Array<{event: string; url: unknown}> = [];
    posthog.on(
      'capture',
      (m: {event: string; properties?: Record<string, unknown>}) =>
        seen.push({event: m.event, url: m.properties?.url}),
    );
    await posthog.ready();
    // The lifecycle capture awaits getInitialURL() after init.
    await new Promise(resolve => setTimeout(resolve, 50));
    await posthog.shutdown();
    return seen;
  }

  afterEach(() => jest.restoreAllMocks());

  it('sends the OAuth code without the hook (control: the 2026-10-12 leak)', async () => {
    expect(await captureLaunch()).toContainEqual({
      event: 'Application Opened',
      url: OAUTH_REDIRECT,
    });
  });

  it('sends Application Opened without the code with the hook', async () => {
    const seen = await captureLaunch(scrubEventUrls);
    expect(seen).toContainEqual({
      event: 'Application Opened',
      url: 'com.qariah.app:/quranoauth2redirect',
    });
    expect(JSON.stringify(seen)).not.toContain('SECRET');
  });
});
