// @ai-generated
// Sprint 52 Task 8, test case AP-19: in Arabic (RTL) on Android, the first
// ayah-panel open after a fresh launch turned the reader from page 2 to
// page 1. The panel remounts the pager on the narrower pane. The new list's
// scroll view first reports its start (page 1: the native RTL view scrolls to
// keep its right edge when its content grows). That report moved the reader
// to page 1 before the list's initial scroll ran, and the list then took
// `initialScrollIndex` 0, so the initial scroll never ran.
//
// The sequences below replay the reports a list sends, in the RTL order.
import {readFileSync} from 'fs';
import {join} from 'path';
import {renderHook} from '@testing-library/react-native';
import {useReaderListStart, type ReaderListStart} from '../readerListStart';

const pageIndex = (page: number) => page - 1;
const spreadIndex = (page: number) => Math.floor((page - 1) / 2);

function mountList(key: string, page: number, index = pageIndex) {
  return renderHook<ReaderListStart, {listKey: string; currentPage: number}>(
    ({listKey, currentPage}) => useReaderListStart(listKey, currentPage, index),
    {initialProps: {listKey: key, currentPage: page}},
  );
}

describe('useReaderListStart (AP-19)', () => {
  it('ignores the RTL start report (page 1) until the list shows its start page', () => {
    // Fresh launch on page 2, then the panel opens: a new key on 706 pt.
    const hook = mountList('pages-1066|pager', 2);
    expect(hook.result.current.accepts(1)).toBe(true);
    hook.rerender({listKey: 'pages-706|pager', currentPage: 2});
    const start = hook.result.current;
    expect(start.page).toBe(2);

    // RTL: the content-change scroll reports index 0 (page 1) first.
    expect(start.accepts(0)).toBe(false);
    // The initial scroll lands on page 2: from now on every report counts.
    expect(start.accepts(1)).toBe(true);
    expect(start.accepts(0)).toBe(true);
  });

  it('keeps the start page for the life of the list', () => {
    // The page passed in changes (a report, a page turn); the list keeps the
    // page it mounted at, so its initialScrollIndex cannot become 0.
    const hook = mountList('pages-706|pager', 2);
    hook.rerender({listKey: 'pages-706|pager', currentPage: 1});
    expect(hook.result.current.page).toBe(2);
    // A remount starts at the reader's page of that moment.
    hook.rerender({listKey: 'pages-1066|pager', currentPage: 7});
    expect(hook.result.current.page).toBe(7);
  });

  it('counts every report after a drag or a scroll that the reader asks for', () => {
    const hook = mountList('pages-706|pager', 50);
    hook.result.current.release();
    expect(hook.result.current.accepts(3)).toBe(true);
  });

  it('opens on a settled scroll when the list never reports its exact start', () => {
    // A width that rounds the start to the next index, or a VoiceOver or
    // TalkBack page turn (no drag): the reports name another index.
    const hook = mountList('pages-706.5|pager', 50);
    expect(hook.result.current.accepts(50)).toBe(false);
    expect(hook.result.current.accepts(48)).toBe(false);
    // onMomentumScrollEnd: the scroll has settled.
    hook.result.current.release();
    expect(hook.result.current.accepts(50)).toBe(true);
  });

  it('uses the spread index of the start page for spreads', () => {
    // Page 50 is in spread 24 (pages 49|50).
    const hook = mountList('spreads-1016|pager', 50, spreadIndex);
    expect(hook.result.current.accepts(0)).toBe(false);
    expect(hook.result.current.accepts(24)).toBe(true);
  });

  it('keeps the identity of accepts and release (onViewableItemsChanged)', () => {
    const hook = mountList('pages-706|pager', 2);
    const {accepts, release} = hook.result.current;
    hook.rerender({listKey: 'pages-1066|pager', currentPage: 3});
    expect(hook.result.current.accepts).toBe(accepts);
    expect(hook.result.current.release).toBe(release);
  });
});

// DO NOT DROP: the wiring in main.tsx (an upstream file) that a wholesale
// upstream take would lose.
describe('main.tsx uses the list start (AP-19)', () => {
  const source = readFileSync(join(__dirname, '..', 'main.tsx'), 'utf8');

  it('starts both pager lists at the page they mounted with', () => {
    expect(source).toMatch(/pageToSpreadIndex\(listStartPage\)/);
    expect(source).toMatch(/initialScrollIndex=\{Math\.min\(listStartPage - 1/);
    expect(source.match(/onScrollBeginDrag=\{listRelease\}/g)).toHaveLength(2);
    expect(source.match(/onMomentumScrollEnd=\{listRelease\}/g)).toHaveLength(
      2,
    );
  });

  it('keys the start on the list key and what the list shows', () => {
    expect(source).toMatch(
      /useReaderListStart\(\s*`\$\{pagerKey\}\|\$\{isVertical \? 'scroll' : 'pager'\}`/,
    );
    expect(source).toMatch(
      /page => \(pagerShowsSpreads \? pageToSpreadIndex\(page\) : page - 1\)/,
    );
  });

  it('gates the viewability reports', () => {
    expect(source).toMatch(
      /if \(!listAccepts\(viewableItems\[0\]\.index\)\) return;/,
    );
  });
});
