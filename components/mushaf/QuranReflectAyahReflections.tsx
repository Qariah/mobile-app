/**
 * Qariah's inline community-reflections card on an ayah: the fork's
 * RFC-018 `branding.ayahCommunityReflectionsComponent`.
 *
 * Sprint 27 (S27.4) wrote this as `components/mushaf/AyahCommunityReflections.tsx`
 * and mounted it from `VerseItem`. Upstream merged RFC-018 (Bayaan #306), so
 * that path is now upstream's default-noop wrapper: it mounts this component
 * under the Arabic line only when the provider is wired and the reader's
 * `showCommunityReflections` toggle is on, inside a silent error boundary.
 * This component therefore does not read the toggle.
 *
 * Render-state matrix:
 *
 *   loading        → spinner card
 *   empty          → null (no DOM — keep the Mushaf clean)
 *   error          → null (silent — the provider reports to Sentry)
 *   1 reflection   → 1 reflection card
 *   N>1            → 1 reflection card + "View N-1 more" link
 *
 * Only the single top popular verified reflection renders inline (user
 * feedback 2026-05-28: a card per reflection was a wall of text on hot
 * ayat). The rest sit behind a link to the QuranReflect verse page.
 *
 * Reads need no sign-in: the provider uses a client_credentials token
 * (`services/auth/qfClientCredentials.ts`).
 *
 * The render state is module-local (one map shared by every mounted verse
 * row), so a recycled or re-mounted row shows its known state at once and
 * scrolling away and back does not refetch. The provider
 * (`services/userState/communityReflectionsProvider.ts`) shares the request
 * with the action-sheet popup.
 */

import React, {useEffect, useMemo, useState} from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import {moderateScale} from 'react-native-size-matters';
import {Feather} from '@expo/vector-icons';
import {useTheme} from '@/hooks/useTheme';
import branding from '@/config/branding';
import type {CommunityReflection} from '@/types/CommunityReflection';
import {openExternalUrl} from '@/utils/openExternalUrl';
import {quranReflectVerseUrl} from '@/services/userState/communityReflectionsProvider';
import {useTranslation} from 'react-i18next';
import {formatNumber} from '@/i18n/format';

interface CacheEntry {
  state: 'loading' | 'loaded' | 'error';
  data?: CommunityReflection[];
  /** ms epoch — an idempotency guard if a stale promise resolves after a newer one. */
  startedAt: number;
}

// Module-local — shared across all verse rows in the JS context.
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
  surahNumber: number,
  ayahNumber: number,
): Promise<void> {
  const provider = branding.communityReflectionsProvider;
  if (!provider) return; // the upstream wrapper gates on this
  const startedAt = Date.now();
  cache.set(verseKey, {state: 'loading', startedAt});
  notify(verseKey);
  try {
    const data = await provider(surahNumber, ayahNumber, 'en');
    // Skip if a newer fetch superseded this one
    const cur = cache.get(verseKey);
    if (cur && cur.startedAt !== startedAt) return;
    cache.set(verseKey, {state: 'loaded', data, startedAt});
    notify(verseKey);
  } catch {
    // The provider already reported the failure to Sentry.
    const cur = cache.get(verseKey);
    if (cur && cur.startedAt !== startedAt) return;
    cache.set(verseKey, {state: 'error', startedAt});
    notify(verseKey);
  }
}

interface QuranReflectAyahReflectionsProps {
  surahNumber: number;
  ayahNumber: number;
}

export function QuranReflectAyahReflections({
  surahNumber,
  ayahNumber,
}: QuranReflectAyahReflectionsProps) {
  const {theme} = useTheme();
  const {t} = useTranslation(['qariah']);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const verseKey = `${surahNumber}:${ayahNumber}`;

  // Re-render when this verse's cache entry changes
  const [, setTick] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribe(verseKey, () => setTick(tick => tick + 1));
    // Kick off a fetch if we haven't yet for this verse
    if (!cache.has(verseKey)) {
      void fetchReflections(verseKey, surahNumber, ayahNumber);
    }
    return unsubscribe;
  }, [verseKey, surahNumber, ayahNumber]);

  const entry = cache.get(verseKey);

  if (!entry || entry.state === 'loading') {
    return (
      <View style={styles.statusCard}>
        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
      </View>
    );
  }

  if (entry.state === 'error') {
    return null;
  }

  const reflections = entry.data ?? [];
  if (reflections.length === 0) {
    // Keep the Mushaf clean — no "No reflections yet" card on every empty
    // verse (user feedback 2026-05-27).
    return null;
  }

  const top = reflections[0];
  const moreCount = reflections.length - 1;
  const verseUrl = quranReflectVerseUrl(surahNumber, ayahNumber);

  return (
    <View style={styles.container}>
      <ReflectionCard reflection={top} styles={styles} theme={theme} />
      {moreCount > 0 && (
        <Pressable
          style={styles.viewMoreRow}
          onPress={() =>
            openExternalUrl(verseUrl, t('qariah:links.quranReflect'))
          }
          accessibilityRole="link"
          accessibilityLabel={t('qariah:reflections.viewMoreA11y', {
            count: moreCount,
          })}>
          <Text style={styles.viewMoreText}>
            {t('qariah:reflections.viewMore', {count: moreCount})}
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
  reflection: CommunityReflection;
  styles: ReturnType<typeof createStyles>;
  theme: ReturnType<typeof useTheme>['theme'];
}

function ReflectionCard({reflection, styles, theme}: ReflectionCardProps) {
  const {t} = useTranslation(['qariah']);
  const preview = reflection.body.trim();
  return (
    <Pressable
      style={styles.reflectionCard}
      onPress={() =>
        openExternalUrl(reflection.url, t('qariah:links.thisReflectionOnQR'))
      }>
      <View style={styles.reflectionHeader}>
        <Text style={styles.authorName} numberOfLines={1}>
          {reflection.author.name}
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
            <Text style={styles.metaText}>
              {formatNumber(reflection.likesCount)}
            </Text>
          </View>
        )}
        {reflection.commentsCount > 0 && (
          <View style={styles.metaItem}>
            <Feather
              name="message-circle"
              size={moderateScale(11)}
              color={theme.colors.textSecondary}
            />
            <Text style={styles.metaText}>
              {formatNumber(reflection.commentsCount)}
            </Text>
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
