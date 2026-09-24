import React, {useState, useCallback, useMemo} from 'react';
import {View, Text, FlatList, type ListRenderItemInfo} from 'react-native';
import {useTheme} from '@/hooks/useTheme';
import {
  ScaledSheet,
  moderateScale,
  verticalScale,
} from 'react-native-size-matters';
import {Theme} from '@/utils/themeUtils';
import Color from 'color';
import {SearchInput} from '@/components/SearchInput';
import {RECITERS, Reciter} from '@/data/reciterData';
import {ReciterItem} from '@/components/ReciterItem';
import {useReciterStore} from '@/store/reciterStore';
import {useRouter} from 'expo-router';
import {ReciterImage} from '@/components/ReciterImage';
import {useHeaderHeight} from 'expo-router/react-navigation';
import {USE_GLASS} from '@/hooks/useGlassProps';
import {getDisplayLabelFromName} from '@/services/rewayah/RewayahIdentity';

export default function DefaultReciterScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const {theme} = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const defaultReciter = useReciterStore(state => state.defaultReciter);
  const setDefaultReciter = useReciterStore(state => state.setDefaultReciter);
  const router = useRouter();
  const rawHeaderHeight = useHeaderHeight();
  const headerHeight = USE_GLASS ? rawHeaderHeight : 0;

  const hasCompleteQuran = useCallback((reciter: Reciter) => {
    return reciter.rewayat.some(
      r => r.surah_list?.filter(id => id !== null).length === 114,
    );
  }, []);

  // Show full list of complete-Quran reciters by default; filter on search.
  const visibleReciters = useMemo(() => {
    const completeReciters = RECITERS.filter(hasCompleteQuran);
    const sorted = [...completeReciters].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(r => r.name.toLowerCase().includes(q));
  }, [searchQuery, hasCompleteQuran]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleReciterSelect = useCallback(
    (reciter: Reciter) => {
      setDefaultReciter(reciter);
      router.back();
    },
    [router, setDefaultReciter],
  );

  const renderItem = useCallback(
    ({item}: ListRenderItemInfo<Reciter>) => (
      <ReciterItem
        item={item}
        onPress={() => handleReciterSelect(item)}
        isSelected={defaultReciter?.id === item.id}
      />
    ),
    [handleReciterSelect, defaultReciter],
  );

  return (
    <View style={styles.container}>
      <View style={[styles.content, {paddingTop: headerHeight}]}>
        {defaultReciter && (
          <View style={styles.currentReciterContainer}>
            <View style={styles.currentReciterContent}>
              <ReciterImage
                imageUrl={defaultReciter.image_url || undefined}
                reciterName={defaultReciter.name}
                style={styles.currentReciterImage}
              />
              <View style={styles.currentReciterInfo}>
                <Text style={styles.currentReciterName}>
                  {defaultReciter.name}
                </Text>
                <Text style={styles.currentReciterMoshaf}>
                  {getDisplayLabelFromName(defaultReciter.rewayat[0].name)}
                </Text>
              </View>
            </View>
          </View>
        )}

        <View style={styles.searchSection}>
          <Text style={styles.searchLabel}>CHANGE DEFAULT RECITER</Text>
          <SearchInput
            placeholder="Search reciters..."
            value={searchQuery}
            onChangeText={handleSearch}
            showCancelButton={false}
            iconColor={theme.colors.text}
            iconOpacity={0.25}
            placeholderTextColor={Color(theme.colors.text)
              .alpha(0.35)
              .toString()}
            textColor={theme.colors.text}
            backgroundColor={Color(theme.colors.text).alpha(0.04).toString()}
            borderColor={Color(theme.colors.text).alpha(0.06).toString()}
            containerStyle={{paddingHorizontal: 0}}
          />
        </View>

        <FlatList
          data={visibleReciters}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          style={styles.reciterList}
          ListHeaderComponent={
            <Text style={styles.listHeaderHint}>
              Only reciters with the complete Quran are shown
            </Text>
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>No reciters found</Text>
          }
          keyboardShouldPersistTaps="handled"
        />
      </View>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  ScaledSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      flex: 1,
      paddingHorizontal: moderateScale(16),
    },
    currentReciterContainer: {
      padding: moderateScale(16),
      marginBottom: verticalScale(16),
      borderRadius: moderateScale(14),
      marginHorizontal: moderateScale(15),
      marginTop: moderateScale(15),
      backgroundColor: Color(theme.colors.text).alpha(0.04).toString(),
      borderWidth: 1,
      borderColor: Color(theme.colors.text).alpha(0.06).toString(),
    },
    currentReciterContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    currentReciterImage: {
      width: moderateScale(72),
      height: moderateScale(72),
      borderRadius: moderateScale(10),
      marginRight: moderateScale(15),
    },
    currentReciterInfo: {
      flex: 1,
    },
    currentReciterName: {
      fontSize: moderateScale(16),
      fontFamily: 'Manrope-SemiBold',
      color: Color(theme.colors.text).alpha(0.85).toString(),
      marginBottom: verticalScale(4),
    },
    currentReciterMoshaf: {
      fontSize: moderateScale(12),
      fontFamily: 'Manrope-Regular',
      color: Color(theme.colors.textSecondary).alpha(0.45).toString(),
    },
    searchSection: {
      paddingHorizontal: moderateScale(15),
    },
    searchLabel: {
      fontSize: moderateScale(10.5),
      fontFamily: 'Manrope-SemiBold',
      color: Color(theme.colors.textSecondary).alpha(0.5).toString(),
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: verticalScale(8),
      marginLeft: moderateScale(2),
    },
    reciterList: {
      flex: 1,
      paddingHorizontal: moderateScale(15),
    },
    listHeaderHint: {
      fontSize: moderateScale(11.5),
      fontFamily: 'Manrope-Regular',
      color: Color(theme.colors.textSecondary).alpha(0.45).toString(),
      paddingTop: verticalScale(12),
      paddingBottom: verticalScale(6),
      marginLeft: moderateScale(2),
    },
    emptyText: {
      fontSize: moderateScale(13),
      fontFamily: 'Manrope-Regular',
      color: Color(theme.colors.textSecondary).alpha(0.45).toString(),
      textAlign: 'center',
      paddingVertical: moderateScale(15),
    },
  });
