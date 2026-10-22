/**
 * Sprint 27 (S27.4) — Inline community-reflections card on a Mushaf ayah.
 *
 * Mounted as a sibling View under the Arabic line in
 * `components/player/v2/PlayerContent/QuranView/VerseItem.tsx` (Mushaf
 * list-view mode + PlayerSheet verse list). All subscriptions (toggle,
 * reflection data) live here so VerseItem's already-bloated memo dep
 * array doesn't grow.
 *
 * Render-state matrix (post-2026-05-28 top-only fix):
 *
 *   showCommunityReflections=false                → null (no DOM)
 *   showCommunityReflections=true, loading        → spinner card
 *   showCommunityReflections=true, empty          → null (no DOM — keep Mushaf clean)
 *   showCommunityReflections=true, error          → null (silent — Sentry logs)
 *   showCommunityReflections=true, 1 reflection   → 1 reflection card
 *   showCommunityReflections=true, N>1 refl.      → 1 reflection card + "View N-1 more" link
 *
 * Only the single top popular verified reflection renders inline. Older
 * cuts of this component rendered every reflection per ayah, which gave
 * a wall of cards on hot ayat (3+ on An-Nisa:1, 7+ on Al-Baqarah:255).
 * User feedback 2026-05-28: surface the top reflection inline, push the
 * rest behind a tap that opens the QR verse-feed page.
 *
 * Read no longer requires sign-in. `listCommunityReflectionsByAyah`
 * uses a client_credentials token (see `services/auth/qfClientCredentials.ts`)
 * because QF rejects user-OAuth tokens on `/quran-reflect/v1/posts/feed`
 * even with `post.read` granted. Sign-in is still required for write
 * actions (publish, like, comment) handled in their own surfaces.
 *
 * Fetch caching is module-local (one `Map<verseKey, ...>` shared across
 * all mounted VerseItems) so scrolling away and back doesn't refetch.
 * Cache survives within a JS context.
 */

import React, {useEffect, useMemo, useState} from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import {openExternalUrl} from '@/utils/openExternalUrl';
import {moderateScale} from 'react-native-size-matters';
import * as Sentry from '@sentry/react-native';
import {Feather} from '@expo/vector-icons';
import {useTheme} from '@/hooks/useTheme';
import {useMushafSettingsStore} from '@/store/mushafSettingsStore';
import branding from '@/config/branding';
import {
  authorLabel,
  type AyahReflection,
} from '@/services/userState/communityReflections';

interface CacheEntry {
  state: 'loading' | 'loaded' | 'error';
  data?: AyahReflection[];
  /** ms epoch — used only as an idempotency guard if a stale promise resolves after a newer one. */
  startedAt: number;
}

// Module-local — shared across all VerseItem mounts in the JS context.
const cache: Map<string, CacheEntry> = new Map();
const subscribers: Map<string, Set<() => void>> = new Map();

function notify(verseKey: string) {
  const subs = subscribers.get(verseKey);
  if (subs) for (const fn of subs) fn();
}

function subscribe(verseKey: string, fn: () => void): () => void {
  let set = subscribers.get(verseKey);
  if (!set) {
    set = new Set();
    subscribers.set(verseKey, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
  };
}

async function fetchReflections(
  verseKey: string,
  chapterId: number,
  verseNumber: number,
  locale: string,
): Promise<void> {
  const provider = branding.communityReflectionsProvider;
  if (!provider) return; // shouldn't reach — caller gates on this
  const startedAt = Date.now();
  cache.set(verseKey, {state: 'loading', startedAt});
  notify(verseKey);
  try {
    const data = await provider(chapterId, verseNumber, locale);
    // Skip if a newer fetch superseded this one
    const cur = cache.get(verseKey);
    if (cur && cur.startedAt !== startedAt) return;
    cache.set(verseKey, {state: 'loaded', data, startedAt});
    notify(verseKey);
  } catch (err) {
    const cur = cache.get(verseKey);
    if (cur && cur.startedAt !== startedAt) return;
    cache.set(verseKey, {state: 'error', startedAt});
    notify(verseKey);
    Sentry.captureException(err, {
      tags: {
        source: 'communityReflectionsProvider',
        verseKey,
      },
    });
  }
}

interface AyahCommunityReflectionsProps {
  chapterId: number;
  verseNumber: number;
  verseKey: string;
}

/**
 * Canonical QR verse-feed URL. Probed 2026-05-28:
 *   /{chapter}/{verse}         → 307 redirect to /?filters=…
 *   /quran/{chapter}/{verse}   → 404
 *   /?reference={chapter}:{verse} → 200 (canonical)
 */
function quranReflectVerseUrl(chapterId: number, verseNumber: number): string {
  return `https://quranreflect.com/?reference=${chapterId}:${verseNumber}`;
}

export function AyahCommunityReflections({
  chapterId,
  verseNumber,
  verseKey,
}: AyahCommunityReflectionsProps) {
  const {theme} = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const showCommunityReflections = useMushafSettingsStore(
    s => s.showCommunityReflections,
  );

  // Force re-render when this verse's cache entry changes
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!showCommunityReflections) return;
    if (!branding.communityReflectionsProvider) return;
    const unsubscribe = subscribe(verseKey, () => setTick(t => t + 1));
    // Kick off a fetch if we haven't yet for this verse
    if (!cache.has(verseKey)) {
      void fetchReflections(verseKey, chapterId, verseNumber, 'en');
    }
    return unsubscribe;
  }, [showCommunityReflections, verseKey, chapterId, verseNumber]);

  if (!showCommunityReflections) return null;
  if (!branding.communityReflectionsProvider) return null;

  const entry = cache.get(verseKey);

  if (!entry || entry.state === 'loading') {
    return (
      <View style={styles.statusCard}>
        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
      </View>
    );
  }

  if (entry.state === 'error') {
    // Silent — Sentry already captured.
    return null;
  }

  const reflections = entry.data ?? [];
  if (reflections.length === 0) {
    // Keep Mushaf clean — no "No reflections yet" card on every empty
    // verse. Sprint 27 first cut showed the placeholder; user feedback
    // 2026-05-27 was that an empty card per verse is noisy.
    return null;
  }

  const top = reflections[0];
  const moreCount = reflections.length - 1;
  const verseUrl = quranReflectVerseUrl(chapterId, verseNumber);

  return (
    <View style={styles.container}>
      <ReflectionCard reflection={top} styles={styles} theme={theme} />
      {moreCount > 0 && (
        <Pressable
          style={styles.viewMoreRow}
          onPress={() => openExternalUrl(verseUrl, 'QuranReflect')}
          accessibilityRole="link"
          accessibilityLabel={`View ${moreCount} more reflections on QuranReflect`}>
          <Text style={styles.viewMoreText}>
            View {moreCount} more on QuranReflect
          </Text>
          <Feather
            name="external-link"
            size={moderateScale(11)}
            color={theme.colors.textSecondary}
          />
        </Pressable>
      )}
    </View>
  );
}

interface ReflectionCardProps {
  reflection: AyahReflection;
  styles: ReturnType<typeof createStyles>;
  theme: ReturnType<typeof useTheme>['theme'];
}

function ReflectionCard({reflection, styles, theme}: ReflectionCardProps) {
  const author = authorLabel(
    reflection as unknown as Parameters<typeof authorLabel>[0],
  );
  const preview = reflection.body.trim();
  return (
    <Pressable
      style={styles.reflectionCard}
      onPress={() =>
        openExternalUrl(
          `https://quranreflect.com/posts/${reflection.id}`,
          'this reflection on QuranReflect',
        )
      }>
      <View style={styles.reflectionHeader}>
        <Text style={styles.authorName} numberOfLines={1}>
          {author}
        </Text>
        {reflection.author.verified && (
          <Feather
            name="check-circle"
            size={moderateScale(12)}
            color={theme.colors.primary}
          />
        )}
      </View>
      <Text style={styles.reflectionBody} numberOfLines={4}>
        {preview}
      </Text>
      <View style={styles.metaRow}>
        {reflection.likesCount > 0 && (
          <View style={styles.metaItem}>
            <Feather
              name="heart"
              size={moderateScale(11)}
              color={theme.colors.textSecondary}
            />
            <Text style={styles.metaText}>{reflection.likesCount}</Text>
          </View>
        )}
        {reflection.commentsCount > 0 && (
          <View style={styles.metaItem}>
            <Feather
              name="message-circle"
              size={moderateScale(11)}
              color={theme.colors.textSecondary}
            />
            <Text style={styles.metaText}>{reflection.commentsCount}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>['theme']) {
  return StyleSheet.create({
    container: {
      marginTop: moderateScale(8),
      gap: moderateScale(6),
    },
    statusCard: {
      marginTop: moderateScale(8),
      paddingVertical: moderateScale(10),
      paddingHorizontal: moderateScale(12),
      borderRadius: moderateScale(10),
      backgroundColor: theme.colors.card,
      alignItems: 'center',
    },
    reflectionCard: {
      paddingVertical: moderateScale(10),
      paddingHorizontal: moderateScale(12),
      borderRadius: moderateScale(10),
      backgroundColor: theme.colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
    },
    reflectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(6),
      marginBottom: moderateScale(4),
    },
    authorName: {
      fontSize: moderateScale(12),
      color: theme.colors.text,
      fontFamily: 'Manrope-SemiBold',
      flexShrink: 1,
    },
    reflectionBody: {
      fontSize: moderateScale(13),
      lineHeight: moderateScale(19),
      color: theme.colors.text,
      fontFamily: 'Manrope-Regular',
    },
    metaRow: {
      flexDirection: 'row',
      gap: moderateScale(12),
      marginTop: moderateScale(8),
    },
    metaItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(4),
    },
    metaText: {
      fontSize: moderateScale(11),
      color: theme.colors.textSecondary,
      fontFamily: 'Manrope-Regular',
    },
    viewMoreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: moderateScale(6),
      paddingVertical: moderateScale(6),
      paddingHorizontal: moderateScale(12),
    },
    viewMoreText: {
      fontSize: moderateScale(12),
      color: theme.colors.textSecondary,
      fontFamily: 'Manrope-Medium',
    },
  });
}
