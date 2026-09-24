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
import {View, Text, Pressable, ActivityIndicator, Platform, StyleSheet} from 'react-native';
import {moderateScale} from 'react-native-size-matters';
import BottomSheetModal from '@/components/BottomSheetModal';
import {useTheme} from '@/hooks/useTheme';
import {showToast} from '@/utils/toastUtils';
import {mergeV1IntoLocalStores, skipV1Restore, type RestoreCandidate} from '@/services/userState/v1Restore';
import {restoreQfNotesOnce, getLastNotesRestoreCount} from '@/services/userState/notesRestore';
import {analyticsService} from '@/services/analytics/AnalyticsService';
import * as Sentry from '@sentry/react-native';

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

export function V1RestoreModal({isVisible, candidate, onDone}: V1RestoreModalProps) {
  const {theme} = useTheme();
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
      const restored = result.recitersAdded + result.recitationsAdded + result.surahsAdded;
      const restoredAnyNotes = notesCount !== null && notesCount > 0;

      // The merge outcome already existed here (it built the toast string) and
      // was then discarded. `restored` is what the user was promised; the skip
      // counters are what explains a disappointing number.
      const candidateTotal =
        candidate.counts.reciters +
        candidate.counts.surahs +
        candidate.counts.recitations;
      analyticsService.trackV1RestoreMerged({
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
          `${result.recitersAdded} reciter${result.recitersAdded === 1 ? '' : 's'}`,
          `${result.recitationsAdded} recitation${result.recitationsAdded === 1 ? '' : 's'}`,
          `${result.surahsAdded} surah${result.surahsAdded === 1 ? '' : 's'}`,
        ];
        if (restoredAnyNotes) {
          parts.push(
            `${notesCount} personal note${notesCount === 1 ? '' : 's'}`,
          );
        }
        showToast(
          restored > 0 ? 'Favorites restored' : 'Personal notes restored',
          parts.join(', '),
          'done',
        );
      } else if (result.surahsLostToWriteError > 0) {
        // #394 — nothing landed BECAUSE the device could not store it. The
        // "nothing matched" copy below would be a false explanation here, and
        // it is the one the user can act on: this failure is retryable once
        // there is room.
        showToast(
          "Couldn't save your surah favorites",
          'Your device may be out of storage. Free up space, then retry from Settings → Your Data',
          'error',
        );
      } else {
        // Everything filtered out — most likely a slug-only mismatch set.
        showToast('Restore complete', 'Your account had no items that match the new app yet', 'done');
      }
    } catch (e) {
      Sentry.captureException(e, {tags: {scope: 'v1-restore-merge'}});
      showToast("Couldn't restore favorites", 'Try again from Settings → Your Data', 'error');
    } finally {
      setMerging(false);
      onDone();
    }
  }, [candidate, onDone]);

  const handleSkip = useCallback(async () => {
    // Also the backdrop-dismiss handler and the empty-state Continue button.
    // `pending_total` separates a real decline (items left on the table) from
    // the zero-item acknowledgement, so the two never blur together.
    if (candidate) {
      analyticsService.trackV1RestoreSkipped({
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
    <BottomSheetModal isVisible={isVisible} onClose={handleSkip} snapPoints={['55%']}>
      <View style={styles.container}>
        <Text style={[styles.title, {color: theme.colors.text}]}>
          {isEmpty ? 'Welcome back!' : 'Found your Qariah history'}
        </Text>

        <Text style={[styles.body, {color: theme.colors.textSecondary}]}>
          {isEmpty
            ? "We found your account but no saved favorites from the original Qariah app. You're starting fresh — explore freely."
            : describeCounts(counts)}
        </Text>

        {!isEmpty && counts.recitationsWithoutSlug > 0 && (
          <Text style={[styles.note, {color: theme.colors.textSecondary}]}>
            Note: {counts.recitationsWithoutSlug} recitation{counts.recitationsWithoutSlug === 1 ? '' : 's'} reference a reciter that isn't available in the new app yet — these will be skipped.
          </Text>
        )}

        <View style={styles.actions}>
          {merging ? (
            <View style={[styles.button, styles.primaryButton, {backgroundColor: theme.colors.primary}]}>
              <ActivityIndicator color={theme.colors.background} />
              <Text style={[styles.primaryButtonText, {color: theme.colors.background, marginLeft: 8}]}>
                Restoring…
              </Text>
            </View>
          ) : isEmpty ? (
            <Pressable
              style={[styles.button, styles.primaryButton, {backgroundColor: theme.colors.primary}]}
              onPress={handleSkip}>
              <Text style={[styles.primaryButtonText, {color: theme.colors.background}]}>
                Continue
              </Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                style={[styles.button, styles.primaryButton, {backgroundColor: theme.colors.primary}]}
                onPress={handleRestore}>
                <Text style={[styles.primaryButtonText, {color: theme.colors.background}]}>
                  Restore favorites
                </Text>
              </Pressable>
              <Pressable style={styles.skipLink} onPress={handleSkip}>
                <Text style={[styles.skipLinkText, {color: theme.colors.textSecondary}]}>
                  Skip for now
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </BottomSheetModal>
  );
}

function describeCounts(counts: RestoreCandidate['counts']): string {
  const parts: string[] = [];
  if (counts.reciters > 0)
    parts.push(`${counts.reciters} reciter favorite${counts.reciters === 1 ? '' : 's'}`);
  if (counts.recitations > 0)
    parts.push(`${counts.recitations} recitation favorite${counts.recitations === 1 ? '' : 's'}`);
  if (counts.surahs > 0)
    parts.push(`${counts.surahs} surah favorite${counts.surahs === 1 ? '' : 's'}`);
  const list =
    parts.length === 1
      ? parts[0]
      : parts.length === 2
        ? parts.join(' and ')
        : `${parts.slice(0, -1).join(', ')}, and ${parts.slice(-1)[0]}`;
  return `We found ${list} from your original Qariah account. Restore them now?`;
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
