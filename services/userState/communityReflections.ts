/**
 * QuranReflect — inline community reflections (per ayah).
 *
 * Sits alongside `services/userState/notes.ts` (Sprint 18 / Slice B).
 * Notes.ts surfaces the user's OWN annotations (private QF Notes that
 * optionally publish to a QF Post). This file surfaces COMMUNITY
 * reflections — posts authored by other QF users — so the Mushaf-tab
 * "Community Reflections" toggle (Sprint 27 S27.4) can render them
 * inline under each ayah.
 *
 * Endpoint (quranReflect service, raw `fetch` with a client_credentials
 * token — see `listCommunityReflectionsByAyah`):
 *   GET  /quran-reflect/v1/posts/feed         — paginated community feed
 *                                                (bracket-array filter)
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
 * uses it.
 *
 * Divergence batch C3 (SEM-S2, 2026-10-24) removed the SDK wrappers that
 * no code called: the broken `listPostsByVerse`, `getPost`,
 * `togglePostLike`, the comment wrappers, `authorLabel` and their types.
 * Note for a later like or comment feature: the `quranReflect.v1.posts.*`
 * resource names are auto-derived by the SDK and are not reliable for a
 * path with a placeholder (`/v1/posts/by-verse/{verseKey}` maps to
 * `postsControllerGetMyPostsByVerse`). Call
 * `sdk.quranReflect.v1.raw.<operationId>` (see `postsRestore.ts`).
 */

import {getQfApiBase, getQfOAuthConfig} from '@/services/auth/config';
import {getQfClientCredentialsToken} from '@/services/auth/qfClientCredentials';
import {unwrapQfList} from './qfResponse';

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 27 — inline community reflections (per-ayah)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shape returned to inline-reflection consumers (Mushaf-tab card per ayah).
 *
 * Narrow and pre-normalized so the `<AyahCommunityReflections />`
 * subcomponent doesn't need to defend against shape variance at render time.
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
  const raw = unwrapQfList<QfFeedEntry>(json, [
    'data',
    'posts',
    'comments',
    'results',
  ]);
  const out: AyahReflection[] = [];
  for (const entry of raw) {
    const norm = normalizeFeedEntry(entry);
    if (norm) out.push(norm);
  }
  return out;
}
