// @ai-generated
// The reader's navigation requests (store/mushafNavigationStore.ts). Qariah
// (Sprint 47 Task 10, TECH_DEBT #281) adds navigateToPage(): a link to the
// open reader, with the surah when the link asked for one.
import {useMushafNavigationStore} from '@/store/mushafNavigationStore';

const state = () => useMushafNavigationStore.getState();

beforeEach(() => {
  useMushafNavigationStore.setState({
    targetPage: null,
    targetVerseKey: null,
    targetSurahId: null,
    requestId: 0,
  });
});

it('navigateToPage asks for a page with no verse and no surah', () => {
  state().navigateToPage(591);
  expect(state()).toMatchObject({
    targetPage: 591,
    targetVerseKey: null,
    targetSurahId: null,
    requestId: 1,
  });
});

it('navigateToPage keeps the surah of a surah link', () => {
  state().navigateToPage(591, 86);
  expect(state()).toMatchObject({
    targetPage: 591,
    targetVerseKey: null,
    targetSurahId: 86,
    requestId: 1,
  });
});

it('each request raises requestId, also for the same page', () => {
  state().navigateToPage(50);
  state().navigateToPage(50);
  expect(state().requestId).toBe(2);
});

it('navigateToVerse drops the surah of an earlier page request', () => {
  state().navigateToPage(591, 86);
  state().navigateToVerse('85:22', 591);
  expect(state()).toMatchObject({
    targetPage: 591,
    targetVerseKey: '85:22',
    targetSurahId: null,
    requestId: 2,
  });
});

it('clear empties the request and keeps requestId', () => {
  state().navigateToPage(591, 86);
  state().clear();
  expect(state()).toMatchObject({
    targetPage: null,
    targetVerseKey: null,
    targetSurahId: null,
    requestId: 1,
  });
});
