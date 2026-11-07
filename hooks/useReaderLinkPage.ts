// @ai-generated
// Qariah (Sprint 47 Task 10, TECH_DEBT #281). Upstream candidate: Bayaan has
// the same reader route and the same link routes.
import {useEffect, useRef} from 'react';
import {useRoute} from 'expo-router';
import {useMushafNavigationStore} from '@/store/mushafNavigationStore';

/**
 * A link to the open Mushaf reader gives its route new params but does not
 * mount a new reader: a warm `qariah://mushaf?page=N` navigates to the route
 * that is already on top, and a link route pops back to it
 * (components/mushaf/ReaderLinkRedirect.tsx). MushafViewer reads its page
 * only when it mounts, so send the page of each later params change to it.
 *
 * The params object is compared, not the page: a second link to the same
 * page after the reader turned away must move the reader back. When `ready`
 * is false the viewer is not mounted yet, and it mounts on the new page.
 *
 * `surahId` is the surah a surah-only link asked for (qariah://quran/86):
 * the viewer then names that surah in its header on a page where two
 * surahs start (page 591: At-Tariq and Al-A'la), as it does at mount.
 */
export function useReaderLinkPage(
  page: number,
  ready: boolean,
  surahId?: number,
): void {
  const {params} = useRoute();
  const handled = useRef(params);
  useEffect(() => {
    if (params === handled.current) return;
    handled.current = params;
    if (ready) {
      useMushafNavigationStore.getState().navigateToPage(page, surahId);
    }
  }, [params, page, ready, surahId]);
}
