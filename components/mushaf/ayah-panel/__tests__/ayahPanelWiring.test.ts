// @ai-generated
// Sprint 52 Task 8: the verse-actions sheet hands Tafsir, Reflections and
// Personal Notes to the ayah panel on a tablet in the Mushaf reader, and
// phones keep the sheet's own screens. The source guards hold the wiring in
// the upstream files (VerseActionsSheet.tsx, main.tsx), which a wholesale
// upstream take would drop.
import {readFileSync} from 'fs';
import {join} from 'path';
import {renderHook} from '@testing-library/react-native';

let mockIsTablet = true;
const mockHide = jest.fn(() => Promise.resolve());
jest.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => ({isTablet: mockIsTablet}),
}));
jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {show: jest.fn(), hide: () => mockHide()},
}));

import {
  closeAyahPanel,
  registerAyahPanelHost,
  useAyahPanelStore,
  type AyahPanelPayload,
} from '../ayahPanelStore';
import {useAyahPanelHandOff} from '../useAyahPanelHandOff';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const payload = {
  verseKey: '2:2',
  surahNumber: 2,
  ayahNumber: 2,
  source: 'mushaf',
} as AyahPanelPayload;

let unregister: (() => void) | null = null;

beforeEach(() => {
  mockIsTablet = true;
  mockHide.mockClear();
  unregister = registerAyahPanelHost();
});

afterEach(() => {
  unregister?.();
  unregister = null;
  closeAyahPanel();
});

describe('useAyahPanelHandOff', () => {
  it('opens the panel on the tab and closes the sheet on a tablet', () => {
    const {result} = renderHook(() =>
      useAyahPanelHandOff(payload, false, 'verse-actions'),
    );
    expect(result.current('notes', {compose: true})).toBe(true);
    const state = useAyahPanelStore.getState();
    expect(state.payload).toBe(payload);
    expect(state.tab).toBe('notes');
    expect(state.compose).toBe(true);
    expect(mockHide).toHaveBeenCalledTimes(1);
  });

  it('leaves phones, ranges and the player to the sheet', () => {
    mockIsTablet = false;
    const phone = renderHook(() =>
      useAyahPanelHandOff(payload, false, 'verse-actions'),
    );
    expect(phone.result.current('tafsir')).toBe(false);

    mockIsTablet = true;
    const range = renderHook(() =>
      useAyahPanelHandOff(payload, true, 'verse-actions'),
    );
    expect(range.result.current('tafsir')).toBe(false);

    const player = renderHook(() =>
      useAyahPanelHandOff(
        {...payload, source: 'player'},
        false,
        'verse-actions',
      ),
    );
    expect(player.result.current('tafsir')).toBe(false);

    expect(useAyahPanelStore.getState().payload).toBeNull();
    expect(mockHide).not.toHaveBeenCalled();
  });

  it('leaves another ayah to the sheet while the panel holds a draft', () => {
    const {result} = renderHook(() =>
      useAyahPanelHandOff(payload, false, 'verse-actions'),
    );
    expect(result.current('notes', {compose: true})).toBe(true);
    mockHide.mockClear();
    const other = {...payload, verseKey: '2:3', ayahNumber: 3};
    const otherHandOff = renderHook(() =>
      useAyahPanelHandOff(other, false, 'verse-actions'),
    );
    expect(otherHandOff.result.current('tafsir')).toBe(false);
    expect(useAyahPanelStore.getState().payload).toBe(payload);
    expect(useAyahPanelStore.getState().compose).toBe(true);
    expect(mockHide).not.toHaveBeenCalled();
  });

  it('leaves the sheet alone when no Mushaf reader is mounted', () => {
    unregister?.();
    unregister = null;
    const {result} = renderHook(() =>
      useAyahPanelHandOff(payload, false, 'verse-actions'),
    );
    expect(result.current('tafsir')).toBe(false);
  });
});

describe('the wiring in the upstream files (DO NOT DROP)', () => {
  it('VerseActionsSheet hands the three rows to the panel', () => {
    const sheet = read('components/sheets/VerseActionsSheet.tsx');
    expect(sheet).toMatch(
      /useAyahPanelHandOff\(payload, isRange, props\.sheetId\)/,
    );
    expect(sheet).toMatch(/openInAyahPanel\('tafsir'\)/);
    expect(sheet).toMatch(/openInAyahPanel\('reflections'\)/);
    expect(sheet).toMatch(/openInAyahPanel\('notes'/);
    expect(sheet).toMatch(/onPress=\{handlePersonalNote/);
  });

  it('main.tsx keeps the reader in place and puts the panel beside it', () => {
    const main = read('components/mushaf/main.tsx');
    expect(main).toMatch(
      /const reader = \(\s*<View\s+onLayout=\{onContainerLayout\}/,
    );
    expect(main).toMatch(/if \(!isTablet\) return reader;/);
    expect(main).toMatch(/<AyahPanelHost\s+presentation=\{ayahPanel\}/);
    expect(main).toMatch(/registerAyahPanelHost\(\)/);
    expect(main).toMatch(/landscapeWindow: panelDocked/);
  });

  // The long-presses are behaviour tests: QCFPage.ayahPanel.test.tsx (QCF),
  // VerseItem.ayahPanel.test.tsx (the list view), and
  // verseUnitDragSelect.ayahPanel.test.tsx (the Skia unit drag-select).
});
