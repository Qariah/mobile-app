// @ai-generated
// Qariah (owner, 2026-11-11): <scheme>://continue-reading, the "Continue
// reading" app shortcut (services/shortcuts/appShortcuts.ts). The reader at
// the last page read, else page 1 (Al-Fatihah). ReaderLinkRedirect turns an
// open reader to the page instead of stacking a second reader (#282).
import React, {useRef} from 'react';
import {ReaderLinkRedirect} from '@/components/mushaf/ReaderLinkRedirect';
import {mushafSessionStore} from '@/services/mushaf/MushafSessionStore';
import {continueReadingPage} from '@/services/shortcuts/appShortcuts';

export default function ContinueReadingLink(): React.ReactElement {
  // Read once: the route hands off on its first focus.
  const page = useRef(
    String(continueReadingPage(mushafSessionStore.getLastReadPage())),
  ).current;
  return <ReaderLinkRedirect params={{page}} />;
}
