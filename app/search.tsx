// @ai-generated
// Qariah (owner, 2026-11-11): <scheme>://search, the "Search" app shortcut
// (services/shortcuts/appShortcuts.ts). Steps off the root stack to the tabs
// underneath, then selects the Search tab. A redirect to the tab route would
// stack a second copy of the tabs (hooks/useLeaveLinkRoute.ts).
import {useLeaveLinkRoute} from '@/hooks/useLeaveLinkRoute';
import {openSearchTab} from '@/services/shortcuts/appShortcuts';

export default function SearchShortcutLink(): null {
  useLeaveLinkRoute(openSearchTab);
  return null;
}
