// @ai
// MushafRotationStage tells the native rotation stage (iOS) where the page
// text sits before and after a turn, and when the new layout is ready. The
// native side is mocked here; these tests hold the JS state machine:
//   - a turn starts only when the orientation changes, with a new token;
//   - the turn reports ready only when the page the reader was on (the
//     target) paints, after the pending Skia draws, and names that page's
//     view so the native side can check it is on screen;
//   - a page the user moves to during the turn does not count; a touch ends
//     the turn (the native stage lifts its cover on the same touch);
//   - list and continuous modes report after a settle;
//   - a turn that never becomes ready stops waiting.
// The native cover's own rule (ready, plus the end of the morph when JS
// asks, a touch, a timeout) lives in
// modules/rotation-stage/ios/RotationStageModule.swift.
import React from 'react';
import {Dimensions} from 'react-native';
import {fireEvent, render, act} from '@testing-library/react-native';
import {getMushafLayout} from '../constants';
import {
  MushafRotationStage,
  mushafPageTestID,
  useMushafRotationStage,
  type RotationStageNotes,
} from '../MushafRotationStage';

// The real service pulls in Sentry (a module-level interval); the geometry
// needs only the page lines: 8 on pages 1-2 (centred), 15 elsewhere.
jest.mock('@/services/mushaf/DigitalKhattDataService', () => ({
  digitalKhattDataService: {
    getPageLines: (page: number) =>
      Array.from({length: page <= 2 ? 8 : 15}, () => ({line_type: 'ayah'})),
  },
}));

const mockMarkReady = jest.fn();
const mockPageDrew = jest.fn();
const mockStageProps: Array<Record<string, unknown>> = [];

jest.mock('@/modules/rotation-stage', () => {
  const ReactActual = jest.requireActual('react');
  const {View} = jest.requireActual('react-native');
  return {
    RotationStage: ReactActual.forwardRef(
      (props: Record<string, unknown>, ref: unknown) => {
        ReactActual.useImperativeHandle(ref, () => ({
          markReady: mockMarkReady,
          pageDrew: mockPageDrew,
        }));
        mockStageProps.push(props);
        return ReactActual.createElement(
          View,
          {testID: 'stage'},
          props.children,
        );
      },
    ),
  };
});

// The real helper waits for the UI-thread draw queue; run at once here.
jest.mock('@/utils/skiaDeferredDispose', () => ({
  runAfterPendingDraws: (fn: () => void) => fn(),
}));

/** The stage reports after a macrotask (see `report`). */
function flushReport() {
  act(() => {
    jest.advanceTimersByTime(0);
  });
}

const PORTRAIT = getMushafLayout({
  width: 402,
  height: 874,
  insets: {top: 62, bottom: 34, left: 0, right: 0},
  toolbarHeight: 60,
  headerHeight: 60,
  isTablet: false,
});
const LANDSCAPE = getMushafLayout({
  width: 874,
  height: 402,
  insets: {top: 0, bottom: 21, left: 62, right: 62},
  toolbarHeight: 60,
  headerHeight: 60,
  isTablet: false,
});

/** Stands in for a page: exposes the notes. */
let notes: RotationStageNotes | null = null;
function Probe() {
  notes = useMushafRotationStage();
  return null;
}

function stage(
  orientation: 'portrait' | 'landscape',
  over: {paged?: boolean; currentPage?: number; statusBarHidden?: boolean} = {},
) {
  return (
    <MushafRotationStage
      orientation={orientation}
      metrics={orientation === 'portrait' ? PORTRAIT : LANDSCAPE}
      currentPage={over.currentPage ?? 50}
      paged={over.paged ?? true}
      isBookLayout
      backdropColor="#eee"
      statusBarHidden={over.statusBarHidden ?? false}>
      {/* Keyed on orientation, as main.tsx keys the list (#258). */}
      <Probe key={orientation} />
    </MushafRotationStage>
  );
}

function lastMapping() {
  return mockStageProps[mockStageProps.length - 1].mapping as {
    token: number;
    orientation: string;
  } | null;
}

function paint(page: number) {
  act(() => notes?.notePagePainted(page));
  flushReport();
}

beforeEach(() => {
  jest.useFakeTimers();
  mockMarkReady.mockClear();
  mockPageDrew.mockClear();
  mockStageProps.length = 0;
  notes = null;
});

afterEach(() => {
  jest.useRealTimers();
});

it('sends no mapping until the orientation changes', () => {
  const view = render(stage('portrait'));
  view.rerender(stage('portrait', {currentPage: 51}));
  expect(lastMapping()).toBeNull();
});

it('gives every turn a new token, also for a turn back', () => {
  const view = render(stage('portrait'));
  view.rerender(stage('landscape'));
  const first = lastMapping();
  expect(first?.orientation).toBe('landscape');
  view.rerender(stage('portrait'));
  const second = lastMapping();
  expect(second?.orientation).toBe('portrait');
  expect(second?.token).toBeGreaterThan(first?.token ?? 0);
});

it('reports ready when the target page paints, and names its view', () => {
  const view = render(stage('portrait'));
  view.rerender(stage('landscape'));
  const token = lastMapping()?.token;

  paint(51); // a neighbour page
  paint(49);
  expect(mockMarkReady).not.toHaveBeenCalled();

  act(() => notes?.notePagePainted(50));
  // Nothing goes to the native stage before the pending draws have run.
  expect(mockMarkReady).not.toHaveBeenCalled();
  flushReport();
  expect(mockMarkReady).toHaveBeenCalledTimes(1);
  expect(mockMarkReady).toHaveBeenCalledWith(token, 'landscape', {
    testID: mushafPageTestID(50),
    // Phone landscape: the page sits in a scroller.
    waitForMorph: true,
  });

  // The turn is over: a later paint does not report again.
  paint(50);
  expect(mockMarkReady).toHaveBeenCalledTimes(1);
});

it('ignores paints of the old layout', () => {
  render(stage('portrait'));
  // Before any turn, paints never report.
  paint(50);
  expect(mockMarkReady).not.toHaveBeenCalled();
});

it('keeps the target page when the visible page changes during the turn', () => {
  // The list reports page 51 (the user swiped, or the remounted list shows a
  // neighbour first); the cover still waits for page 50, the page the reader
  // was on, which the list starts at (#258).
  const view = render(stage('portrait'));
  view.rerender(stage('landscape'));
  view.rerender(stage('landscape', {currentPage: 51}));
  paint(51);
  expect(mockMarkReady).not.toHaveBeenCalled();
  paint(50);
  expect(mockMarkReady).toHaveBeenCalledWith(
    expect.any(Number),
    'landscape',
    expect.objectContaining({testID: mushafPageTestID(50)}),
  );
});

it('ends the turn on a touch: the user drives the list', () => {
  const view = render(stage('portrait'));
  view.rerender(stage('landscape'));
  // The wrapper inside the stage sees the touch first.
  const wrapper = view.getByTestId('stage').children[0] as never;
  fireEvent(wrapper, 'touchStart');
  paint(50);
  expect(mockMarkReady).not.toHaveBeenCalled();
});

it("waits for the reader's page in an iPad spread, also with stale metrics", () => {
  // iPad: a single portrait page turns into a landscape spread and back. The
  // first render of each turn still has the OLD layout's metrics: main.tsx
  // measures the container with onLayout, one render after the window.
  const PORT = getMushafLayout({
    width: 834,
    height: 1210,
    insets: {top: 24, bottom: 20, left: 0, right: 0},
    toolbarHeight: 0,
    headerHeight: 0,
    isTablet: true,
  });
  const LAND = getMushafLayout({
    width: 1210,
    height: 834,
    insets: {top: 24, bottom: 20, left: 0, right: 0},
    toolbarHeight: 0,
    headerHeight: 0,
    isTablet: true,
  });
  expect(LAND.facingPages).toBe(true);
  const ipadStage = (
    orientation: 'portrait' | 'landscape',
    metrics: typeof PORT,
  ) => (
    <MushafRotationStage
      orientation={orientation}
      metrics={metrics}
      currentPage={50}
      paged
      isBookLayout
      backdropColor="#eee">
      <Probe key={orientation} />
    </MushafRotationStage>
  );
  const view = render(ipadStage('portrait', PORT));
  view.rerender(ipadStage('landscape', PORT)); // stale first render
  // The list paints page 50 in the stale (portrait) layout too, then mounts
  // it again in the spread: the stale paint does not count.
  paint(50);
  expect(mockMarkReady).not.toHaveBeenCalled();
  view.rerender(ipadStage('landscape', LAND));
  paint(49); // the other page of the spread 49|50
  expect(mockMarkReady).not.toHaveBeenCalled();
  paint(50);
  expect(mockMarkReady).toHaveBeenCalledWith(expect.any(Number), 'landscape', {
    // The spread shows page 50 on the left (main.tsx `pageForSpread`).
    testID: mushafPageTestID(50),
    // Whole pages, no scroller: the live spread follows the morph, so the
    // cover lifts as soon as it is ready.
    waitForMorph: false,
  });

  // And back. With the stale metrics a spread-based target would be page 49,
  // which the portrait list does not show, and the cover would wait for its
  // timeout. One portrait page shows less than the spread, so the cover
  // stays until the morph ends (the live page would sit beside empty space).
  mockMarkReady.mockClear();
  view.rerender(ipadStage('portrait', LAND)); // stale first render
  paint(50); // in the stale spread
  expect(mockMarkReady).not.toHaveBeenCalled();
  view.rerender(ipadStage('portrait', PORT));
  paint(49);
  expect(mockMarkReady).not.toHaveBeenCalled();
  paint(50);
  expect(mockMarkReady).toHaveBeenCalledWith(expect.any(Number), 'portrait', {
    testID: mushafPageTestID(50),
    waitForMorph: true,
  });
});

it('reports list and continuous modes after a settle, without a page view', () => {
  const view = render(stage('portrait', {paged: false}));
  view.rerender(stage('landscape', {paged: false}));
  flushReport();
  // Their Skia rows draw over the frames after the remount: not yet.
  expect(mockMarkReady).not.toHaveBeenCalled();
  act(() => {
    jest.advanceTimersByTime(150);
  });
  // The idle wait (at most its timeout), then the macrotask before the
  // draw barrier.
  act(() => {
    jest.advanceTimersByTime(600);
  });
  flushReport();
  expect(mockMarkReady).toHaveBeenCalledTimes(1);
  // No page view to check: the text re-flows.
  expect(mockMarkReady).toHaveBeenCalledWith(
    lastMapping()?.token,
    'landscape',
    {
      testID: null,
      waitForMorph: true,
    },
  );
});

it('stops waiting when a turn never becomes ready', () => {
  const view = render(stage('portrait'));
  view.rerender(stage('landscape'));
  act(() => {
    jest.advanceTimersByTime(1500);
  });
  // A late paint no longer reports.
  paint(50);
  expect(mockMarkReady).not.toHaveBeenCalled();
});

// @ai — TECH_DEBT #272: the native stage keeps a portrait snapshot of the
// reader's page only when JS names that page (`pictureTestID`: in the pager,
// once it has painted), and drops it when the page draws again.
describe('portrait picture', () => {
  function lastPictureTestID() {
    return mockStageProps[mockStageProps.length - 1].pictureTestID;
  }

  it("names the reader's page only once it has painted", () => {
    render(stage('portrait'));
    expect(lastPictureTestID()).toBeNull();
    paint(51); // a neighbour page
    expect(lastPictureTestID()).toBeNull();
    paint(50);
    expect(lastPictureTestID()).toBe(mushafPageTestID(50));
  });

  it('forgets the paint at a turn: the remounted list paints again', () => {
    const view = render(stage('portrait'));
    paint(50);
    view.rerender(stage('landscape'));
    expect(lastPictureTestID()).toBeNull();
    paint(50);
    expect(lastPictureTestID()).toBe(mushafPageTestID(50));
  });

  it('names no page in the reflow modes', () => {
    render(stage('portrait', {paged: false}));
    paint(50);
    expect(lastPictureTestID()).toBeNull();
  });

  it("tells the native stage when the reader's page draws again", () => {
    render(stage('portrait'));
    act(() => notes?.notePageDrawn(51, false)); // a neighbour page
    expect(mockPageDrew).not.toHaveBeenCalled();
    act(() => notes?.notePageDrawn(50, false));
    expect(mockPageDrew.mock.calls).toEqual([[false]]);
    // A new frame goes on as such: the native stage ignores it during a
    // turn only.
    act(() => notes?.notePageDrawn(50, true));
    expect(mockPageDrew.mock.calls).toEqual([[false], [true]]);
  });

  it('drops the snapshot when the status bar shows or hides (immersive mode)', () => {
    // On a Home-button iPhone in landscape the page does not commit at all,
    // yet the turn back shows it with the labels 20 pt lower.
    const view = render(stage('landscape'));
    expect(mockPageDrew).not.toHaveBeenCalled();
    view.rerender(stage('landscape', {statusBarHidden: true}));
    expect(mockPageDrew.mock.calls).toEqual([[false]]);
    view.rerender(stage('landscape', {statusBarHidden: true}));
    expect(mockPageDrew).toHaveBeenCalledTimes(1);
    view.rerender(stage('landscape', {statusBarHidden: false}));
    expect(mockPageDrew.mock.calls).toEqual([[false], [false]]);
  });

  it('drops the snapshot when the system text size changes (Dynamic Type)', () => {
    // The page labels scale natively, with no commit of the page.
    const window = Dimensions.get('window');
    const screen = Dimensions.get('screen');
    render(stage('portrait'));
    expect(mockPageDrew).not.toHaveBeenCalled();
    try {
      act(() => Dimensions.set({window: {...window, fontScale: 1.5}, screen}));
      expect(mockPageDrew.mock.calls).toEqual([[false]]);
    } finally {
      act(() => Dimensions.set({window, screen}));
    }
  });
});
