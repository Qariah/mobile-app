// @ai-generated
// Qariah (Sprint 47 Task 10, TECH_DEBT #281): a link to the open Mushaf
// reader changes the route's params, and the reader turns to the page.
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

const mockRoute: {params: object} = {params: {page: '50'}};

jest.mock('expo-router', () => ({
  useRoute: () => mockRoute,
}));

import {useReaderLinkPage} from '@/hooks/useReaderLinkPage';
import {useMushafNavigationStore} from '@/store/mushafNavigationStore';

function Probe({
  page,
  ready,
  surahId,
}: {
  page: number;
  ready: boolean;
  surahId?: number;
}): null {
  useReaderLinkPage(page, ready, surahId);
  return null;
}

let renderer: ReactTestRenderer | null = null;

function render(page: number, ready = true, surahId?: number): void {
  const probe = <Probe page={page} ready={ready} surahId={surahId} />;
  act(() => {
    if (renderer) renderer.update(probe);
    else renderer = create(probe);
  });
}

const requests = () => useMushafNavigationStore.getState().requestId;

beforeEach(() => {
  mockRoute.params = {page: '50'};
  useMushafNavigationStore.setState({
    targetPage: null,
    targetVerseKey: null,
    targetSurahId: null,
    requestId: 0,
  });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

it('does not move the reader when it mounts (the viewer starts on the page)', () => {
  render(50);
  render(50);
  expect(requests()).toBe(0);
});

it('turns the open reader to the page of a link (new params)', () => {
  render(50);
  mockRoute.params = {page: '100'};
  render(100);
  const state = useMushafNavigationStore.getState();
  expect(state.requestId).toBe(1);
  expect(state.targetPage).toBe(100);
  expect(state.targetVerseKey).toBeNull();
  expect(state.targetSurahId).toBeNull();
});

it('a surah link sends its surah with the page', () => {
  render(50);
  mockRoute.params = {surah: '86'};
  render(591, true, 86);
  const state = useMushafNavigationStore.getState();
  expect(state.requestId).toBe(1);
  expect(state.targetPage).toBe(591);
  expect(state.targetSurahId).toBe(86);
});

it('a second link to the same page moves the reader back to it', () => {
  render(50);
  mockRoute.params = {page: '50'};
  render(50);
  expect(requests()).toBe(1);
  expect(useMushafNavigationStore.getState().targetPage).toBe(50);
});

it('sends each params change once, not on later renders', () => {
  render(50);
  mockRoute.params = {page: '60'};
  render(60);
  render(60);
  expect(requests()).toBe(1);
});

it('while the reader is still loading, leaves the page to the viewer mount', () => {
  render(50, false);
  mockRoute.params = {page: '60'};
  render(60, false);
  // The data loads: the viewer mounts on page 60 by itself.
  render(60, true);
  expect(requests()).toBe(0);
});
