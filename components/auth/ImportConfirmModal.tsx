/**
 * Sprint 11 — Import confirmation modal.
 *
 * Surfaces a parsed import candidate's counts + export date before merging.
 * "Import" triggers the same merge path the R2 v1 restore uses.
 *
 * Sprint 11 (S11.5).
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import {moderateScale} from 'react-native-size-matters';
import BottomSheetModal from '@/components/BottomSheetModal';
import {useTheme} from '@/hooks/useTheme';
import type {ImportCandidate} from '@/services/userState/exportImport';

interface ImportConfirmModalProps {
  isVisible: boolean;
  candidate: ImportCandidate | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ImportConfirmModal({
  isVisible,
  candidate,
  pending,
  onConfirm,
  onCancel,
}: ImportConfirmModalProps) {
  const {theme} = useTheme();
  if (!candidate) return null;

  const {counts, exportedAt, source} = candidate;
  const dateLabel = (() => {
    try {
      return new Date(exportedAt).toLocaleDateString();
    } catch {
      return exportedAt.slice(0, 10);
    }
  })();
  const sourceLabel =
    source === 'v1-extractor'
      ? 'original Qariah app'
      : source === 'v2-export'
        ? 'a Qariah export'
        : 'Qariah server';

  const totalItems = counts.reciters + counts.surahs + counts.recitations;

  return (
    <BottomSheetModal
      isVisible={isVisible}
      onClose={onCancel}
      snapPoints={['50%']}>
      <View style={styles.container}>
        <Text style={[styles.title, {color: theme.colors.text}]}>
          Import {totalItems} item{totalItems === 1 ? '' : 's'}?
        </Text>
        <Text style={[styles.body, {color: theme.colors.textSecondary}]}>
          From {sourceLabel} · exported {dateLabel}
        </Text>
        <View style={styles.countsList}>
          {counts.reciters > 0 && (
            <Text style={[styles.countLine, {color: theme.colors.text}]}>
              · {counts.reciters} reciter favorite
              {counts.reciters === 1 ? '' : 's'}
            </Text>
          )}
          {counts.recitations > 0 && (
            <Text style={[styles.countLine, {color: theme.colors.text}]}>
              · {counts.recitations} recitation favorite
              {counts.recitations === 1 ? '' : 's'}
            </Text>
          )}
          {counts.surahs > 0 && (
            <Text style={[styles.countLine, {color: theme.colors.text}]}>
              · {counts.surahs} surah favorite
              {counts.surahs === 1 ? '' : 's'}
            </Text>
          )}
        </View>
        <Text style={[styles.note, {color: theme.colors.textSecondary}]}>
          These will be merged with your existing favorites — nothing will be
          deleted.
        </Text>
        <View style={styles.actions}>
          {pending ? (
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
                Importing…
              </Text>
            </View>
          ) : (
            <Pressable
              style={[
                styles.button,
                styles.primaryButton,
                {backgroundColor: theme.colors.primary},
              ]}
              onPress={onConfirm}>
              <Text
                style={[
                  styles.primaryButtonText,
                  {color: theme.colors.background},
                ]}>
                Import
              </Text>
            </Pressable>
          )}
          <Pressable style={styles.cancelLink} onPress={onCancel} hitSlop={12}>
            <Text
              style={[styles.cancelText, {color: theme.colors.textSecondary}]}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: moderateScale(4),
  },
  title: {
    fontSize: moderateScale(20),
    fontFamily: 'Manrope-SemiBold',
    marginBottom: moderateScale(8),
  },
  body: {
    fontSize: moderateScale(14),
    fontFamily: 'Manrope-Regular',
    marginBottom: moderateScale(14),
  },
  countsList: {
    gap: moderateScale(4),
  },
  countLine: {
    fontSize: moderateScale(14),
    fontFamily: 'Manrope-Medium',
    lineHeight: moderateScale(20),
  },
  note: {
    fontSize: moderateScale(13),
    fontFamily: 'Manrope-Regular',
    marginTop: moderateScale(12),
    fontStyle: 'italic',
    lineHeight: moderateScale(18),
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
  cancelLink: {
    paddingVertical: moderateScale(10),
    alignItems: 'center',
  },
  cancelText: {
    fontSize: moderateScale(14),
    fontFamily: 'Manrope-Regular',
  },
});
