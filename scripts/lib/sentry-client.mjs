// @ai
//
// scripts/lib/sentry-client.mjs
// -----------------------------
// One Sentry REST client for the scripts. Five scripts each carried their own
// `sentry()` function (debug-id-lookup, prod-close, release-health,
// sentry-triage, sentry-hygiene) — TECH_DEBT #246.
//
//   const S = sentryConfig();                    // reads SENTRY_* from the env
//   const sentry = createSentryClient(S);
//   const issues = await sentry(`/projects/${S.org}/${S.project}/issues/?limit=10`);
//   await sentry(`/organizations/${S.org}/issues/${id}/`, {
//     method: 'PUT',
//     body: JSON.stringify({status: 'resolved'}),
//   });
//
// The Sentry org and project are not in config/branding.js (it holds no Sentry
// data), so they are the two named constants below. SENTRY_ORG and
// SENTRY_PROJECT override them.
//
// The default HOST is the EU region. scripts/daily-card.mjs reads its own
// SENTRY_REGION_HOST with the default `https://sentry.io`, and it does not use
// this module. A caller that needs another default passes `defaultHost`.

// The repo's eslint config is React-Native-oriented and declares no Node
// globals; these are Node 18+ builtins.
/* global globalThis */

export const SENTRY_ORG_DEFAULT = 'qariah';
export const SENTRY_PROJECT_DEFAULT = 'qariahv2';
export const SENTRY_EU_HOST = 'https://de.sentry.io';

/**
 * Read the Sentry settings from the environment.
 * @param {{env?:object, tokenVars?:string[], defaultHost?:string}} [o]
 *   tokenVars   — names to try in order; the first one that is set gives the
 *                 token. sentry-hygiene uses ['SENTRY_WRITE_TOKEN', 'SENTRY_READ_TOKEN'].
 *   defaultHost — the host when SENTRY_REGION_HOST is unset
 * @returns {{token:string|undefined, org:string, project:string, host:string}}
 */
export function sentryConfig({
  env = process.env,
  tokenVars = ['SENTRY_READ_TOKEN'],
  defaultHost = SENTRY_EU_HOST,
} = {}) {
  const name = tokenVars.find(v => env[v]);
  return {
    token: name ? env[name] : undefined,
    org: env.SENTRY_ORG || SENTRY_ORG_DEFAULT,
    project: env.SENTRY_PROJECT || SENTRY_PROJECT_DEFAULT,
    host: (env.SENTRY_REGION_HOST || defaultHost).replace(/\/$/, ''),
  };
}

/**
 * Make the `sentry(path, init?)` function.
 * `path` starts with `/` and goes after `<host>/api/0`. `init` is a `fetch`
 * init object (method, body). A body gets `Content-Type: application/json`.
 * Resolves to the parsed JSON, or null for HTTP 204.
 * Rejects with `Sentry <status> on <path>: <body head>` (GET) or
 * `Sentry <status> <METHOD> <path>: <body head>` (other methods).
 * @param {{token:string, host?:string, fetchImpl?:typeof fetch}} o
 */
export function createSentryClient({token, host = SENTRY_EU_HOST, fetchImpl}) {
  return async function sentry(path, init) {
    const doFetch = fetchImpl || globalThis.fetch;
    const method = (init && init.method) || 'GET';
    const res = await doFetch(`${host}/api/0${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init && init.body ? {'Content-Type': 'application/json'} : {}),
        ...((init && init.headers) || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      const where = method === 'GET' ? `on ${path}` : `${method} ${path}`;
      throw new Error(`Sentry ${res.status} ${where}: ${text.slice(0, 300)}`);
    }
    return res.status === 204 ? null : res.json();
  };
}
