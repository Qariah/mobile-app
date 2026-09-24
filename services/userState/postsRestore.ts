/**
 * Sprint 21 round-5.2 — QuranReflect Posts → local Reflections backfill.
 *
 * Companion to Sprint 18's `notesRestore.ts`. Where `notesRestore` pulls
 * the user's QF Notes (`auth.v1.notes`) into the local SQLite cache,
 * this file pulls the user's published QuranReflect Posts (via
 * `quranReflect.v1.raw.postsControllerGetLoggedinUserPosts`) and
 * surfaces them in the Reflections collection.
 *
 * **Why this exists:** the user's Reflections collection used to only
 * show notes published via Qariah (those with `qf_post_id` set locally
 * during the publish flow). Posts published via QuranReflect web (or
 * any other QF-backed surface) had no local row → no Reflection entry.
 * After this backfill, the Reflections collection is the union of
 * (locally-published reflections) + (remote-only posts pulled here).
 *
 * **QR Post → QF Note linkage is one-way.** Verified against the official
 * QF API reference 2026-05-20: the Post entity has 39 fields and none
 * link back to the parent Note. We can't do a clean Note→Post join.
 * Instead, when a Post is found that no local row matches by `qf_post_id`,
 * we either:
 *   1. Match by `(verseKey, body)` against existing local notes with
 *      `qf_post_id == null` — if exactly one match, patch the local
 *      row's `qfPostId`.
 *   2. Create a new local row with `qfPostId` set (and `qfNoteId` null —
 *      we don't know the QF Note id for a remote-only post).
 *
 * Idempotent via `qfPostId` dedupe. Safe to call repeatedly; subsequent
 * calls only handle posts that became visible since the last sync.
 *
 * Pagination: QF returns `{total, currentPage, limit, pages, data: Post[]}`.
 * We paginate at `limit=20` until `currentPage >= pages` or empty batch.
 * The QF backend's `postsController.getLoggedinUserPosts` has a `@Max(25)`
 * decorator on the `limit` DTO field; anything over 25 returns 422
 * `UnprocessableEntityException` (QARIAHV2-7). Defaults to 20 for headroom.
 */

import {getQfSdk} from '@/services/auth/sdkClient';
import {withQfCall} from './qfErrors';
import * as Auth from '@/services/auth/qfOAuth';
import {verseAnnotationService} from '@/services/verse-annotations/VerseAnnotationService';
import {useVerseAnnotationsStore} from '@/store/verseAnnotationsStore';

interface QrPostReference {
  chapterId?: number | string;
  from?: number | string;
  to?: number | string;
}

export interface QrPost {
  id: number | string;
  body: string;
  references?: QrPostReference[];
  createdAt?: string;
  updatedAt?: string;
}

interface PostsListResponse {
  data?: QrPost[];
  posts?: QrPost[];
  total?: number;
  currentPage?: number;
  pages?: number;
  limit?: number;
}

function unwrapPostsList(res: unknown): QrPost[] {
  if (Array.isArray(res)) return res as QrPost[];
  if (res && typeof res === 'object') {
    const r = res as PostsListResponse;
    return r.data ?? r.posts ?? [];
  }
  return [];
}

function readPages(res: unknown): number {
  if (res && typeof res === 'object') {
    const r = res as PostsListResponse;
    return typeof r.pages === 'number' ? r.pages : 1;
  }
  return 1;
}

/**
 * Paginated fetch of the signed-in user's QuranReflect Posts.
 *
 * Operation: `postsControllerGetLoggedinUserPosts`
 * Path:      `/v1/posts/my-posts`
 *
 * Sprint 23 (S23.2) — switched from the auto-derived `posts.myPosts(…)`
 * shape to `quranReflect.v1.raw.postsControllerGetLoggedinUserPosts(…)`.
 * The auto-derived name was a guess: `/v1/posts/my-posts` has a
 * non-placeholder last segment, which the SDK's derivation pass does
 * NOT reliably map to `myPosts` — when it doesn't, the call throws
 * "is not a function" and the whole cold-start backfill errors out
 * (the red LogBox toast observed in the Sprint 22 iOS boot-gate).
 * Calling through `raw` keyed on the exact operationId is the robust
 * pattern already used by `communityReflections.ts` — see its header.
 */
export async function fetchAllMyPosts(pageLimit = 20): Promise<QrPost[]> {
  const sdk = getQfSdk();
  const out: QrPost[] = [];
  let page = 1;
  // Hard cap on iterations — defends against a broken `pages` value
  // looping forever. At limit=20 this caps at 5000 posts; if a user
  // has more than that, they need a server-side cursor anyway.
  const MAX_PAGES = 250;
  while (page <= MAX_PAGES) {
    const res = await withQfCall(
      `/posts/my-posts?page=${page}&limit=${pageLimit}`,
      async () =>
        sdk.quranReflect.v1.raw.postsControllerGetLoggedinUserPosts({
          query: {page, limit: pageLimit},
        }),
    );
    const batch = unwrapPostsList(res);
    out.push(...batch);
    const totalPages = readPages(res);
    if (batch.length === 0 || page >= totalPages) break;
    page += 1;
  }
  return out;
}

/**
 * Pull a single `(chapterId, from, to)` triple from the post's
 * references. Handles three response shapes:
 *   - `references: [{chapterId, from, to}]`
 *   - `references: [{chapterId, from: "1", to: "5"}]` (string-coerced)
 *   - missing references — returns null
 */
function firstReference(
  post: QrPost,
): {surah: number; from: number; to: number} | null {
  const ref = post.references?.[0];
  if (!ref) return null;
  const surah = Number(ref.chapterId);
  const from = Number(ref.from);
  const to = ref.to != null ? Number(ref.to) : from;
  if (!Number.isFinite(surah) || !Number.isFinite(from)) return null;
  return {
    surah,
    from,
    to: Number.isFinite(to) ? to : from,
  };
}

export type SyncOutcome =
  | {kind: 'no-auth'}
  | {kind: 'ok'; matched: number; created: number; alreadyLinked: number}
  | {kind: 'error'; detail: string};

/**
 * Backfill the local SQLite cache with the user's QR Posts.
 *
 * Side effects:
 *   - Patches `qf_post_id` onto unlinked local notes when an exact
 *     `(verseKey, content)` match exists.
 *   - Inserts new local rows for remote-only posts (no matching local
 *     note), with `qfPostId` set and `qfNoteId` null.
 *   - Hydrates the in-memory `useVerseAnnotationsStore` so the Mushaf
 *     overlay shows the new rows immediately.
 *
 * Idempotent: posts already linked by `qf_post_id` are skipped without
 * mutation. Safe to call on every Reflections-collection focus.
 */
export async function syncQfPostsToLocal(): Promise<SyncOutcome> {
  if (!(await Auth.isSignedIn())) return {kind: 'no-auth'};

  try {
    const posts = await fetchAllMyPosts();
    if (posts.length === 0) {
      return {kind: 'ok', matched: 0, created: 0, alreadyLinked: 0};
    }

    const allNotes = await verseAnnotationService.getAllNotes();
    const byPostId = new Map<string, true>();
    for (const n of allNotes) {
      if (n.qfPostId) byPostId.set(String(n.qfPostId), true);
    }

    let matched = 0;
    let created = 0;
    let alreadyLinked = 0;

    for (const post of posts) {
      try {
        const postId = String(post.id);
        if (byPostId.has(postId)) {
          alreadyLinked += 1;
          continue;
        }
        const ref = firstReference(post);
        if (!ref) {
          // No verse anchor we can use — skip silently.
          continue;
        }
        const verseKey = `${ref.surah}:${ref.from}`;
        const body = (post.body ?? '').trim();

        // Match-and-patch path — look for an existing unlinked local
        // note with the same verseKey and identical body. Exact match
        // only; loose-matching risks false positives on common short
        // reflections like "Subhanallah".
        const candidates = allNotes.filter(
          n =>
            n.verseKey === verseKey &&
            !n.qfPostId &&
            (n.content ?? '').trim() === body,
        );
        if (candidates.length === 1) {
          await verseAnnotationService.patchNoteQfIds(candidates[0].id, {
            qfPostId: postId,
          });
          // Mark in the byPostId set so further posts don't double-match
          // the now-linked local row.
          byPostId.set(postId, true);
          matched += 1;
          continue;
        }

        // Create-new path — remote-only post. Insert a local row with
        // qfPostId set; qfNoteId stays null because the Post → Note
        // back-pointer is not exposed by the API.
        const isRange = ref.from !== ref.to;
        const verseKeys = isRange
          ? Array.from(
              {length: ref.to - ref.from + 1},
              (_, i) => `${ref.surah}:${ref.from + i}`,
            )
          : undefined;
        const localNote = await verseAnnotationService.addNote(
          verseKey,
          ref.surah,
          ref.from,
          post.body,
          verseKeys,
          undefined,
        );
        await verseAnnotationService.patchNoteQfIds(localNote.id, {
          qfPostId: postId,
        });
        byPostId.set(postId, true);
        // Hydrate the in-memory overlay store.
        const store = useVerseAnnotationsStore.getState();
        const keys = verseKeys ?? [verseKey];
        for (const k of keys) store.addNote(k);
        created += 1;
      } catch (err) {
        // Continue on per-post error — don't let one bad row block sync.
        if (__DEV__) {
          console.warn('[postsRestore] post sync failed', post.id, err);
        }
      }
    }

    // Sprint 23 (S23.2) — was `console.error` (a Sprint-21 user-test
    // trace). `console.error` triggers RN's red LogBox on every Debug
    // cold launch — noise that masks real errors. This is a best-effort
    // background backfill; its result goes to __DEV__ logs here and to
    // Sentry via the caller (UserStateContext) for Release observability.
    if (__DEV__) {
      console.log('[postsRestore] sync-complete', {
        total: posts.length,
        matched,
        created,
        alreadyLinked,
      });
    }
    return {kind: 'ok', matched, created, alreadyLinked};
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Sprint 23 (S23.2) — downgraded from `console.error` so a failed
    // backfill doesn't red-box the user on cold start. The caller
    // Sentry-captures the {kind:'error'} return for Release tracking.
    if (__DEV__) {
      console.warn('[postsRestore] sync-error', detail);
    }
    return {kind: 'error', detail};
  }
}
