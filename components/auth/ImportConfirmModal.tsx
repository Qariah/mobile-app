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
import {useTranslation} from 'react-i18next';
import {currentLanguage} from '@/i18n/language';
import {SOURCE_LANGUAGE, getIntlLocale} from '@/i18n/languages';

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
  const {t} = useTranslation(['qariah', 'common']);
  if (!candidate) return null;

  const {counts, exportedAt, source} = candidate;
  const dateLabel = (() => {
    try {
      // English keeps the device's own date order (en-GB: 18/10/2026);
      // other languages use upstream's locale for that language.
      return new Date(exportedAt).toLocaleDateString(
        currentLanguage === SOURCE_LANGUAGE
          ? undefined
          : getIntlLocale(currentLanguage),
      );
    } catch {
      return exportedAt.slice(0, 10);
    }
  })();
  const sourceLabel =
    source === 'v1-extractor'
      ? t('qariah:import.sourceV1')
      : source === 'v2-export'
        ? t('qariah:import.sourceExport')
        : t('qariah:import.sourceServer');

  const totalItems = counts.reciters + counts.surahs + counts.recitations;

  return (
    <BottomSheetModal
      isVisible={isVisible}
      onClose={onCancel}
      snapPoints={['50%']}>
      <View style={styles.container}>
        <Text style={[styles.title, {color: theme.colors.text}]}>
          {t('qariah:import.title', {count: totalItems})}
        </Text>
        <Text style={[styles.body, {color: theme.colors.textSecondary}]}>
          {t('qariah:import.from', {source: sourceLabel, date: dateLabel})}
        </Text>
        <View style={styles.countsList}>
          {counts.reciters > 0 && (
            <Text style={[styles.countLine, {color: theme.colors.text}]}>
              {'· '}
              {t('qariah:counts.reciterFavorites', {count: counts.reciters})}
            </Text>
          )}
          {counts.recitations > 0 && (
            <Text style={[styles.countLine, {color: theme.colors.text}]}>
              {'· '}
              {t('qariah:counts.recitationFavorites', {
                count: counts.recitations,
              })}
            </Text>
          )}
          {counts.surahs > 0 && (
            <Text style={[styles.countLine, {color: theme.colors.text}]}>
              {'· '}
              {t('qariah:counts.surahFavorites', {count: counts.surahs})}
            </Text>
          )}
        </View>
        <Text style={[styles.note, {color: theme.colors.textSecondary}]}>
          {t('qariah:import.mergeNote')}
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
                {t('qariah:import.importing')}
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
                {t('qariah:import.confirm')}
              </Text>
            </Pressable>
          )}
          <Pressable style={styles.cancelLink} onPress={onCancel} hitSlop={12}>
            <Text
              style={[styles.cancelText, {color: theme.colors.textSecondary}]}>
              {t('common:actions.cancel')}
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
