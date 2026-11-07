// @ai
// TECH_DEBT #272: the rotation stage may show its portrait snapshot of a page
// only while the page has not drawn again. A stale picture is worse than an
// empty area. The page reports each later draw (pageDrawReport.ts,
// useCommitReport.ts); the stage drops the snapshot. These tests hold:
//   - the report: every commit after the mount, of the page view and of its
//     renderer, except the reveal commit and a commit with a new page frame
//     (the commit of a turn);
//   - the choke point: every change of a page picture is a commit of the page
//     view or of its renderer, because the components inside the renderers'
//     Canvas read no store, context or other external value;
//   - the wiring: both renderers report at their top level.
import React, {useState} from 'react';
import {readFileSync} from 'fs';
import {join} from 'path';
import {Text} from 'react-native';
import {act, render} from '@testing-library/react-native';
import {create} from 'zustand';
import {useCommitReport} from '../useCommitReport';
import {pageFrameKey, usePageDrawReport} from '../pageDrawReport';
import {MushafRotationStage} from '../MushafRotationStage';
import {getMushafLayout} from '../constants';

jest.mock('@/services/mushaf/DigitalKhattDataService', () => ({
  digitalKhattDataService: {getPageLines: () => []},
}));
jest.mock('@/utils/skiaDeferredDispose', () => ({
  runAfterPendingDraws: (fn: () => void) => fn(),
}));

const mockPageDrew = jest.fn();
jest.mock('@/modules/rotation-stage', () => {
  const ReactActual = jest.requireActual('react');
  const {View} = jest.requireActual('react-native');
  return {
    RotationStage: ReactActual.forwardRef(
      (props: {children: React.ReactNode}, ref: unknown) => {
        // As the real module: a stable handle (deps []), so that it stays
        // attached while the children's layout effects run.
        ReactActual.useImperativeHandle(
          ref,
          () => ({markReady: jest.fn(), pageDrew: mockPageDrew}),
          [],
        );
        return ReactActual.createElement(View, null, props.children);
      },
    ),
  };
});

const PORTRAIT = getMushafLayout({
  width: 402,
  height: 874,
  insets: {top: 62, bottom: 34, left: 0, right: 0},
});

// A store that the stand-in renderer reads, as SkiaPage reads its stores.
const useHighlight = create(() => ({verse: '3:1'}));

/** Stands in for SkiaPage / QCFPage: reads a store, reports its commits. */
function Renderer({color, onDraw}: {color: string; onDraw: () => void}) {
  const verse = useHighlight(s => s.verse);
  useCommitReport(onDraw);
  return <Text>{`${verse} ${color}`}</Text>;
}

const LANDSCAPE = getMushafLayout({
  width: 874,
  height: 402,
  insets: {top: 0, bottom: 21, left: 62, right: 62},
});
const PORTRAIT_FRAME = pageFrameKey(PORTRAIT, {
  top: 62,
  bottom: 34,
  left: 0,
  right: 0,
});
const LANDSCAPE_FRAME = pageFrameKey(LANDSCAPE, {
  top: 0,
  bottom: 21,
  left: 62,
  right: 62,
});

let reveal: () => void = () => undefined;
/** Stands in for DKPageView: the reveal gate and the draw report. */
function PageView({
  page,
  color,
  frame,
}: {
  page: number;
  color: string;
  frame: string;
}) {
  const [ready, setReady] = useState(false);
  reveal = () => setReady(true);
  const onDraw = usePageDrawReport(page, ready, frame);
  return <Renderer color={color} onDraw={onDraw} />;
}

function reader(page: number, color = '#000', frame = PORTRAIT_FRAME) {
  return (
    <MushafRotationStage
      orientation="portrait"
      metrics={PORTRAIT}
      currentPage={50}
      paged
      isBookLayout
      backdropColor="#eee">
      <PageView page={page} color={color} frame={frame} />
    </MushafRotationStage>
  );
}

beforeEach(() => {
  mockPageDrew.mockClear();
  act(() => useHighlight.setState({verse: '3:1'}));
});

describe('useCommitReport', () => {
  it('reports every commit but the mount', () => {
    const onDraw = jest.fn();
    const view = render(<Renderer color="#000" onDraw={onDraw} />);
    expect(onDraw).not.toHaveBeenCalled();
    view.rerender(<Renderer color="#111" onDraw={onDraw} />);
    expect(onDraw).toHaveBeenCalledTimes(1);
    act(() => useHighlight.setState({verse: '3:2'}));
    expect(onDraw).toHaveBeenCalledTimes(2);
  });
});

describe('usePageDrawReport', () => {
  it('does not report the mount or the reveal', () => {
    render(reader(50));
    act(() => reveal());
    expect(mockPageDrew).not.toHaveBeenCalled();
  });

  it("reports a draw of the renderer (a store it reads) for the reader's page", () => {
    render(reader(50));
    act(() => reveal());
    act(() => useHighlight.setState({verse: '3:2'}));
    expect(mockPageDrew).toHaveBeenCalledTimes(1);
  });

  it('reports a draw of the page view (a new prop: the theme, a label)', () => {
    const view = render(reader(50));
    act(() => reveal());
    view.rerender(reader(50, '#222'));
    expect(mockPageDrew).toHaveBeenCalled();
  });

  it('reports a draw before the reveal too (the page changed while it painted)', () => {
    render(reader(50));
    act(() => useHighlight.setState({verse: '3:2'}));
    expect(mockPageDrew).toHaveBeenCalledTimes(1);
  });

  it('marks a commit with a new frame, and only that commit', () => {
    // The native stage ignores a new-frame draw only during a turn (the
    // turn's own commits). The immersive mode's safe area is a new frame
    // with no turn: it must reach the stage.
    const view = render(reader(50));
    act(() => reveal());
    view.rerender(reader(50, '#000', LANDSCAPE_FRAME));
    expect(mockPageDrew).toHaveBeenCalled();
    expect(
      new Set(mockPageDrew.mock.calls.map(([newFrame]) => newFrame)),
    ).toEqual(new Set([true]));
    mockPageDrew.mockClear();
    // The page draws again at the same frame: a plain draw.
    act(() => useHighlight.setState({verse: '3:2'}));
    expect(mockPageDrew.mock.calls).toEqual([[false]]);
    mockPageDrew.mockClear();
    view.rerender(reader(50, '#111', LANDSCAPE_FRAME));
    expect(mockPageDrew).toHaveBeenCalled();
    expect(
      mockPageDrew.mock.calls.every(([newFrame]) => newFrame === false),
    ).toBe(true);
  });

  it('reports a draw after a render that React discarded (render-safe)', async () => {
    // A transition renders the page view with a new frame and suspends, so
    // React discards that render. A commit of the renderer alone follows: a
    // plain draw. A ref written during the discarded render would mark it.
    const never = new Promise<never>(() => undefined);
    function Suspends({on}: {on: boolean}) {
      if (on) throw never;
      return null;
    }
    function Tree({frame, suspend}: {frame: string; suspend: boolean}) {
      return (
        <MushafRotationStage
          orientation="portrait"
          metrics={PORTRAIT}
          currentPage={50}
          paged
          isBookLayout
          backdropColor="#eee">
          <React.Suspense fallback={null}>
            <PageView page={50} color="#000" frame={frame} />
            <Suspends on={suspend} />
          </React.Suspense>
        </MushafRotationStage>
      );
    }
    let setTree: (t: {frame: string; suspend: boolean}) => void = () =>
      undefined;
    function Host() {
      const [tree, set] = useState({frame: PORTRAIT_FRAME, suspend: false});
      setTree = set;
      return <Tree {...tree} />;
    }
    render(<Host />);
    act(() => reveal());
    mockPageDrew.mockClear();
    await act(async () => {
      React.startTransition(() =>
        setTree({frame: LANDSCAPE_FRAME, suspend: true}),
      );
    });
    expect(mockPageDrew).not.toHaveBeenCalled();
    act(() => useHighlight.setState({verse: '3:2'}));
    expect(mockPageDrew.mock.calls).toEqual([[false]]);
  });

  it("ignores the draws of a page that is not the reader's page", () => {
    render(reader(51));
    act(() => reveal());
    act(() => useHighlight.setState({verse: '3:2'}));
    expect(mockPageDrew).not.toHaveBeenCalled();
  });
});

describe('pageFrameKey', () => {
  const insets = {top: 62, bottom: 34, left: 0, right: 0};
  it('is the same for the same size and safe area', () => {
    expect(pageFrameKey({...PORTRAIT}, {...insets})).toBe(PORTRAIT_FRAME);
  });
  it('changes with the size or the safe area', () => {
    expect(LANDSCAPE_FRAME).not.toBe(PORTRAIT_FRAME);
    expect(pageFrameKey(PORTRAIT, {...insets, top: 0})).not.toBe(
      PORTRAIT_FRAME,
    );
  });
});

const MUSHAF = join(__dirname, '..');
const read = (file: string) => readFileSync(join(MUSHAF, file), 'utf8');

// Hooks that read a value from outside the component: a store, a context, the
// window, the safe area, the theme, the font manager, an animation value.
const EXTERNAL_READ =
  /\buse(?:[A-Z]\w*Store|SyncExternalStore|Context|Theme|SafeAreaInsets|WindowDimensions|MushafFontMgr|SharedValue|DerivedValue|AnimatedReaction|FrameCallback|Clock|ReadingThemeColors|Responsive)\b/;

/** The local components that a renderer draws inside its Canvas. */
function canvasChildren(rendererFile: string): string[] {
  const source = read(rendererFile);
  const files: string[] = [];
  // Default and named imports from local files: `import A, {B} from './x'`.
  const imports = source.matchAll(
    /import\s+([\w\s{},]+?)\s+from\s+'(\.{1,2}\/[^']+)'/g,
  );
  for (const [, clause, from] of imports) {
    const names = clause.match(/[A-Z]\w*/g) ?? [];
    if (!names.some(name => new RegExp(`<${name}[\\s>/]`).test(source))) {
      continue;
    }
    const base = join(join(rendererFile, '..'), from);
    files.push(`${base}.tsx`);
  }
  return files;
}

describe('the page picture changes only through a commit of the page view or its renderer', () => {
  it.each(['skia/SkiaPage.tsx', 'qcf/QCFPage.tsx'])(
    '%s draws only components that read no external value',
    renderer => {
      const children = canvasChildren(renderer);
      // SkiaLine and SkiaSurahHeader today; a new local child is checked too.
      expect(children.length).toBeGreaterThan(0);
      for (const child of children) {
        expect({child, external: EXTERNAL_READ.test(read(child))}).toEqual({
          child,
          external: false,
        });
      }
    },
  );

  it('the page edge of the page view reads only the safe area (in its frame)', () => {
    // DKPageView draws PageEdgeDecoration itself. A change of the safe area
    // is a new frame: the turn's own cover hides it.
    const reads = read('PageEdgeDecoration.tsx').match(
      new RegExp(EXTERNAL_READ.source, 'g'),
    );
    expect([...new Set(reads)]).toEqual(['useSafeAreaInsets']);
  });

  it.each(['skia/SkiaPage.tsx', 'qcf/QCFPage.tsx'])(
    '%s reports its commits at its top level, before any early return',
    renderer => {
      const source = read(renderer);
      const call = source.indexOf('useCommitReport(onDraw);');
      expect(call).toBeGreaterThan(-1);
      const body = source.indexOf('}) => {', source.indexOf('Props> = ({'));
      expect(call).toBeGreaterThan(body);
      // No `return` of the component between its start and the call.
      expect(source.slice(body, call)).not.toMatch(/\n {2}return\b/);
    },
  );
});
