// @ai-generated
// Qariah (owner, 2026-11-11): <scheme>://continue-listening, the "Continue
// listening" app shortcut (services/shortcuts/appShortcuts.ts). Steps off the
// root stack to the screen underneath, then resumes the last session and opens
// the full player, or opens the Listen tab when there is nothing to resume.
import {useCallback} from 'react';
import {useLeaveLinkRoute} from '@/hooks/useLeaveLinkRoute';
import {continueListening} from '@/services/shortcuts/appShortcuts';

export default function ContinueListeningLink(): null {
  const onLeft = useCallback(() => {
    continueListening().catch(() => undefined);
  }, []);
  useLeaveLinkRoute(onLeft);
  return null;
}
