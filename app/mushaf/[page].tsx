// app/mushaf/[page].tsx
import React from 'react';
import {useLocalSearchParams} from 'expo-router';
// @ai-start
import {ReaderLinkRedirect} from '@/components/mushaf/ReaderLinkRedirect';
// @ai-end

// Canonical /mushaf/{page} URL (widgets, App Links). Hands off to the reader.
export default function MushafPageLink(): React.ReactElement {
  const {page} = useLocalSearchParams<{page: string}>();
  // @ai Qariah (#282): to the open reader, if there is one (not a second).
  return <ReaderLinkRedirect params={{page}} />;
}
