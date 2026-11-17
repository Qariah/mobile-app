/**
 * QF OAuth2 + user-data API configuration.
 *
 * Reads from EXPO_PUBLIC_QF_* env vars; falls back to the public dev (prelive)
 * client id for development. The default client id is committed to source — it
 * is a public client (PKCE replaces client_secret; no secret is ever used or
 * committed).
 *
 * To switch environments:
 *   - Set EXPO_PUBLIC_QF_ENV=production in .env.local for prod builds.
 *   - Set EXPO_PUBLIC_QF_CLIENT_ID=<prod-id> once fresh creds are obtained
 *     from developers@quran.com (Sprint 5).
 *
 * Source for endpoints: archived api-v2 qf.config.ts (quran-core Sprint 10).
 * Auth server: Ory Hydra at oauth2.quran.foundation / prelive-oauth2.quran.foundation.
 * API base: apis.quran.foundation / apis-prelive.quran.foundation.
 */

export type QfEnv = 'prelive' | 'production';

const ENV_CONFIG: Record<QfEnv, {authBaseUrl: string; apiBaseUrl: string}> = {
  prelive: {
    authBaseUrl: 'https://prelive-oauth2.quran.foundation',
    apiBaseUrl: 'https://apis-prelive.quran.foundation',
  },
  production: {
    authBaseUrl: 'https://oauth2.quran.foundation',
    apiBaseUrl: 'https://apis.quran.foundation',
  },
};

/**
 * Public dev client id from the archived api-v2 QF integration.
 * Safe to commit — PKCE replaces client_secret; no secret is needed.
 * Sprint 5: replace with fresh production credentials.
 */
const DEFAULT_CLIENT_ID = '184475da-e69c-460b-97f1-843c2fc86d26';

/**
 * Callback scheme registered with the QF dev OAuth client.
 * Must match the redirect URI registered at auth.quran.foundation.
 * Sprint 5: replace with 'qariah:/quranoauth2redirect' once prod creds
 * register a qariah:// redirect.
 */
const DEFAULT_REDIRECT_URI = 'com.qariah.app:/quranoauth2redirect';

/**
 * OAuth2 scopes needed for user-data sync.
 *
 * Per QF user-APIs quickstart, scopes are bare resource names — `preference`,
 * `reading_session`, etc. — not the dotted child names listed on the scopes
 * reference page (those describe permissions a parent scope grants, not
 * requestable strings; requesting `preference.read` returns
 * `invalid_scope: ... not allowed to request scope 'preference.read'`).
 *
 * Sprint 5 S5.1 finding: the original list (Sprint 4) omitted `preference`
 * entirely, so /preferences calls 403'd post-auth even though sign-in succeeded.
 *
 * Source: https://api-docs.quran.foundation/docs/tutorials/oidc/user-apis-quickstart/
 */
const DEFAULT_SCOPES = [
  'openid',
  'offline_access',
  'user',
  'preference',
  'reading_session',
  'collection',
  'bookmark',
  'goal',
  'streak',
  // Sprint 18 — local notes + QF Notes sync + publish-to-QuranReflect.
  // Sprint 21 round-5.3 — swap bare `note` parent for granular children.
  // **Decisive evidence:** the round-5 instrumented build captured a
  // `QF /notes failed: 403` from `POST /auth/v1/notes` at create-time
  // (logcat 2026-05-21 02:59 against prelive, signed-in user). This is
  // the same Hydra-silently-drops-parent-scope class that round-3 fixed
  // for `post` and `comment`: requesting bare `note` results in a token
  // with the `note` string present in `scope` claim but no actual
  // resource grants, so every notes endpoint 403s. The Sprint 5 S5.1
  // standing rule ("request bare parent, not dotted children") was
  // wrong for THIS resource family — it stays correct for
  // `preference` / `bookmark` / `reading_session` / `collection`,
  // which DID reject children with invalid_scope at OAuth time
  // (per the original S5.1 finding). The split is empirical, not
  // documented: some resources approve parents, others approve only
  // children, and Hydra silently drops anything not approved. So we
  // have to test each resource and pin the granularity that works.
  'note.read',
  'note.create',
  'note.update',
  'note.delete',
  // NB: no `note.publish` — publishing a note creates a QR Post, gated by
  // `post.create` (which we already request above). QF doesn't expose
  // a `note.publish` scope per the round-3 enumeration.
  // Sprint 21 round-3 — Reflections (the user's published QuranReflect
  // posts) need explicit child scopes. Hydra silently drops parent
  // scopes a client isn't approved for, so requesting `post` alone
  // returned a token without ANY post-related grants — calls to
  // `/v1/posts/by-verse/{verseKey}` 403'd against prelive on 2026-05-20.
  // Per https://api-docs.quran.foundation/docs/user_related_apis_versioned/scopes/
  // the parent `post` scope reads as "Manage your QuranReflect posts" —
  // i.e., the user's own posts only. There is NO QF-side scope or
  // endpoint that grants read access to other users' posts via the SDK;
  // confirmed via runtime curl probe + scopes-reference walkthrough.
  // Children we use: read (load reflections on a verse + post detail),
  // create (publish a new reflection), update (edit existing body),
  // delete (unpublish), like (toggle like on own reflection), save
  // (forward-compat for the "Save for later" feature on QR if surfaced).
  'post.read',
  'post.create',
  'post.update',
  'post.delete',
  'post.like',
  'post.save',
  // Sprint 21 round-3 — comments on the user's own Reflections. We use
  // these for the comment-thread display + composer surfaced from the
  // reflection editor. Parent `comment` again is approval-gated; ship
  // children. Per QF docs: comment.read = "Read QuranReflect posts'
  // comments" (any user's, not just calling user's), comment.create =
  // post a new comment, comment.like = like/unlike a comment. (No
  // comment.update or comment.delete exposed — QR does not offer edit
  // for comments.)
  'comment.read',
  'comment.create',
  'comment.like',
];

export interface QfOAuthConfig {
  env: QfEnv;
  clientId: string;
  /**
   * QF dev OAuth client `184475da-...` is registered as a CONFIDENTIAL client
   * at Hydra — token exchange + refresh require `client_secret` in addition to
   * PKCE. Pure-PKCE-without-secret returns `invalid_client` (401). Set
   * `EXPO_PUBLIC_QF_CLIENT_SECRET` to enable confidential-client auth. Leave
   * empty for public-client OAuth (when prod creds register a public client).
   * Sprint 5 (S5.1) finding — verified end-to-end on iOS sim against prelive.
   */
  clientSecret: string | null;
  redirectUri: string;
  scopes: string[];
  endpoints: {
    /** Ory Hydra authorization endpoint. */
    authorize: string;
    /** Ory Hydra token endpoint (code exchange + refresh). */
    token: string;
  };
}

export function getQfOAuthConfig(): QfOAuthConfig {
  const envRaw = process.env.EXPO_PUBLIC_QF_ENV;
  const env: QfEnv = envRaw === 'production' ? 'production' : 'prelive';
  const envCfg = ENV_CONFIG[env];

  const clientId = process.env.EXPO_PUBLIC_QF_CLIENT_ID || DEFAULT_CLIENT_ID;
  const clientSecret = process.env.EXPO_PUBLIC_QF_CLIENT_SECRET || null;
  const redirectUri =
    process.env.EXPO_PUBLIC_QF_REDIRECT_URI || DEFAULT_REDIRECT_URI;

  return {
    env,
    clientId,
    clientSecret,
    redirectUri,
    scopes: DEFAULT_SCOPES,
    endpoints: {
      authorize: `${envCfg.authBaseUrl}/oauth2/auth`,
      token: `${envCfg.authBaseUrl}/oauth2/token`,
    },
  };
}

/**
 * Base URL for QF user-data API requests.
 * Used by services/userState/ HTTP wrappers.
 * Headers required: x-auth-token (access token), x-client-id (client id).
 */
export function getQfApiBase(): string {
  const envRaw = process.env.EXPO_PUBLIC_QF_ENV;
  const env: QfEnv = envRaw === 'production' ? 'production' : 'prelive';
  return ENV_CONFIG[env].apiBaseUrl;
}
