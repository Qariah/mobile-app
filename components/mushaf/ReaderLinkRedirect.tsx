// @ai-generated
// Qariah (Sprint 47 Task 10, TECH_DEBT #282). Upstream candidate: Bayaan's
// link routes use <Redirect>, which stacks a second reader.
import {useCallback, useRef} from 'react';
import {useFocusEffect, useRouter} from 'expo-router';

export type ReaderLinkParams = {
  page?: string;
  surah?: string;
  ayah?: string;
};

/**
 * The hand-off of a link route (app/mushaf/[page].tsx,
 * app/quran/[surah].tsx) to the one Mushaf reader. `dismissTo` pops back to
 * a reader that is already in the stack and gives it these params (the
 * reader then turns to the page, hooks/useReaderLinkPage.ts). With no reader
 * in the stack, it replaces the link route with one, as <Redirect> did. A
 * <Redirect> always replaced, so a link with a reader open stacked a second
 * reader, and Back showed the first one.
 */
export function ReaderLinkRedirect({params}: {params: ReaderLinkParams}): null {
  const router = useRouter();
  // A link route's params do not change while it is on screen; hand off the
  // first ones, once for each focus (as <Redirect> does).
  const target = useRef(params).current;
  useFocusEffect(
    useCallback(() => {
      router.dismissTo({pathname: '/mushaf', params: target});
    }, [router, target]),
  );
  return null;
}
