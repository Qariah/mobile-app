// @ai-generated
// Qariah (#847, option C): the "Follow Along" Listen row, which lists
// recitations with follow-along (`follow-along-recitations` in
// `branding.homeRowConfig`). The upstream `follow-along` row lists qariahs and
// stays registered, switched off. Approved mock:
// planning/ux/847-follow-along-marks/mocks/C.html.
import React, {useCallback, useMemo} from 'react';
import {View, Text, StyleSheet, type ListRenderItem} from 'react-native';
import {moderateScale} from '@/utils/scale';
import {useTranslation} from 'react-i18next';
import {useTheme} from '@/hooks/useTheme';
import {useRecitersVersion} from '@/hooks/useRecitersVersion';
import {useFollowAlongCoverage} from '@/hooks/useFollowAlongCoverage';
import {RecitationCard} from '@/components/cards/RecitationCard';
import {playRecitation} from '@/services/player/utils/playRecitation';
import {
  followAlongRecitationKey,
  selectFollowAlongRecitations,
  type FollowAlongRecitation,
} from './followAlongRow';
import {RtlRowFlatList} from './RtlRowFlatList';

interface FollowAlongRecitationsRowProps {
  /** The cards, from `useFollowAlongRecitations`. */
  recitations: FollowAlongRecitation[];
  /** For tests. The default plays the recitation and opens the player. */
  onRecitationPress?: (recitation: FollowAlongRecitation) => void;
  /** iPad shelf card width; phones omit it and keep the fixed card size. */
  cardWidth?: number;
}

function defaultRecitationPress(recitation: FollowAlongRecitation) {
  // playRecitation catches and logs its own errors.
  playRecitation(recitation.reciter, recitation.rewayah, recitation.surah);
}

/**
 * The cards of the row; empty while fewer than 3 qariahs have follow-along.
 * `seed` is the session seed of the Listen tab: the cards change once for
 * each session.
 */
export function useFollowAlongRecitations(
  seed?: number,
): FollowAlongRecitation[] {
  const covers = useFollowAlongCoverage();
  // `RECITERS` is refilled in place on each catalog load, so the row reads
  // the refill signal and computes again when it changes.
  const recitersVersion = useRecitersVersion();
  return useMemo(
    () => selectFollowAlongRecitations(covers, {seed}),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recitersVersion is the refill signal of RECITERS, which selectFollowAlongRecitations reads
    [covers, seed, recitersVersion],
  );
}

/** Renders nothing when it has no card. */
export function FollowAlongRecitationsRow({
  recitations,
  onRecitationPress = defaultRecitationPress,
  cardWidth,
}: FollowAlongRecitationsRowProps) {
  const {theme} = useTheme();
  const {t} = useTranslation('home');

  const handlePress = useCallback(
    (recitation: FollowAlongRecitation) => onRecitationPress(recitation),
    [onRecitationPress],
  );
  const renderItem: ListRenderItem<FollowAlongRecitation> = useCallback(
    ({item}) => (
      <RecitationCard
        recitation={item}
        onPress={handlePress}
        cardWidth={cardWidth}
      />
    ),
    [handlePress, cardWidth],
  );

  if (recitations.length === 0) return null;

  return (
    <View style={styles.section} testID="follow-along-recitations-row">
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, {color: theme.colors.text}]}>
          {t('home.followAlong')}
        </Text>
      </View>
      <RtlRowFlatList
        data={recitations}
        renderItem={renderItem}
        keyExtractor={followAlongRecitationKey}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[
          styles.sectionContent,
          cardWidth !== undefined && styles.tabletSectionContent,
        ]}
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={3}
      />
    </View>
  );
}

// The same values as NewlyAddedRecitationsRow (and the section styles of
// components/RecitersView.tsx), so the row lines up with the rows around it.
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
  // The shelf gap of components/RecitersView.tsx (TABLET_SHELF_GAP).
  tabletSectionContent: {
    gap: moderateScale(12),
  },
});
