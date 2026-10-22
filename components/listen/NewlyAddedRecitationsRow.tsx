// @ai-generated
// Qariah (Sprint 48): the "Newly Added Recitations" Listen row, which lists recitations
// (`newly-added-recitations` in `branding.homeRowConfig`). The upstream-style
// `newly-added` row lists reciters and stays registered, switched off.
import React, {useCallback, useMemo} from 'react';
import {View, Text, StyleSheet, type ListRenderItem} from 'react-native';
import {moderateScale} from 'react-native-size-matters';
import {useTranslation} from 'react-i18next';
import {useTheme} from '@/hooks/useTheme';
import {useRecitersVersion} from '@/hooks/useRecitersVersion';
import type {NewlyAddedRecitation} from '@/data/reciterCollections';
import {RecitationCard} from '@/components/cards/RecitationCard';
import {playRecitation} from '@/services/player/utils/playRecitation';
import {getNewlyAddedRow, newlyAddedRecitationKey} from './newlyAddedRow';
import {RtlRowFlatList} from './RtlRowFlatList';

interface NewlyAddedRecitationsRowProps {
  /** For tests. The default plays the recitation and opens the player. */
  onRecitationPress?: (recitation: NewlyAddedRecitation) => void;
}

function defaultRecitationPress(recitation: NewlyAddedRecitation) {
  // playRecitation catches and logs its own errors.
  playRecitation(recitation.reciter, recitation.rewayah, recitation.surah);
}

/** Renders nothing when the catalog has no dated recitations. */
export function NewlyAddedRecitationsRow({
  onRecitationPress = defaultRecitationPress,
}: NewlyAddedRecitationsRowProps) {
  const {theme} = useTheme();
  const {t} = useTranslation('qariah');
  // `RECITERS` is refilled in place on each catalog load, so the row reads
  // the refill signal and computes again when it changes.
  const recitersVersion = useRecitersVersion();
  const recitations = useMemo(
    () => getNewlyAddedRow(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recitersVersion is the refill signal of RECITERS, which getNewlyAddedRow reads
    [recitersVersion],
  );

  const handlePress = useCallback(
    (recitation: NewlyAddedRecitation) => onRecitationPress(recitation),
    [onRecitationPress],
  );
  const renderItem: ListRenderItem<NewlyAddedRecitation> = useCallback(
    ({item}) => <RecitationCard recitation={item} onPress={handlePress} />,
    [handlePress],
  );

  if (recitations.length === 0) return null;

  return (
    <View style={styles.section} testID="newly-added-recitations-row">
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, {color: theme.colors.text}]}>
          {t('homeRows.newlyAddedRecitations')}
        </Text>
      </View>
      <RtlRowFlatList
        data={recitations}
        renderItem={renderItem}
        keyExtractor={newlyAddedRecitationKey}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sectionContent}
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={3}
      />
    </View>
  );
}

// The same values as the section styles in components/RecitersView.tsx, so
// the row lines up with the rows around it.
const styles = StyleSheet.create({
  section: {
    marginBottom: moderateScale(24),
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: moderateScale(16),
    marginBottom: moderateScale(16),
  },
  sectionTitle: {
    fontSize: moderateScale(18),
    fontFamily: 'Manrope-SemiBold',
  },
  sectionContent: {
    paddingHorizontal: moderateScale(16),
    gap: moderateScale(8),
  },
});
