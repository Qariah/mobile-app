/**
 * QuranReflect — community reflections + comments + like wrapper.
 *
 * Sits alongside `services/userState/notes.ts` (Sprint 18 / Slice B).
 * Notes.ts surfaces the user's OWN annotations (private QF Notes that
 * optionally publish to a QF Post). This file surfaces COMMUNITY
 * reflections — posts authored by other QF users — so the Mushaf-tab
 * "Community Reflections" toggle (Sprint 27 S27.4) can render them
 * inline under each ayah.
 *
 * SDK-backed (`@quranjs/api/public`). Endpoints (quranReflect service —
 * NOT auth):
 *   GET  /v1/posts/feed                       — paginated community feed
 *                                                (bracket-array filter)
 *   GET  /v1/posts/by-verse/{verseKey}        — posts on a verse (auth-user; broken — see history)
 *   GET  /v1/posts/{id}                       — single post
 *   GET  /v1/posts/{id}/liked                 — has the current user liked?
 *   POST /v1/posts/{id}/toggle-like           — like/unlike toggle
 *   GET  /v1/posts/{id}/comments              — comments on a post (paginated)
 *   GET  /v1/posts/{id}/all-comments          — all comments (one shot)
 *   POST /v1/comments                         — create comment
 *   POST /v1/comments/{id}/toggle-like        — like a comment
 *
 * **History — the by-verse hunt (Sprint 21 r3 → Sprint 27):**
 *
 * Sprint 21 round 3 spent ~3 hours probing every verse-filter shape we
 * could think of (`verse_key`, `verseKey`, `chapter+verse`,
 * `chapter_id+verse_number`, `chapter_id+from+to`, `filter[verse_key]`)
 * against `/v1/posts/feed`. All returned the unfiltered global `total`.
 * We pivoted to `/v1/posts/by-verse/{verseKey}` only to discover it
 * 401s on client_credentials tokens, and even with user auth returns
 * caller-only posts (resolver-layer scoping). The sheet was retired.
 *
 * Sprint 27: the Flutter production app at
 * `~/claude/Qariah-mobile-app-production/lib/utils/endpoints.dart:260`
 * has been shipping the bracket-array filter syntax for months:
 *
 *   filter[references][0][chapterId]=4
 *   filter[references][0][from]=10
 *   filter[references][0][to]=10
 *   filter[postTypeIds]=1
 *   filter[verifiedOnly]=true
 *   tab=popular
 *   languages=en
 *   page=1
 *
 * Live-probed 2026-05-26: returned 200 OK + real reflection for
 * An-Nisa 4:10 against prelive. The bracket-array shape was the only
 * unprobed shape from S21 r3. `listCommunityReflectionsByAyah` below
 * uses it; `listPostsByVerse` (the broken `by-verse` wrapper) is left
 * in place but unused.
 *
 * Sign-in is required. Callers should gate UI on
 * `useUserState().isAuthenticated` and surface a sign-in CTA otherwise.
 * Today's QF policy: `/posts/feed` requires user auth (`auth: "user"`
 * in the SDK definition).
 */

import {getQfSdk} from '@/services/auth/sdkClient';
import {getQfApiBase, getQfOAuthConfig} from '@/services/auth/config';
import {getQfClientCredentialsToken} from '@/services/auth/qfClientCredentials';
import {withQfCall} from './qfErrors';

export interface QfReflectionAuthor {
  id?: number | string;
  username?: string;
  name?: string;
  displayName?: string;
  avatarUrl?: string | null;
}

export interface QfReflectionPost {
  id: number | string;
  body: string;
  /** Verse range string e.g. `"2:255-2:255"` */
  range?: string;
  ranges?: string[];
  /** Author summary — shape varies by SDK version; we use a permissive type. */
  user?: QfReflectionAuthor;
  author?: QfReflectionAuthor;
  /** Aggregate counts the QF post payload typically carries. */
  likesCount?: number;
  commentsCount?: number;
  /** Whether the calling user has liked this post (may require a separate fetch). */
  liked?: boolean;
  createdAt?: string;
  updatedAt?: string;
  /** QF web URL — useful for "View on QuranReflect" deeplink. */
  link?: string;
  url?: string;
}

export interface QfComment {
  id: number | string;
  body: string;
  user?: QfReflectionAuthor;
  author?: QfReflectionAuthor;
  likesCount?: number;
  repliesCount?: number;
  liked?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface QfListResponse<T> {
  data?: T[];
  posts?: T[];
  comments?: T[];
  results?: T[];
  total?: number;
  page?: number;
}

function unwrapList<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === 'object') {
    const r = res as QfListResponse<T>;
    return r.data ?? r.posts ?? r.comments ?? r.results ?? [];
  }
  return [];
}

/**
 * SDK method-name resolution (post-runtime probe, 2026-05-20):
 *
 * Unlike the `auth.v1.notes.*` resource (which has hand-coded ergonomic
 * wrappers like `list` / `listByVerseKey`), the `quranReflect.v1.posts.*`
 * and `comments.*` resources are populated **purely** by the SDK's
 * auto-derivation pass in `y(serviceDef, requestMap)` — see
 * `node_modules/@quranjs/api/dist/public.min.js` function `F(op)`.
 *
 * The auto-derivation rules are:
 *   - path `/v1/x` (1 seg)              → `w[method]` (get=list, post=create, …)
 *   - path `/v1/x/{id}` (2 seg, last placeholder)  → `get`/`remove`/`update`
 *   - path `/v1/x/y/{z}` (3 seg, last placeholder) → `d(operationId)` ← FALLBACK
 *   - path `/v1/x/{id}/y` (3 seg, last NOT placeholder, y≠x) → `d(y)`
 *
 * So `postsControllerGetMyPostsByVerse` (path `/v1/posts/by-verse/{verseKey}`)
 * falls through to `d(operationId)` = the camel-cased operationId itself
 * = `postsControllerGetMyPostsByVerse`. Calling
 * `sdk.quranReflect.v1.posts.getMyPostsByVerse(…)` throws "is not a function".
 *
 * The robust fix is to use `sdk.quranReflect.v1.raw` — that's the
 * resource-grouping-bypassing map keyed by full operationId.
 *
 * Caveat: every call here needs to know its exact operationId; rename
 * those upstream and we break here. We accept that cost — the SDK
 * doesn't surface a stable ergonomic shape for community-posts, and
 * coding against `raw[opId]` is at least obvious about the coupling.
 */

/**
 * Posts on a specific verse.
 *
 * Operation: `postsControllerGetMyPostsByVerse`
 * Path:      `/v1/posts/by-verse/{verseKey}`  (auth=user)
 *
 * Runtime probe (2026-05-20): with `client_credentials` token, this
 * 401s. With user auth, the visibility scope (own-posts vs community)
 * was not separately probed — see file header.
 */
export async function listPostsByVerse(
  verseKey: string,
): Promise<QfReflectionPost[]> {
  return withQfCall(`/posts/by-verse/${verseKey}`, async () => {
    const sdk = getQfSdk();
    const res = await sdk.quranReflect.v1.raw.postsControllerGetMyPostsByVerse({
      path: {verseKey},
    });
    return unwrapList<QfReflectionPost>(res);
  });
}

/** Operation: `postsControllerFindOne` — path `/v1/posts/{id}`. */
export async function getPost(
  postId: string | number,
): Promise<QfReflectionPost | null> {
  return withQfCall(`/posts/${postId}`, async () => {
    const res = await getQfSdk().quranReflect.v1.raw.postsControllerFindOne({
      path: {id: String(postId)},
    });
    return (res as QfReflectionPost) ?? null;
  });
}

/**
 * Toggle the like state of a post. QF returns the post with `liked` updated.
 *
 * Operation: `postsControllerToggleLike` — path `/v1/posts/{id}/toggle-like`.
 */
export async function togglePostLike(
  postId: string | number,
): Promise<QfReflectionPost | null> {
  return withQfCall(`/posts/${postId}/toggle-like`, async () => {
    const res = await getQfSdk().quranReflect.v1.raw.postsControllerToggleLike({
      path: {id: String(postId)},
    });
    return (res as QfReflectionPost) ?? null;
  });
}

/**
 * Get all comments on a post (one-shot, non-paginated).
 *
 * Operation: `postsControllerGetAllComment` — path `/v1/posts/{id}/all-comments`.
 */
export async function listAllComments(
  postId: string | number,
): Promise<QfComment[]> {
  return withQfCall(`/posts/${postId}/all-comments`, async () => {
    const res =
      await getQfSdk().quranReflect.v1.raw.postsControllerGetAllComment({
        path: {id: String(postId)},
      });
    return unwrapList<QfComment>(res);
  });
}

/**
 * Get paginated comments on a post.
 *
 * Operation: `postsControllerGetComments` — path `/v1/posts/{id}/comments`.
 */
export async function listComments(
  postId: string | number,
): Promise<QfComment[]> {
  return withQfCall(`/posts/${postId}/comments`, async () => {
    const res = await getQfSdk().quranReflect.v1.raw.postsControllerGetComments(
      {
        path: {id: String(postId)},
      },
    );
    return unwrapList<QfComment>(res);
  });
}

/**
 * Create a new comment on a post.
 *
 * Operation: `commentsControllerCreate` — path `/v1/comments`.
 */
export async function createComment(
  postId: string | number,
  body: string,
): Promise<QfComment | null> {
  return withQfCall(`/comments (post=${postId})`, async () => {
    const res = await getQfSdk().quranReflect.v1.raw.commentsControllerCreate({
      body: {postId, body},
    });
    return (res as QfComment) ?? null;
  });
}

/**
 * Toggle the like state of a comment.
 *
 * Operation: `commentsControllerToggleLike` — path `/v1/comments/{id}/toggle-like`.
 */
export async function toggleCommentLike(
  commentId: string | number,
): Promise<QfComment | null> {
  return withQfCall(`/comments/${commentId}/toggle-like`, async () => {
    const res =
      await getQfSdk().quranReflect.v1.raw.commentsControllerToggleLike({
        path: {id: String(commentId)},
      });
    return (res as QfComment) ?? null;
  });
}

/** Best-effort author label for UI — falls back through user fields. */
export function authorLabel(post: QfReflectionPost | QfComment): string {
  const u = post.user ?? post.author;
  if (!u) return 'Anonymous';
  return u.displayName ?? u.name ?? u.username ?? 'Anonymous';
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 27 — inline community reflections (per-ayah)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shape returned to inline-reflection consumers (Mushaf-tab card per ayah).
 *
 * Distinct from `QfReflectionPost` (the raw SDK payload, kept permissive
 * with many optional fields for the legacy sheet) — this one is narrower
 * and pre-normalized so the `<AyahCommunityReflections />` subcomponent
 * doesn't need to defend against shape variance at render time.
 */
export interface AyahReflectionAuthor {
  id: number | string;
  name?: string;
  username?: string;
  avatarUrl?: string | null;
  verified?: boolean;
}

export interface AyahReflection {
  id: number | string;
  body: string;
  author: AyahReflectionAuthor;
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
  publishedAt: string;
  estimatedReadingTime?: number;
  languageId?: number;
  languageName?: string;
}

/**
 * Subset of the QF feed-entry shape we actually consume.
 *
 * `quranReflect.v1.raw.postsControllerFeed(...)` types the response as
 * `Promise<unknown>` (the auto-derived SDK methods don't narrow), so we
 * shape-check at the unwrap boundary. Fields beyond this are ignored.
 */
interface QfFeedEntry {
  id?: number | string;
  body?: string;
  user?: {
    id?: number | string;
    name?: string;
    username?: string;
    avatarUrl?: string | null;
    verified?: boolean;
  };
  author?: {
    id?: number | string;
    name?: string;
    username?: string;
    avatarUrl?: string | null;
    verified?: boolean;
  };
  likesCount?: number;
  commentsCount?: number;
  liked?: boolean;
  isLiked?: boolean;
  publishedAt?: string;
  createdAt?: string;
  estimatedReadingTime?: number;
  languageId?: number;
  languageName?: string;
}

function normalizeFeedEntry(entry: QfFeedEntry): AyahReflection | null {
  if (!entry || typeof entry.id === 'undefined' || !entry.body) return null;
  const u = entry.user ?? entry.author ?? {};
  return {
    id: entry.id,
    body: entry.body,
    author: {
      id: u.id ?? 0,
      name: u.name,
      username: u.username,
      avatarUrl: u.avatarUrl ?? null,
      verified: Boolean(u.verified),
    },
    likesCount: typeof entry.likesCount === 'number' ? entry.likesCount : 0,
    commentsCount:
      typeof entry.commentsCount === 'number' ? entry.commentsCount : 0,
    isLiked: Boolean(entry.isLiked ?? entry.liked),
    publishedAt: entry.publishedAt ?? entry.createdAt ?? '',
    estimatedReadingTime: entry.estimatedReadingTime,
    languageId: entry.languageId,
    languageName: entry.languageName,
  };
}

/**
 * List verified community reflections for a single ayah.
 *
 * Filter shape mirrors the Flutter production app
 * (`endpoints.dart:_ayahStudyFeed`). Bracket-array syntax on
 * `filter[references][0][...]` is the contract QF actually honors — see
 * the file-header "by-verse hunt" history.
 *
 * Returns up to one page (QF default ~20) of `tab=popular` posts. Pagination
 * is not exposed today; the Sprint-27 card design renders a compact list
 * inline under the ayah, so "popular first page" is the right default.
 *
 * Filter rationale:
 *   - `postTypeIds=1` — reflections, not lessons/articles.
 *   - `verifiedOnly=true` — curation gate. Drops unverified user posts so
 *     the inline surface stays safe to display next to the ayah without
 *     a moderation layer Qariah doesn't yet have.
 *   - `tab=popular` — likes-ordered. Avoids the noisier `recent` tab.
 *   - `languages=${locale},en` — caller-locale-first then English fallback.
 *
 * **Auth strategy — client_credentials, not user-OAuth.**
 * QF enforces a server-side rule that `/quran-reflect/v1/posts/feed`
 * only authorizes the `post.read` scope when the bearer token was issued
 * via `client_credentials` — not when the same scope is present on a
 * user-OAuth (`authorization_code`) token. Sprint 27's first cut routed
 * through the SDK (`postsControllerFeed`, typed `auth: "user"`) and
 * shipped 403s in production (TestFlight 3.1.7 (1245), 2026-05-27). This
 * function bypasses the SDK and issues a raw `fetch` with a cc token
 * minted by `services/auth/qfClientCredentials.ts`. The SDK can't help
 * here because its operation descriptor for `postsControllerFeed` is
 * hardcoded to user auth.
 *
 * Side effect: the call works for signed-in AND signed-out users, which
 * matches Flutter prod's design (its `ayahReflectionsFeedPublic` variant
 * uses the same anonymous-read shape). Write actions (publish, like,
 * comment) still need user-OAuth and go through their own paths.
 */
export async function listCommunityReflectionsByAyah(
  chapterId: number,
  verseNumber: number,
  locale?: string,
): Promise<AyahReflection[]> {
  const languages = locale && locale !== 'en' ? `${locale},en` : 'en';
  const cfg = getQfOAuthConfig();
  const ccToken = await getQfClientCredentialsToken();
  const params = new URLSearchParams();
  params.set('filter[references][0][chapterId]', String(chapterId));
  params.set('filter[references][0][from]', String(verseNumber));
  params.set('filter[references][0][to]', String(verseNumber));
  params.set('filter[postTypeIds]', '1');
  params.set('filter[verifiedOnly]', 'true');
  params.set('tab', 'popular');
  params.set('languages', languages);
  params.set('page', '1');
  const url = `${getQfApiBase()}/quran-reflect/v1/posts/feed?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      'x-client-id': cfg.clientId,
      'x-auth-token': ccToken,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(
      `QF /quran-reflect/v1/posts/feed?ref=${chapterId}:${verseNumber} failed: ${res.status} ${bodyText.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as unknown;
  const raw = unwrapList<QfFeedEntry>(json);
  const out: AyahReflection[] = [];
  for (const entry of raw) {
    const norm = normalizeFeedEntry(entry);
    if (norm) out.push(norm);
  }
  return out;
}
