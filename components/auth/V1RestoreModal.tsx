/**
 * Sprint 11 — Modal that offers to restore a signed-in user's Qariah v1
 * favorites from the pre-extracted R2 migration JSON.
 *
 * Lifecycle:
 *   - Mounted by AppLayout (via AppRootGate or the post-sign-in branch in
 *     UserStateContext). Controlled by `isVisible`.
 *   - When `candidate` has counts > 0, body copy renders the count summary +
 *     a "Restore favorites" + "Skip for now" pair.
 *   - When all counts are zero (empty-state — should be filtered before this
 *     modal opens, but the variant is here defensively), shows "found your
 *     account but no saved favorites" + single Continue button.
 *
 * Tap "Restore favorites" → calls `mergeV1IntoLocalStores(candidate.state)`,
 * shows inline ActivityIndicator while merging, fires success toast on
 * completion, calls `onDone()` which closes the modal.
 *
 * No api-v2 server-side sync in Sprint 11 (D1). D2 will add it.
 *
 * Sprint 11 (S11.3).
 */

import React, {useState, useCallback} from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Platform,
  StyleSheet,
} from 'react-native';
import {moderateScale} from 'react-native-size-matters';
import BottomSheetModal from '@/components/BottomSheetModal';
import {useTheme} from '@/hooks/useTheme';
import {showToast} from '@/utils/toastUtils';
import {
  mergeV1IntoLocalStores,
  skipV1Restore,
  type RestoreCandidate,
} from '@/services/userState/v1Restore';
import {
  restoreQfNotesOnce,
  getLastNotesRestoreCount,
} from '@/services/userState/notesRestore';
import {qariahAnalytics} from '@/services/analytics/qariahEvents';
import * as Sentry from '@sentry/react-native';
import {useTranslation} from 'react-i18next';
import type {TFunction} from 'i18next';
import {formatCommaList, formatList} from '@/i18n/qariahList';

/** Sentry message for the pathological case. Also the explicit fingerprint —
 *  Sentry groups `captureMessage` by CALL SITE, so without this it would
 *  collapse into whatever else this component reports (standing rule
 *  2026-06-17, same reason `captureAndFlush` fingerprints by message). */
const ZERO_MERGE_MESSAGE = 'v1-restore-zero-merge';

/** #394 — the partial-loss sibling of ZERO_MERGE_MESSAGE. Its own message (and
 *  so its own fingerprint) because it is a different failure with a different
 *  cause: the device could not write, rather than the merge finding nothing to
 *  do. Grouping the two would bury a storage fault inside an issue whose title
 *  says the merge was empty. */
const WRITE_LOSS_MESSAGE = 'v1-restore-write-loss';

/**
 * Should the zero-merge alarm fire for this merge outcome?
 *
 * The silent catastrophic failure: we showed the user a real list of their v1
 * favorites, they tapped Restore, nothing threw — and nothing landed. Loud on
 * purpose.
 *
 * Two outcomes look identical on the surface and are deliberately NOT that:
 *
 *   - `candidateTotal === 0` — the empty-state, not a failure. Nothing was
 *     offered, so nothing landing is correct.
 *   - `alreadyPresent === candidateTotal` — #388. Every offered item was
 *     already in the local stores, so the merge had nothing left to do. This
 *     is the benign re-run (Settings → Your Data on a device that already
 *     merged), and before the already-present counters existed it reached the
 *     alarm with the exact all-zero ledger of a real failure.
 *
 * Every other `restored === 0` still fires — including a merge whose items
 * were eaten by the skip filters, which is why the suppression is
 * `alreadyPresent < candidateTotal` and not merely `alreadyPresent > 0`.
 *
 * Exported as a pure predicate so the boundary is testable on its own. The
 * thing being repaired here is trust in an alarm, so a regression in this line
 * is otherwise invisible.
 */
export function shouldReportZeroMerge(
  candidateTotal: number,
  restored: number,
  alreadyPresent: number,
): boolean {
  return (
    candidateTotal > 0 && restored === 0 && alreadyPresent < candidateTotal
  );
}

/**
 * Should the write-loss alarm fire for this merge outcome?
 *
 * #394 — the failure `shouldReportZeroMerge` is structurally blind to. A full
 * device (QARIAHV2-20) throws inside the plain-surah write, so those rows never
 * reach disk. The reciter and recitation merges still succeeded, which leaves
 * `restored > 0` — and every condition in the zero-merge predicate is gated on
 * `restored === 0`. A partial loss could therefore never report, no matter how
 * many rows it ate.
 *
 * So the trigger here is the loss itself, independent of how much else landed.
 * This is a data-loss report, not a merge-quality one.
 *
 * Exported as a pure predicate for the same reason as its sibling: the thing
 * being repaired is an alarm, and an alarm that stops alarming is silent.
 */
export function shouldReportWriteLoss(lostTotal: number): boolean {
  return lostTotal > 0;
}

interface V1RestoreModalProps {
  isVisible: boolean;
  candidate: RestoreCandidate | null;
  onDone: () => void;
}

export function V1RestoreModal({
  isVisible,
  candidate,
  onDone,
}: V1RestoreModalProps) {
  const {theme} = useTheme();
  const {t} = useTranslation(['qariah', 'common']);
  const [merging, setMerging] = useState(false);

  const handleRestore = useCallback(async () => {
    if (!candidate) return;
    setMerging(true);
    try {
      const result = await mergeV1IntoLocalStores(candidate.state);
      // Sprint 27 close (2026-05-29) — also pull QF Notes count for the
      // toast. `restoreQfNotesOnce` is idempotent + singleton-promised, so
      // calling it here is safe even though UserStateContext also fires it
      // in parallel after the auth transition. Whichever caller lands first
      // does the work + writes the count to the flag; the other awaits
      // the same promise OR reads the cached count.
      let notesCount: number | null = null;
      try {
        const notesResult = await restoreQfNotesOnce();
        if (notesResult.kind === 'restored') {
          notesCount = notesResult.count;
        } else if (notesResult.kind === 'already-done') {
          notesCount = notesResult.count; // may be null (pre-upgrade install)
        } else if (notesResult.kind === 'empty') {
          notesCount = 0;
        }
        // For 'error' / 'no-auth' kinds: leave null → notes line omitted
        // from the toast (the merge itself still succeeded).
        if (notesCount === null) {
          notesCount = await getLastNotesRestoreCount();
        }
      } catch {
        // Defensive — never let the notes branch break the favorites toast.
      }
      const restored =
        result.recitersAdded + result.recitationsAdded + result.surahsAdded;
      const restoredAnyNotes = notesCount !== null && notesCount > 0;

      // The merge outcome already existed here (it built the toast string) and
      // was then discarded. `restored` is what the user was promised; the skip
      // counters are what explains a disappointing number.
      const candidateTotal =
        candidate.counts.reciters +
        candidate.counts.surahs +
        candidate.counts.recitations;
      qariahAnalytics.trackV1RestoreMerged({
        platform: Platform.OS,
        restored_total: restored,
        reciters_added: result.recitersAdded,
        recitations_added: result.recitationsAdded,
        surahs_added: result.surahsAdded,
        reciters_skipped_no_slug: result.recitersSkippedNoSlug,
        recitations_skipped_no_slug: result.recitationsSkippedNoSlug,
        recitations_skipped_no_surah: result.recitationsSkippedNoSurah,
        recitations_skipped_no_reciter: result.recitationsSkippedNoReciter,
        recitations_skipped_no_rewayat: result.recitationsSkippedNoRewayat,
        candidate_total: candidateTotal,
        reciters_already_present: result.recitersAlreadyPresent,
        recitations_already_present: result.recitationsAlreadyPresent,
        surahs_already_present: result.surahsAlreadyPresent,
        surahs_lost_to_write_error: result.surahsLostToWriteError,
      });

      // See `shouldReportZeroMerge` above for why this fires and when it
      // deliberately does not. The counters ride along as `extra` so the issue
      // explains ITSELF: a non-zero skip names the filter that ate the items.
      const alreadyPresent =
        result.recitersAlreadyPresent +
        result.recitationsAlreadyPresent +
        result.surahsAlreadyPresent;
      const mergeExtra = {
        candidate_total: candidateTotal,
        candidate_reciters: candidate.counts.reciters,
        candidate_surahs: candidate.counts.surahs,
        candidate_recitations: candidate.counts.recitations,
        candidate_recitations_without_slug:
          candidate.counts.recitationsWithoutSlug,
        reciters_skipped_no_slug: result.recitersSkippedNoSlug,
        recitations_skipped_no_slug: result.recitationsSkippedNoSlug,
        recitations_skipped_no_surah: result.recitationsSkippedNoSurah,
        recitations_skipped_no_reciter: result.recitationsSkippedNoReciter,
        recitations_skipped_no_rewayat: result.recitationsSkippedNoRewayat,
        reciters_already_present: result.recitersAlreadyPresent,
        recitations_already_present: result.recitationsAlreadyPresent,
        surahs_already_present: result.surahsAlreadyPresent,
        already_present_total: alreadyPresent,
        restored_total: restored,
        surahs_added: result.surahsAdded,
        surahs_lost_to_write_error: result.surahsLostToWriteError,
      };
      if (shouldReportZeroMerge(candidateTotal, restored, alreadyPresent)) {
        Sentry.captureMessage(ZERO_MERGE_MESSAGE, {
          level: 'error',
          tags: {scope: 'v1-restore-zero-merge'},
          fingerprint: [ZERO_MERGE_MESSAGE],
          extra: mergeExtra,
        });
      }
      // #394 — reported independently of the zero-merge arm, and on the same
      // counters, because a storage failure can eat the surah rows while the
      // other two classes merge fine. That outcome carries `restored > 0`,
      // which every zero-merge condition excludes.
      if (shouldReportWriteLoss(result.surahsLostToWriteError)) {
        Sentry.captureMessage(WRITE_LOSS_MESSAGE, {
          level: 'error',
          tags: {scope: 'v1-restore-write-loss'},
          fingerprint: [WRITE_LOSS_MESSAGE],
          extra: mergeExtra,
        });
      }
      if (restored > 0 || restoredAnyNotes) {
        const parts = [
          t('qariah:counts.reciters', {count: result.recitersAdded}),
          t('qariah:counts.recitations', {count: result.recitationsAdded}),
          t('qariah:counts.surahs', {count: result.surahsAdded}),
        ];
        if (restoredAnyNotes) {
          parts.push(
            t('qariah:counts.personalNotes', {count: notesCount ?? 0}),
          );
        }
        showToast(
          restored > 0
            ? t('qariah:v1.favoritesRestored')
            : t('qariah:v1.notesRestored'),
          formatCommaList(parts),
          'done',
        );
      } else if (result.surahsLostToWriteError > 0) {
        // #394 — nothing landed BECAUSE the device could not store it. The
        // "nothing matched" copy below would be a false explanation here, and
        // it is the one the user can act on: this failure is retryable once
        // there is room.
        showToast(
          t('qariah:data.surahFavoritesNotSaved'),
          t('qariah:v1.outOfStorage'),
          'error',
        );
      } else {
        // Everything filtered out — most likely a slug-only mismatch set.
        showToast(
          t('qariah:v1.restoreComplete'),
          t('qariah:v1.noMatches'),
          'done',
        );
      }
    } catch (e) {
      Sentry.captureException(e, {tags: {scope: 'v1-restore-merge'}});
      showToast(
        t('qariah:v1.restoreFailed'),
        t('qariah:v1.retryFromSettings'),
        'error',
      );
    } finally {
      setMerging(false);
      onDone();
    }
  }, [candidate, onDone, t]);

  const handleSkip = useCallback(async () => {
    // Also the backdrop-dismiss handler and the empty-state Continue button.
    // `pending_total` separates a real decline (items left on the table) from
    // the zero-item acknowledgement, so the two never blur together.
    if (candidate) {
      qariahAnalytics.trackV1RestoreSkipped({
        platform: Platform.OS,
        pending_total:
          candidate.counts.reciters +
          candidate.counts.surahs +
          candidate.counts.recitations,
        reciters: candidate.counts.reciters,
        surahs: candidate.counts.surahs,
        recitations: candidate.counts.recitations,
      });
    }
    await skipV1Restore();
    onDone();
  }, [candidate, onDone]);

  if (!candidate) {
    return null;
  }

  const {counts} = candidate;
  const isEmpty =
    counts.reciters === 0 && counts.surahs === 0 && counts.recitations === 0;

  return (
    <BottomSheetModal
      isVisible={isVisible}
      onClose={handleSkip}
      snapPoints={['55%']}>
      <View style={styles.container}>
        <Text style={[styles.title, {color: theme.colors.text}]}>
          {isEmpty ? t('qariah:v1.welcomeBack') : t('qariah:v1.foundHistory')}
        </Text>

        <Text style={[styles.body, {color: theme.colors.textSecondary}]}>
          {isEmpty ? t('qariah:v1.nothingFound') : describeCounts(counts, t)}
        </Text>

        {!isEmpty && counts.recitationsWithoutSlug > 0 && (
          <Text style={[styles.note, {color: theme.colors.textSecondary}]}>
            {t('qariah:v1.skippedNote', {
              count: counts.recitationsWithoutSlug,
            })}
          </Text>
        )}

        <View style={styles.actions}>
          {merging ? (
            <View
              style={[
                styles.button,
                styles.primaryButton,
                {backgroundColor: theme.colors.primary},
              ]}>
              <ActivityIndicator color={theme.colors.background} />
              <Text
                style={[
                  styles.primaryButtonText,
                  {color: theme.colors.background, marginLeft: 8},
                ]}>
                {t('qariah:v1.restoring')}
              </Text>
            </View>
          ) : isEmpty ? (
            <Pressable
              style={[
                styles.button,
                styles.primaryButton,
                {backgroundColor: theme.colors.primary},
              ]}
              onPress={handleSkip}>
              <Text
                style={[
                  styles.primaryButtonText,
                  {color: theme.colors.background},
                ]}>
                {t('common:actions.continue')}
              </Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                style={[
                  styles.button,
                  styles.primaryButton,
                  {backgroundColor: theme.colors.primary},
                ]}
                onPress={handleRestore}>
                <Text
                  style={[
                    styles.primaryButtonText,
                    {color: theme.colors.background},
                  ]}>
                  {t('qariah:v1.restoreFavorites')}
                </Text>
              </Pressable>
              <Pressable style={styles.skipLink} onPress={handleSkip}>
                <Text
                  style={[
                    styles.skipLinkText,
                    {color: theme.colors.textSecondary},
                  ]}>
                  {t('qariah:common.skipForNow')}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </BottomSheetModal>
  );
}

type RestoreT = TFunction<['qariah', 'common']>;

function describeCounts(
  counts: RestoreCandidate['counts'],
  t: RestoreT,
): string {
  const parts: string[] = [];
  if (counts.reciters > 0)
    parts.push(t('qariah:counts.reciterFavorites', {count: counts.reciters}));
  if (counts.recitations > 0)
    parts.push(
      t('qariah:counts.recitationFavorites', {count: counts.recitations}),
    );
  if (counts.surahs > 0)
    parts.push(t('qariah:counts.surahFavorites', {count: counts.surahs}));
  return t('qariah:v1.foundList', {list: formatList(parts)});
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: moderateScale(4),
  },
  title: {
    fontSize: moderateScale(22),
    fontFamily: 'Manrope-SemiBold',
    marginBottom: moderateScale(12),
  },
  body: {
    fontSize: moderateScale(15),
    fontFamily: 'Manrope-Regular',
    lineHeight: moderateScale(22),
    marginBottom: moderateScale(8),
  },
  note: {
    fontSize: moderateScale(13),
    fontFamily: 'Manrope-Regular',
    lineHeight: moderateScale(18),
    marginTop: moderateScale(8),
    fontStyle: 'italic',
  },
  actions: {
    marginTop: 'auto',
    paddingBottom: moderateScale(12),
    gap: moderateScale(8),
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: moderateScale(14),
    paddingHorizontal: moderateScale(20),
    borderRadius: moderateScale(12),
  },
  primaryButton: {},
  primaryButtonText: {
    fontSize: moderateScale(16),
    fontFamily: 'Manrope-SemiBold',
  },
  skipLink: {
    paddingVertical: moderateScale(10),
    alignItems: 'center',
  },
  skipLinkText: {
    fontSize: moderateScale(14),
    fontFamily: 'Manrope-Regular',
  },
});
