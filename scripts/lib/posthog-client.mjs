// @ai
//
// scripts/lib/posthog-client.mjs
// ------------------------------
// One PostHog client for the scripts. Four scripts each carried their own
// `hogql()` function (debug-id-lookup, daily-card, posthog-triage,
// rollout-engagement) — TECH_DEBT #246.
//
//   const ph = createPosthogClient(posthogConfig());
//   const rows = await ph.hogql('SELECT ... LIMIT 50');
//   const flag = await ph.request('/feature_flags/706025/');
//
// TWO ROW-CAP MODES. PostHog adds `LIMIT 100` to a HogQL query that carries no
// LIMIT, and it cuts the result SILENTLY (rollout-engagement.mjs explains the
// 2026-08-18 incident). So a script that reports numbers picks one mode, and a
// full result set then throws instead of returning a number:
//   { limit: N } — this client appends `LIMIT N` and refuses a query that
//                  carries its own LIMIT. rollout-engagement uses this.
//   { cap: N }   — the query carries its own LIMIT; this client throws when
//                  the result holds N rows or more. daily-card uses this.
// With neither option the client does not guard. debug-id-lookup and
// posthog-triage run bounded queries and use that.

// The repo's eslint config is React-Native-oriented and declares no Node
// globals; these are Node 18+ builtins.
/* global AbortSignal, globalThis */

export const POSTHOG_DEFAULT_HOST = 'https://us.posthog.com';

/**
 * Read the PostHog settings from the environment.
 * @param {{env?:object, defaultHost?:string}} [o]
 * @returns {{token:string|undefined, project:string|undefined, host:string}}
 */
export function posthogConfig({
  env = process.env,
  defaultHost = POSTHOG_DEFAULT_HOST,
} = {}) {
  return {
    token: env.POSTHOG_PERSONAL_API_TOKEN,
    project: env.POSTHOG_PROJECT_ID,
    host: (env.POSTHOG_HOST || defaultHost).replace(/\/$/, ''),
  };
}

/**
 * @param {{token:string, project:string, host?:string, timeoutMs?:number,
 *   fetchImpl?:typeof fetch}} o
 *   timeoutMs — abort a request after this long (none by default)
 * @returns {{request:Function, hogql:Function}} closures; safe to destructure
 */
export function createPosthogClient({
  token,
  project,
  host = POSTHOG_DEFAULT_HOST,
  timeoutMs,
  fetchImpl,
}) {
  async function send(path, {method = 'GET', body} = {}) {
    const doFetch = fetchImpl || globalThis.fetch;
    return doFetch(`${host}/api/projects/${project}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? {'Content-Type': 'application/json'} : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      ...(timeoutMs ? {signal: AbortSignal.timeout(timeoutMs)} : {}),
    });
  }

  /**
   * One call to `/api/projects/<project><path>`. Resolves to the parsed JSON.
   * Rejects with `PostHog <status> on <path>: <body head>`.
   */
  async function request(path, opts) {
    const res = await send(path, opts);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `PostHog ${res.status} on ${path}: ${text.slice(0, 300)}`,
      );
    }
    return res.json();
  }

  /**
   * Run a HogQL query. Resolves to the result rows.
   * Rejects with `PostHog <status>: <body head>`. The `PostHog 5xx` prefix is
   * load-bearing: lib/posthog-window.mjs and lib/ab-card.mjs match
   * `PostHog 504` and `PostHog 503` to retry a busy query.
   * @param {string} query
   * @param {{limit?:number, cap?:number, capMessage?:(rows:number, cap:number)=>string}} [o]
   */
  async function hogql(query, o = {}) {
    let text = query;
    let cap = o.cap;
    if (o.limit !== undefined) {
      if (/\blimit\s+\d/i.test(query)) {
        throw new Error(
          'hogql(): query already carries a LIMIT — pass {limit} instead so the ' +
            'truncation guard can see it.',
        );
      }
      text = `${query}\nLIMIT ${o.limit}`;
      cap = o.limit;
    }
    const res = await send('/query/', {
      method: 'POST',
      body: {query: {kind: 'HogQLQuery', query: text}},
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`PostHog ${res.status}: ${errText.slice(0, 300)}`);
    }
    const rows = (await res.json()).results || [];
    if (cap !== undefined && rows.length >= cap) {
      throw new Error(
        o.capMessage
          ? o.capMessage(rows.length, cap)
          : `PostHog returned ${rows.length} rows at the ${cap}-row cap — the result is truncated, ` +
              'so do NOT report numbers from it. Raise the cap or narrow the query.',
      );
    }
    return rows;
  }

  return {request, hogql};
}
