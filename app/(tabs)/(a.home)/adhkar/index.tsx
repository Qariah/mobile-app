import React from 'react';
import {useRouter} from 'expo-router';
import {AdhkarView} from '@/components/AdhkarView';
import {SuperCategory} from '@/types/adhkar';
import {isFeatureEnabled} from '@/config/featureFlags'; // @ai

// @ai-start
// The flag check is in the outer component. The inner component calls its
// hooks on every render, so the rules of hooks hold (TECH_DEBT #236).
function AdhkarIndexContent() {
  // @ai-end
  const router = useRouter();

  const handleCategoryPress = (superCategory: SuperCategory) => {
    router.push({
      pathname: '/(tabs)/(a.home)/adhkar/[superId]',
      params: {superId: superCategory.id},
    });
  };

  const handleSavedPress = () => {
    router.push('/(tabs)/(a.home)/adhkar/saved');
  };

  return (
    <AdhkarView
      onCategoryPress={handleCategoryPress}
      onSavedPress={handleSavedPress}
      headerHeight={0}
    />
  );
}

// @ai-start
export default function AdhkarIndexScreen() {
  return isFeatureEnabled('adhkar') ? <AdhkarIndexContent /> : null;
}
// @ai-end
