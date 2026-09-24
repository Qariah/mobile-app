/**
 * Sprint 27 follow-up (2026-05-28) — popup screen inside VerseActionsSheet
 * that shows the FULL list of community reflections for an ayah. Triggered
 * by the "Community Reflections" row in the EXPLORE group of the action
 * sheet (long-press an ayah).
 *
 * Companion to the inline `AyahCommunityReflections.tsx` (Mushaf list view,
 * which only renders the top reflection). Both consume the same provider
 * `branding.communityReflectionsProvider` which in Qariah resolves to
 * `listCommunityReflectionsByAyah` over QF prelive/prod.
 *
 * No sign-in needed (reads use a client_credentials token — see
 * `services/auth/qfClientCredentials.ts`).
 */

import React, {useState, useMemo, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import {openExternalUrl} from '@/utils/openExternalUrl';
import {
  ScaledSheet,
  moderateScale,
  verticalScale,
} from 'react-native-size-matters';
import Color from 'color';
import {Feather} from '@expo/vector-icons';
import * as Sentry from '@sentry/react-native';
import {useTheme} from '@/hooks/useTheme';
import {Theme} from '@/utils/themeUtils';
import SkiaVersePreview from '@/components/share/SkiaVersePreview';
import branding from '@/config/branding';
import {
  authorLabel,
  type AyahReflection,
} from '@/services/userState/communityReflections';

interface CommunityReflectionsContentProps {
  surahNumber: number;
  ayahNumber: number;
  rewayah?: import('@/store/mushafSettingsStore').RewayahId;
  onBack: () => void;
}

type FetchState =
  | {kind: 'loading'}
  | {kind: 'loaded'; data: AyahReflection[]}
  | {kind: 'error'};

function quranReflectVerseUrl(chapterId: number, verseNumber: number): string {
  return `https://quranreflect.com/?reference=${chapterId}:${verseNumber}`;
}

export const CommunityReflectionsContent: React.FC<
  CommunityReflectionsContentProps
> = ({surahNumber, ayahNumber, rewayah}) => {
  const {theme} = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const verseKey = `${surahNumber}:${ayahNumber}`;
  const [state, setState] = useState<FetchState>({kind: 'loading'});

  useEffect(() => {
    const provider = branding.communityReflectionsProvider;
    if (!provider) {
      // Non-Qariah forks won't reach this screen (the row is gated on the
      // provider being defined), but be defensive.
      setState({kind: 'loaded', data: []});
      return;
    }
    let cancelled = false;
    setState({kind: 'loading'});
    provider(surahNumber, ayahNumber, 'en')
      .then(data => {
        if (cancelled) return;
        setState({kind: 'loaded', data});
      })
      .catch(err => {
        if (cancelled) return;
        setState({kind: 'error'});
        Sentry.captureException(err, {
          tags: {
            source: 'CommunityReflectionsContent',
            verseKey,
          },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [surahNumber, ayahNumber, verseKey]);

  const verseUrl = quranReflectVerseUrl(surahNumber, ayahNumber);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.scrollInner}
        showsVerticalScrollIndicator={false}
        bounces={true}>
        {/* Verse badge */}
        <View style={styles.verseBadge}>
          <Text style={styles.verseBadgeText}>{verseKey}</Text>
        </View>

        {/* Arabic text */}
        <SkiaVersePreview verseKey={verseKey} rewayah={rewayah} />

        {/* Divider */}
        <View style={styles.divider} />

        {/* Content */}
        {state.kind === 'loading' ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={theme.colors.text} />
          </View>
        ) : state.kind === 'error' ? (
          <Text style={styles.emptyText}>
            Couldn’t load reflections. Try again later.
          </Text>
        ) : state.data.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Feather
              name="message-square"
              size={moderateScale(28)}
              color={Color(theme.colors.text).alpha(0.2).toString()}
            />
            <Text style={styles.emptyTitle}>No reflections yet</Text>
            <Text style={styles.emptyText}>
              Be the first to publish a reflection on this verse.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionLabel}>
              {state.data.length}{' '}
              {state.data.length === 1 ? 'REFLECTION' : 'REFLECTIONS'}
            </Text>
            <View style={styles.reflectionList}>
              {state.data.map(r => (
                <ReflectionRow
                  key={String(r.id)}
                  reflection={r}
                  styles={styles}
                  theme={theme}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* Footer — link to QR verse-feed page */}
      {state.kind === 'loaded' && state.data.length > 0 && (
        <View style={[styles.footer, {paddingBottom: verticalScale(16)}]}>
          <Pressable
            style={({pressed}) => [
              styles.footerLink,
              pressed && {opacity: 0.6},
            ]}
            onPress={() => openExternalUrl(verseUrl, 'QuranReflect')}
            accessibilityRole="link"
            accessibilityLabel="View all reflections on QuranReflect">
            <Text style={styles.footerLinkText}>View all on QuranReflect</Text>
            <Feather
              name="external-link"
              size={moderateScale(14)}
              color={theme.colors.text}
            />
          </Pressable>
        </View>
      )}
    </View>
  );
};

interface ReflectionRowProps {
  reflection: AyahReflection;
  styles: ReturnType<typeof createStyles>;
  theme: Theme;
}

function ReflectionRow({reflection, styles, theme}: ReflectionRowProps) {
  const author = useMemo(
    () =>
      authorLabel(reflection as unknown as Parameters<typeof authorLabel>[0]),
    [reflection],
  );
  const handleOpen = useCallback(() => {
    openExternalUrl(
      `https://quranreflect.com/posts/${reflection.id}`,
      'this reflection on QuranReflect',
    );
  }, [reflection.id]);

  return (
    <Pressable
      style={({pressed}) => [
        styles.reflectionCard,
        pressed && styles.reflectionCardPressed,
      ]}
      onPress={handleOpen}>
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
      <Text style={styles.reflectionBody}>{reflection.body.trim()}</Text>
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

const createStyles = (theme: Theme) =>
  ScaledSheet.create({
    container: {
      flex: 1,
    },
    scrollContent: {
      flex: 1,
    },
    scrollInner: {
      paddingTop: verticalScale(16),
      paddingBottom: verticalScale(24),
    },
    verseBadge: {
      alignSelf: 'center',
      backgroundColor: Color(theme.colors.text).alpha(0.05).toString(),
      borderRadius: moderateScale(8),
      paddingHorizontal: moderateScale(12),
      paddingVertical: moderateScale(4),
      marginBottom: verticalScale(14),
    },
    verseBadgeText: {
      fontSize: moderateScale(11.5),
      fontFamily: 'Manrope-SemiBold',
      color: Color(theme.colors.textSecondary).alpha(0.7).toString(),
      letterSpacing: 0.3,
    },
    divider: {
      height: 1,
      backgroundColor: Color(theme.colors.text).alpha(0.06).toString(),
      marginVertical: verticalScale(12),
    },
    loadingContainer: {
      paddingVertical: verticalScale(40),
      alignItems: 'center',
    },
    emptyContainer: {
      paddingVertical: verticalScale(40),
      alignItems: 'center',
      gap: moderateScale(10),
      paddingHorizontal: moderateScale(20),
    },
    emptyTitle: {
      fontSize: moderateScale(15),
      fontFamily: 'Manrope-SemiBold',
      color: Color(theme.colors.text).alpha(0.7).toString(),
      marginTop: verticalScale(4),
    },
    emptyText: {
      fontSize: moderateScale(13),
      fontFamily: 'Manrope-Regular',
      color: Color(theme.colors.textSecondary).alpha(0.55).toString(),
      textAlign: 'center',
      lineHeight: moderateScale(19),
    },
    sectionLabel: {
      fontSize: moderateScale(10.5),
      fontFamily: 'Manrope-SemiBold',
      color: Color(theme.colors.textSecondary).alpha(0.5).toString(),
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: verticalScale(10),
      paddingHorizontal: moderateScale(16),
    },
    reflectionList: {
      gap: moderateScale(8),
      paddingHorizontal: moderateScale(16),
    },
    reflectionCard: {
      paddingVertical: moderateScale(12),
      paddingHorizontal: moderateScale(14),
      borderRadius: moderateScale(12),
      backgroundColor: Color(theme.colors.text).alpha(0.04).toString(),
      borderWidth: 1,
      borderColor: Color(theme.colors.text).alpha(0.06).toString(),
    },
    reflectionCardPressed: {
      backgroundColor: Color(theme.colors.text).alpha(0.08).toString(),
    },
    reflectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(6),
      marginBottom: verticalScale(6),
    },
    authorName: {
      fontSize: moderateScale(13),
      color: theme.colors.text,
      fontFamily: 'Manrope-SemiBold',
      flexShrink: 1,
    },
    reflectionBody: {
      fontSize: moderateScale(13.5),
      lineHeight: moderateScale(20),
      color: theme.colors.text,
      fontFamily: 'Manrope-Regular',
    },
    metaRow: {
      flexDirection: 'row',
      gap: moderateScale(14),
      marginTop: verticalScale(10),
    },
    metaItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(4),
    },
    metaText: {
      fontSize: moderateScale(11.5),
      color: theme.colors.textSecondary,
      fontFamily: 'Manrope-Regular',
    },
    footer: {
      paddingHorizontal: moderateScale(16),
      paddingTop: verticalScale(10),
      borderTopWidth: 1,
      borderTopColor: Color(theme.colors.text).alpha(0.06).toString(),
      alignItems: 'center',
    },
    footerLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: moderateScale(6),
      paddingVertical: verticalScale(8),
      paddingHorizontal: moderateScale(14),
    },
    footerLinkText: {
      fontSize: moderateScale(13),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.text,
    },
  });
