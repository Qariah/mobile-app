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
 *
 * SEM-S3 (Sprint 51, divergence audit 2026-10-24): the list holds only the
 * scopes that a call of the app needs. Each scope and its calls: // @ai
 *   openid          — GET {auth}/userinfo (`qfUserInfo.ts`), the id_token
 *   offline_access  — the refresh_token grant (`qfOAuth.ts`)
 *   user            — the user record from /userinfo (its email is the key
 *                     of the v1 restore)
 *   preference      — POST /auth/v1/preferences (`preferences.ts`)
 *   reading_session — POST /auth/v1/reading-sessions (`readingSessions.ts`)
 *   note.read       — GET /auth/v1/notes (`notes.ts` listNotes)
 *   note.create     — POST /auth/v1/notes (`notes.ts` createNote)
 *   note.update     — PATCH /auth/v1/notes/{id} (`notes.ts` updateNote)
 *   note.delete     — DELETE /auth/v1/notes/{id} (`notes.ts` deleteNote)
 *   post.read       — GET /v1/posts/my-posts (`postsRestore.ts`)
 *   post.create     — POST /auth/v1/notes/{id}/publish (`notes.ts` publishNote)
 *   post.update     — PATCH /v1/posts/{id}, the edit of a pulled reflection
 *                     in place (TECH_DEBT #256, Sprint 51 Task 27)
 *   post.delete     — DELETE /v1/posts/{id} (`notes.ts` unpublishNote)
 * The community feed (GET /quran-reflect/v1/posts/feed) uses the
 * client-credentials token and its own scopes (`qfClientCredentials.ts`),
 * not this list.
 *
 * Removed in SEM-S3, because no call uses them: `collection`, `bookmark`,
 * `goal`, `streak`, `post.like`, `post.save`, `comment.read`,
 * `comment.create`, `comment.like`. A refresh sends no `scope`, so a session
 * from before the change keeps its grants; only a new sign-in asks for the
 * shorter list. Add a scope back in the same change as the call that needs
 * it, and check the grant with a prelive sign-in (Hydra drops a scope that
 * the client may not request, with no error).
 */
const DEFAULT_SCOPES = [
  'openid',
  'offline_access',
  'user',
  'preference',
  'reading_session',
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
  // Children we use: read (the user's own posts, for the posts pull),
  // create (publish a new reflection), update (edit the body of a post in
  // place), delete (unpublish). // @ai
  'post.read',
  'post.create',
  'post.update',
  'post.delete',
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
