// @ai
// When a rotation turn of the Mushaf reader is ready: only the paint of the
// page the reader was on (the target) counts, whatever paints first.
import {
  isTurnReady,
  layoutOrientation,
  notePainted,
  pageForSpread,
  spreadRightPage,
  startTurn,
  waitsForMorph,
} from '../rotationTurnState';

describe('rotationTurnState', () => {
  it('is not ready before the target page paints', () => {
    expect(isTurnReady(startTurn(1, 'portrait', 50))).toBe(false);
  });

  it('ignores the paint of a neighbour page', () => {
    // The remounted list mounts and paints the neighbours too, and on iOS 26
    // can show one of them before it reaches its start page.
    let turn = startTurn(1, 'portrait', 50);
    turn = notePainted(turn, 49, 'portrait');
    turn = notePainted(turn, 51, 'portrait');
    expect(isTurnReady(turn)).toBe(false);
  });

  it('is ready when the target page paints, in any order', () => {
    let turn = startTurn(1, 'landscape', 50);
    turn = notePainted(turn, 51, 'landscape');
    turn = notePainted(turn, 50, 'landscape');
    expect(isTurnReady(turn)).toBe(true);
  });

  it('ignores a paint in a layout of the old orientation', () => {
    // iPad: the first render of a turn still has the old layout's metrics,
    // and the list paints the page in that layout before it mounts it again.
    let turn = startTurn(1, 'landscape', 50);
    turn = notePainted(turn, 50, 'portrait');
    expect(isTurnReady(turn)).toBe(false);
    turn = notePainted(turn, 50, 'landscape');
    expect(isTurnReady(turn)).toBe(true);
  });

  it('names the orientation of the visible area of a layout', () => {
    expect(layoutOrientation({screenWidth: 402, screenHeight: 874})).toBe(
      'portrait',
    );
    // Phone landscape: the page in its scroller is taller than the screen.
    expect(
      layoutOrientation({
        screenWidth: 874,
        screenHeight: 1500,
        scrollContainerHeight: 402,
      }),
    ).toBe('landscape');
    expect(layoutOrientation({screenWidth: 1210, screenHeight: 834})).toBe(
      'landscape',
    );
  });

  it('keeps the same object when nothing changes', () => {
    const turn = notePainted(startTurn(1, 'portrait', 50), 50, 'portrait');
    expect(notePainted(turn, 50, 'portrait')).toBe(turn);
    expect(notePainted(turn, 49, 'portrait')).toBe(turn);
  });

  it('names the right page of the spread that holds a page', () => {
    expect(spreadRightPage(50)).toBe(49);
    expect(spreadRightPage(49)).toBe(49);
    expect(spreadRightPage(1)).toBe(1);
    expect(spreadRightPage(2)).toBe(1);
    expect(spreadRightPage(604)).toBe(603);
  });

  it("keeps the reader's page while a spread shows it", () => {
    // iPad: page 50 turns to the spread 49|50, and back to page 50.
    expect(pageForSpread(50, 49)).toBe(50);
    expect(pageForSpread(49, 49)).toBe(49);
    expect(pageForSpread(2, 1)).toBe(2);
    expect(pageForSpread(604, 603)).toBe(604);
  });

  it('waits for the morph only where the new layout shows less', () => {
    const turn = {
      paged: true,
      inScroller: false,
      fromFacingPages: false,
    };
    // Phone: landscape page in its scroller waits; portrait page does not.
    expect(
      waitsForMorph({...turn, orientation: 'landscape', inScroller: true}),
    ).toBe(true);
    expect(waitsForMorph({...turn, orientation: 'portrait'})).toBe(false);
    // Reflow layouts wait in landscape only.
    expect(
      waitsForMorph({...turn, orientation: 'landscape', paged: false}),
    ).toBe(true);
    expect(
      waitsForMorph({...turn, orientation: 'portrait', paged: false}),
    ).toBe(false);
    // iPad: into a spread does not wait; out of a spread does.
    expect(waitsForMorph({...turn, orientation: 'landscape'})).toBe(false);
    expect(
      waitsForMorph({...turn, orientation: 'portrait', fromFacingPages: true}),
    ).toBe(true);
  });

  it('names the right page of a spread the reader moves to', () => {
    // A swipe from the spread 49|50 to 51|52, or back.
    expect(pageForSpread(50, 51)).toBe(51);
    expect(pageForSpread(51, 49)).toBe(49);
    expect(pageForSpread(52, 49)).toBe(49);
  });
});
