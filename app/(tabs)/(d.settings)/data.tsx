/**
 * Settings → Your Data screen.
 *
 * Lets the user:
 *   - Export their local Qariah state to a JSON file (share-sheet)
 *   - Import a previously-exported (or v1-migrated) JSON file
 *   - Retry the one-shot R2 restore if it never completed (signed-in only,
 *     and only when the device flag is unset)
 *
 * Concierge restore for the 7 non-QF social-auth users (per
 * `planning/sprint-11-concierge-list.md`) lands here too — they receive
 * their pre-extracted by-legacy-id JSON via email, then use Import.
 *
 * Sprint 11 (S11.5).
 */

import React, {useState, useEffect, useMemo} from 'react';
import {
  Text,
  Pressable,
  ScrollView,
  View,
  ActivityIndicator,
} from 'react-native';
import {moderateScale, ScaledSheet} from 'react-native-size-matters';
import Color from 'color';
import {Feather} from '@expo/vector-icons';
import {USE_GLASS, useGlassColorScheme} from '@/hooks/useGlassProps';
import {GlassView} from 'expo-glass-effect';
import {useTheme} from '@/hooks/useTheme';
import type {Theme} from '@/utils/themeUtils';
import {showToast} from '@/utils/toastUtils';
import {useAuth} from '@/services/auth';
import {useUserState} from '@/services/userState/UserStateContext';
import {
  exportAndShare,
  pickAndValidateImport,
  commitImport,
  type ImportCandidate,
} from '@/services/userState/exportImport';
import {isV1RestoreDone} from '@/services/userState/v1Restore';
import {ImportConfirmModal} from '@/components/auth/ImportConfirmModal';
import {useBottomInset} from '@/hooks/useBottomInset';
import * as Sentry from '@sentry/react-native';
import {useTranslation} from 'react-i18next';
import {flipX, latinLetterSpacing} from '@/utils/rtl';

export default function YourDataScreen() {
  const {theme} = useTheme();
  const {t} = useTranslation(['qariah', 'common']);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const glassColorScheme = useGlassColorScheme();
  const {status} = useAuth();
  const {retryV1Restore} = useUserState();
  // Sprint 12 fix — clear the floating mini-player + tab bar (zero when no track).
  const bottomInset = useBottomInset();

  const [exporting, setExporting] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const [importMerging, setImportMerging] = useState(false);
  const [importCandidate, setImportCandidate] =
    useState<ImportCandidate | null>(null);
  const [restoreDone, setRestoreDone] = useState<boolean | null>(null);
  const [retryingRestore, setRetryingRestore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    isV1RestoreDone().then(done => {
      if (!cancelled) setRestoreDone(done);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await exportAndShare();
      showToast(t('qariah:data.exportReady'), `${result.filename}`, 'done');
    } catch (e) {
      // The technical detail goes to Sentry; the user gets one sentence.
      Sentry.captureException(e, {tags: {scope: 'export-share'}});
      showToast(
        t('qariah:data.exportFailed'),
        t('qariah:data.genericError'),
        'error',
      );
    } finally {
      setExporting(false);
    }
  };

  const handleImportPick = async () => {
    setImportPending(true);
    try {
      const result = await pickAndValidateImport();
      switch (result.kind) {
        case 'candidate':
          setImportCandidate(result.candidate);
          break;
        case 'cancelled':
          break;
        case 'read-error':
        case 'schema-error':
          showToast(
            t('qariah:data.invalidFile'),
            result.kind === 'schema-error'
              ? t('qariah:data.notQariahExport')
              : t('qariah:data.cannotRead'),
            'error',
          );
          break;
      }
    } catch (e) {
      Sentry.captureException(e, {tags: {scope: 'import-pick'}});
      showToast(
        t('qariah:data.cannotOpen'),
        t('qariah:data.genericError'),
        'error',
      );
    } finally {
      setImportPending(false);
    }
  };

  const handleImportConfirm = async () => {
    if (!importCandidate) return;
    setImportMerging(true);
    try {
      const r = await commitImport(importCandidate.state);
      const total = r.recitersAdded + r.recitationsAdded + r.surahsAdded;
      if (total === 0 && r.surahsLostToWriteError > 0) {
        // #394 — the surah write failed, so "Nothing new to add" would be a
        // false explanation. This screen is where the restore flow sends
        // people to retry, so it must not report the failure as a no-op.
        showToast(
          t('qariah:data.surahFavoritesNotSaved'),
          t('qariah:data.outOfStorageRetry'),
          'error',
        );
      } else {
        showToast(
          t('qariah:data.importComplete'),
          total > 0
            ? t('qariah:data.importAdded', {
                reciters: t('qariah:counts.reciters', {count: r.recitersAdded}),
                recitations: t('qariah:counts.recitations', {
                  count: r.recitationsAdded,
                }),
                surahs: t('qariah:counts.surahs', {count: r.surahsAdded}),
              })
            : t('qariah:data.nothingNew'),
          'done',
        );
      }
      setRestoreDone(true);
    } catch (e) {
      Sentry.captureException(e, {tags: {scope: 'import-commit'}});
      showToast(
        t('qariah:data.importFailed'),
        t('qariah:data.genericError'),
        'error',
      );
    } finally {
      setImportMerging(false);
      setImportCandidate(null);
    }
  };

  const handleRetryRestore = async () => {
    setRetryingRestore(true);
    try {
      await retryV1Restore();
      setRestoreDone(true);
    } catch (e) {
      Sentry.captureException(e, {tags: {scope: 'v1-restore-retry'}});
      showToast(
        t('qariah:data.v1CheckFailed'),
        t('qariah:data.tryLater'),
        'error',
      );
    } finally {
      setRetryingRestore(false);
    }
  };

  const renderCard = (children: React.ReactNode) =>
    USE_GLASS ? (
      <GlassView
        style={styles.card}
        glassEffectStyle="regular"
        colorScheme={glassColorScheme}>
        {children}
      </GlassView>
    ) : (
      <View style={styles.card}>{children}</View>
    );

  return (
    <View style={styles.container}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.scrollContent,
          {paddingBottom: bottomInset + moderateScale(40)},
        ]}>
        <Text style={styles.intro}>{t('qariah:data.intro')}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>
            {t('qariah:data.backupSection')}
          </Text>
          {renderCard(
            <Pressable
              style={({pressed}) => [styles.row, pressed && styles.pressed]}
              onPress={handleExport}
              disabled={exporting}>
              <View style={styles.icon}>
                {exporting ? (
                  <ActivityIndicator color={theme.colors.text} />
                ) : (
                  <Feather
                    name="share"
                    size={moderateScale(20)}
                    color={theme.colors.text}
                  />
                )}
              </View>
              <View style={styles.textContainer}>
                <Text style={styles.title}>{t('qariah:data.export')}</Text>
                <Text style={styles.description}>
                  {t('qariah:data.exportDesc')}
                </Text>
              </View>
              <Feather
                name="chevron-right"
                style={flipX}
                size={moderateScale(16)}
                color={theme.colors.textSecondary}
              />
            </Pressable>,
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>
            {t('qariah:data.restoreSection')}
          </Text>
          {renderCard(
            <>
              <Pressable
                style={({pressed}) => [styles.row, pressed && styles.pressed]}
                onPress={handleImportPick}
                disabled={importPending}>
                <View style={styles.icon}>
                  {importPending ? (
                    <ActivityIndicator color={theme.colors.text} />
                  ) : (
                    <Feather
                      name="upload"
                      size={moderateScale(20)}
                      color={theme.colors.text}
                    />
                  )}
                </View>
                <View style={styles.textContainer}>
                  <Text style={styles.title}>{t('qariah:data.import')}</Text>
                  <Text style={styles.description}>
                    {t('qariah:data.importDesc')}
                  </Text>
                </View>
                <Feather
                  name="chevron-right"
                  style={flipX}
                  size={moderateScale(16)}
                  color={theme.colors.textSecondary}
                />
              </Pressable>

              {status === 'authenticated' && (
                <>
                  <View style={styles.divider} />
                  <Pressable
                    style={({pressed}) => [
                      styles.row,
                      pressed && styles.pressed,
                    ]}
                    onPress={handleRetryRestore}
                    disabled={retryingRestore}>
                    <View style={styles.icon}>
                      {retryingRestore ? (
                        <ActivityIndicator color={theme.colors.text} />
                      ) : (
                        <Feather
                          name="rotate-ccw"
                          size={moderateScale(20)}
                          color={theme.colors.text}
                        />
                      )}
                    </View>
                    <View style={styles.textContainer}>
                      <Text style={styles.title}>
                        {restoreDone
                          ? t('qariah:data.recheckV1')
                          : t('qariah:data.restoreV1')}
                      </Text>
                      <Text style={styles.description}>
                        {restoreDone
                          ? t('qariah:data.recheckV1Desc')
                          : t('qariah:data.restoreV1Desc')}
                      </Text>
                    </View>
                    <Feather
                      name="chevron-right"
                      style={flipX}
                      size={moderateScale(16)}
                      color={theme.colors.textSecondary}
                    />
                  </Pressable>
                </>
              )}
            </>,
          )}
        </View>
      </ScrollView>

      <ImportConfirmModal
        isVisible={importCandidate !== null}
        candidate={importCandidate}
        pending={importMerging}
        onConfirm={handleImportConfirm}
        onCancel={() => setImportCandidate(null)}
      />
    </View>
  );
}

const createStyles = (theme: Theme) =>
  ScaledSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollContent: {
      paddingHorizontal: moderateScale(16),
      paddingTop: moderateScale(16),
      paddingBottom: moderateScale(40),
    },
    intro: {
      fontSize: moderateScale(13),
      fontFamily: 'Manrope-Regular',
      color: theme.colors.textSecondary,
      lineHeight: moderateScale(18),
      marginBottom: moderateScale(16),
    },
    section: {
      marginBottom: moderateScale(14),
    },
    sectionHeader: {
      fontSize: moderateScale(10.5),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.textSecondary,
      letterSpacing: latinLetterSpacing(1.2),
      textTransform: 'uppercase',
      marginBottom: moderateScale(6),
      marginLeft: moderateScale(2),
    },
    card: {
      backgroundColor: USE_GLASS
        ? undefined
        : Color(theme.colors.text).alpha(0.04).toString(),
      borderRadius: moderateScale(14),
      borderWidth: USE_GLASS ? 0 : 1,
      borderColor: USE_GLASS
        ? undefined
        : Color(theme.colors.text).alpha(0.06).toString(),
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: moderateScale(12),
      paddingHorizontal: moderateScale(14),
    },
    pressed: {
      backgroundColor: Color(theme.colors.text).alpha(0.06).toString(),
    },
    divider: {
      height: 1,
      backgroundColor: Color(theme.colors.text)
        .alpha(USE_GLASS ? 0.1 : 0.06)
        .toString(),
      marginHorizontal: moderateScale(16),
    },
    icon: {
      marginRight: moderateScale(12),
      width: moderateScale(24),
      alignItems: 'center',
    },
    textContainer: {
      flex: 1,
      marginRight: moderateScale(10),
    },
    title: {
      fontSize: moderateScale(13.5),
      fontFamily: 'Manrope-Medium',
      color: theme.colors.text,
    },
    description: {
      fontSize: moderateScale(11),
      fontFamily: 'Manrope-Regular',
      color: theme.colors.textSecondary,
      marginTop: moderateScale(1),
    },
  });
