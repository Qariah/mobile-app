// @ai-generated
// Qariah (Sprint 47 Task 10, TECH_DEBT #281, #282): the root stack's router
// contract that the link fix relies on, with the router that expo-router
// ships. A link route (app/mushaf/[page].tsx, app/quran/[surah].tsx) hands
// off with POP_TO (router.dismissTo): one reader stays in the stack. A warm
// qariah://mushaf?page=N is a NAVIGATE to the open reader: the same route
// with a new params object, which hooks/useReaderLinkPage.ts reacts to.
import {
  StackRouter,
  type StackNavigationState,
} from 'expo-router/build/react-navigation/routers';
import type {ParamListBase} from 'expo-router/build/react-navigation/routers';

const options = {
  routeNames: ['(tabs)', 'mushaf', 'mushaf/[page]'],
  routeParamList: {},
  routeGetIdList: {},
};
const router = StackRouter({});

type Route = {key: string; name: string; params?: object};

function stack(routes: Route[]): StackNavigationState<ParamListBase> {
  return {
    stale: false,
    type: 'stack',
    key: 'root',
    index: routes.length - 1,
    routeNames: options.routeNames,
    routes,
    preloadedRoutes: [],
  } as StackNavigationState<ParamListBase>;
}

type StackAction = Parameters<typeof router.getStateForAction>[1];

function apply(
  state: StackNavigationState<ParamListBase>,
  action: StackAction,
): StackNavigationState<ParamListBase> {
  const next = router.getStateForAction(
    state,
    {...action, target: 'root'},
    options,
  );
  if (next === null) throw new Error('action not handled');
  return next as StackNavigationState<ParamListBase>;
}

const popToReader = (params: object): StackAction => ({
  type: 'POP_TO',
  payload: {name: 'mushaf', params},
});

it('a link route with a reader open: one reader, with the new page', () => {
  const reader = {key: 'reader-1', name: 'mushaf', params: {page: '50'}};
  const state = stack([
    {key: 'tabs', name: '(tabs)'},
    reader,
    {key: 'link', name: 'mushaf/[page]', params: {page: '60'}},
  ]);
  const next = apply(state, popToReader({page: '60'}));
  expect(next.routes.map(r => r.name)).toEqual(['(tabs)', 'mushaf']);
  expect(next.routes[1].key).toBe('reader-1');
  expect(next.routes[1].params).toEqual({page: '60'});
  expect(next.index).toBe(1);
});

it('a link route with no reader open: the link route becomes the reader', () => {
  const state = stack([
    {key: 'tabs', name: '(tabs)'},
    {key: 'link', name: 'mushaf/[page]', params: {page: '60'}},
  ]);
  const next = apply(state, popToReader({page: '60'}));
  expect(next.routes.map(r => r.name)).toEqual(['(tabs)', 'mushaf']);
  expect(next.routes[1].params).toEqual({page: '60'});
});

it('a warm ?page=N link to the open reader: same route, new params object', () => {
  const params = {page: '50'};
  const state = stack([
    {key: 'tabs', name: '(tabs)'},
    {key: 'reader-1', name: 'mushaf', params},
  ]);
  const navigate: StackAction = {
    type: 'NAVIGATE',
    payload: {name: 'mushaf', params: {page: '50'}},
  };
  const next = apply(state, navigate);
  expect(next.routes.map(r => r.key)).toEqual(['tabs', 'reader-1']);
  expect(next.routes[1].params).toEqual({page: '50'});
  // A new object even for the same page: the reader turns back to it.
  expect(next.routes[1].params).not.toBe(params);
});
