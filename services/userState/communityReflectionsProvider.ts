/**
 * Qariah's RFC-018 `CommunityReflectionsProvider` (QuranReflect-backed).
 *
 * `config/branding.js` sets `communityReflectionsProvider` to
 * `qariahCommunityReflectionsProvider`. Two surfaces call it for the same
 * ayah: the inline card (`components/mushaf/QuranReflectAyahReflections.tsx`,
 * the fork's `ayahCommunityReflectionsComponent`) and the upstream popup
 * (`components/sheets/verse-actions/CommunityReflectionsContent.tsx`).
 * RFC-018 makes caching the provider's job, so this module shares one
 * request per (surah, ayah, locale) between them.
 *
 * It maps Qariah's `AyahReflection` (the QF feed shape that
 * `listCommunityReflectionsByAyah` returns) onto upstream's
 * `CommunityReflection`.
 */

import * as Sentry from '@sentry/react-native';
import i18n from '@/i18n';
import type {
  CommunityReflection,
  CommunityReflectionsProvider,
} from '@/types/CommunityReflection';
import {
  listCommunityReflectionsByAyah,
  type AyahReflection,
} from './communityReflections';

/** QuranReflect permalink of one reflection (the URL Sprint 27 opened). */
export function quranReflectPostUrl(id: number | string): string {
  return `https://quranreflect.com/posts/${id}`;
}

/** Canonical QuranReflect verse-feed URL (probed 2026-05-28). */
export function quranReflectVerseUrl(
  surahNumber: number,
  ayahNumber: number,
): string {
  return `https://quranreflect.com/?reference=${surahNumber}:${ayahNumber}`;
}

// QF reports a language name, RFC-018 wants a language tag.
const LANGUAGE_TAGS: Record<string, string> = {
  english: 'en',
  arabic: 'ar',
  indonesian: 'id',
  urdu: 'ur',
  turkish: 'tr',
  french: 'fr',
  malay: 'ms',
  bengali: 'bn',
};

export function toCommunityReflection(r: AyahReflection): CommunityReflection {
  const languageName = r.languageName?.trim().toLowerCase() ?? '';
  return {
    id: String(r.id),
    author: {
      name:
        r.author.name ??
        r.author.username ??
        i18n.t('qariah:reflections.anonymous'),
      handle: r.author.username ?? '',
      verified: Boolean(r.author.verified),
    },
    body: r.body,
    likesCount: r.likesCount,
    commentsCount: r.commentsCount,
    publishedAt: r.publishedAt,
    url: quranReflectPostUrl(r.id),
    language: LANGUAGE_TAGS[languageName] ?? languageName,
  };
}

// One promise per key: in flight, or resolved. A rejection leaves the cache,
// so the next call retries. Map order is insertion order, so the first key
// is the oldest.
const MAX_CACHED_AYAHS = 300;
const cache = new Map<string, Promise<CommunityReflection[]>>();

export const qariahCommunityReflectionsProvider: CommunityReflectionsProvider =
  (surahNumber, ayahNumber, locale) => {
    const lang = locale ?? 'en';
    const key = `${surahNumber}:${ayahNumber}:${lang}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const request = listCommunityReflectionsByAyah(
      surahNumber,
      ayahNumber,
      lang,
    ).then(
      list => list.map(toCommunityReflection),
      (err: unknown) => {
        cache.delete(key);
        // The tag `source: 'communityReflectionsProvider'` is what the
        // beforeSend filter (services/diagnostics/qariahSentryOptions.ts)
        // matches to drop transient
        // network failures.
        Sentry.captureException(err, {
          tags: {
            source: 'communityReflectionsProvider',
            verseKey: `${surahNumber}:${ayahNumber}`,
          },
        });
        throw err;
      },
    );
    cache.set(key, request);
    if (cache.size > MAX_CACHED_AYAHS) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return request;
  };

/** Test-only: forget every cached request. */
export function __resetCommunityReflectionsCache(): void {
  cache.clear();
}
