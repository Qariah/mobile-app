// @ai
// TECH_DEBT #315 (Sprint 50): the Mushaf pagers follow the native layout
// direction, not the app language. See components/mushaf/pagerDirection.ts.
import {readFileSync} from 'fs';
import {join} from 'path';
import {I18nManager} from 'react-native';
import {pagerDirectionProps} from '../pagerDirection';

describe('pagerDirectionProps', () => {
  it('native right to left: not inverted, rtl direction', () => {
    expect(pagerDirectionProps(true)).toEqual({
      inverted: false,
      style: {direction: 'rtl'},
    });
  });

  it('native left to right: inverted, ltr direction', () => {
    expect(pagerDirectionProps(false)).toEqual({
      inverted: true,
      style: {direction: 'ltr'},
    });
  });

  it('reads I18nManager.isRTL by default', () => {
    expect(pagerDirectionProps()).toEqual(
      pagerDirectionProps(I18nManager.isRTL),
    );
  });
});

// DO NOT DROP: a wholesale upstream take of main.tsx would bring back
// `inverted={!isRTL}` (the app language) on the pagers. Like
// main.rotationStage.test.ts, this reads the source.
describe('main.tsx pagers', () => {
  const SOURCE = readFileSync(join(__dirname, '..', 'main.tsx'), 'utf8');

  it('both horizontal pagers take PAGER_DIRECTION', () => {
    expect(SOURCE.match(/\{\.\.\.PAGER_DIRECTION\}/g)).toHaveLength(2);
    expect(SOURCE).toContain('const PAGER_DIRECTION = pagerDirectionProps();');
  });

  it('no pager reads the app-language direction', () => {
    expect(SOURCE).not.toMatch(/inverted=\{!isRTL\}/);
  });
});
