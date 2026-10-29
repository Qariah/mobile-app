// @ai-generated
// TECH_DEBT #278: a sheet sized itself from the window height read once, when
// its module loaded. A module that loads while the window is in landscape kept
// a landscape height in portrait, and an open sheet kept its height when the
// window turned (the Mushaf reader turns; an iPad window turns and resizes).
// The sheet must follow the live window height.
import React from 'react';
import {Dimensions, StyleSheet, View} from 'react-native';
import TestRenderer, {act, type ReactTestRenderer} from 'react-test-renderer';

jest.mock('react-native-actions-sheet', () => {
  const {View: MockView} = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({
      children,
      containerStyle,
    }: {
      children: React.ReactNode;
      containerStyle: object;
    }) => (
      <MockView testID="sheet-container" style={containerStyle}>
        {children}
      </MockView>
    ),
    ScrollView: MockView,
    SheetManager: {show: jest.fn(), hide: jest.fn()},
  };
});
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        text: '#111111',
        textSecondary: '#666666',
        background: '#ffffff',
        card: '#eeeeee',
        primary: '#0088ff',
      },
      fonts: {regular: 'r', medium: 'm', bold: 'b'},
    },
  }),
}));
jest.mock('@/components/Icons', () => ({RewayatIcon: () => null}));
jest.mock('@fawazahmed/react-native-read-more', () => () => null);
jest.mock('@/services/rewayah/RewayahIdentity', () => ({
  getDisplayLabelFromName: (name: string) => name,
}));
jest.mock('@/components/MushafSettingsContent', () => ({
  MushafSettingsContent: () => null,
}));
jest.mock('@/components/ReadingThemeContent', () => ({
  ReadingThemeContent: () => null,
}));
jest.mock('@expo/vector-icons', () => ({Feather: () => null}));

type Size = {width: number; height: number; scale: number; fontScale: number};

function setWindow(width: number, height: number) {
  const size: Size = {width, height, scale: 3, fontScale: 1};
  act(() => {
    Dimensions.set({window: size, screen: size});
  });
}

const PORTRAIT = {width: 402, height: 874};
const LANDSCAPE = {width: 874, height: 402};

type AnySheet = React.ComponentType<Record<string, unknown>>;
let RewayatInfoSheet: AnySheet;
let MushafLayoutSheet: AnySheet;

const sheets: [string, () => React.JSX.Element, number][] = [
  [
    'RewayatInfoSheet',
    () => (
      <RewayatInfoSheet
        sheetId="rewayat-info"
        payload={{
          rewayat: [{id: 'r1', name: 'Hafs', style: 'murattal'}],
          selectedId: 'r1',
        }}
      />
    ),
    0.85,
  ],
  [
    'MushafLayoutSheet',
    () => <MushafLayoutSheet sheetId="mushaf-layout" />,
    0.82,
  ],
];

function sheetHeight(root: ReactTestRenderer): number {
  const container = root.root.findByProps({testID: 'sheet-container'});
  return StyleSheet.flatten(container.props.style).height as number;
}

let mounted: ReactTestRenderer | undefined;

function mount(element: React.JSX.Element): ReactTestRenderer {
  act(() => {
    mounted = TestRenderer.create(<View>{element}</View>);
  });
  if (!mounted) throw new Error('the sheet did not mount');
  return mounted;
}

describe('sheet height follows the window (TECH_DEBT #278)', () => {
  beforeAll(() => {
    // The modules load while the window is in landscape.
    setWindow(LANDSCAPE.width, LANDSCAPE.height);
    RewayatInfoSheet =
      require('@/components/sheets/RewayatInfoSheet').RewayatInfoSheet;
    MushafLayoutSheet =
      require('@/components/sheets/MushafLayoutSheet').MushafLayoutSheet;
  });

  afterEach(() => {
    act(() => mounted?.unmount());
    mounted = undefined;
    setWindow(PORTRAIT.width, PORTRAIT.height);
  });

  it.each(sheets)(
    '%s: a module loaded in landscape renders in portrait at the portrait height',
    (_name, element, ratio) => {
      setWindow(PORTRAIT.width, PORTRAIT.height);
      const root = mount(element());
      expect(sheetHeight(root)).toBeCloseTo(PORTRAIT.height * ratio, 5);
    },
  );

  it.each(sheets)(
    '%s: an open sheet changes its height when the window turns',
    (_name, element, ratio) => {
      // iPad 11-inch: the app supports multitasking, so every screen turns.
      setWindow(820, 1180);
      const root = mount(element());
      expect(sheetHeight(root)).toBeCloseTo(1180 * ratio, 5);
      setWindow(1180, 820);
      expect(sheetHeight(root)).toBeCloseTo(820 * ratio, 5);
    },
  );
});
