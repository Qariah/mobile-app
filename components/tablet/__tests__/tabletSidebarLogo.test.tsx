// @ai-generated
// TECH_DEBT #355: the tablet sidebar drew the inherited starburst (`LogoIcon`)
// above the tabs, in the app and in the 3.2.2 iPad store screenshots. The mark
// now comes from `branding.sidebarLogo`; with the field unset, the sidebar
// keeps `LogoIcon`, as upstream does.
//
// Pass D (2026-11-07): upstream rebuilt the sidebar (components/tablet/
// sidebarNav.ts, a labelled sidebar and an icon rail). These tests also hold
// the other Qariah pieces in it: the Arabic app name, and no Adhkar or uploads
// item while config/featureFlags.ts turns them off.

import React from 'react';
import {render} from '@testing-library/react-native';

const LIGHT = {testUri: 'sidebar-logo.png'};
const DARK = {testUri: 'sidebar-logo-dark.png'};

const mockTheme = {isDarkMode: false};
let mockWidth = 800; // the icon rail

// The factory builds the object: the hoisted import of TabletSidebar loads
// this mock before any `const` of the test file runs.
jest.mock('@/config/branding', () => ({__esModule: true, default: {}}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {colors: {text: '#111111', background: '#f4f3ec'}},
    isDarkMode: mockTheme.isDarkMode,
  }),
}));

jest.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => ({width: mockWidth}),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('expo-router', () => ({
  router: {navigate: jest.fn(), dismissTo: jest.fn()},
  useIsFocused: () => true,
}));

jest.mock('@/modules/bayaan-keyboard', () => ({
  BayaanKeyboard: {
    isAvailable: false,
    setCommands: jest.fn(),
    addKeyCommandListener: jest.fn(() => () => undefined),
  },
}));

jest.mock('@/services/player/store/playerStore', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  usePlayerStore: selector => selector({queue: {tracks: [], currentIndex: 0}}),
}));

jest.mock('@/components/tablet/TabletDockedPlayer', () => ({
  TabletDockedPlayer: () => null,
}));

jest.mock('@/components/Icons', () => {
  const {View} = require('react-native');
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  const LogoIcon = props => <View testID="logo-icon" {...props} />;
  const Icon = () => null;
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  return new Proxy({LogoIcon}, {get: (target, key) => target[key] ?? Icon});
});

jest.mock('@expo/vector-icons', () => ({Feather: () => null}));

jest.mock('@/i18n/qariahAppName', () => ({
  ...jest.requireActual('@/i18n/qariahAppName'),
  getAppDisplayName: () => 'قارئة',
}));

import {TabletSidebar} from '../TabletSidebar';
import branding from '@/config/branding';
import {useTabletSidebarStore} from '@/store/tabletSidebarStore';

const mockBranding = branding as {
  sidebarLogo?: {light: unknown; dark?: unknown};
};

type SidebarProps = React.ComponentProps<typeof TabletSidebar>;

const props = {
  state: {index: 0, routes: [{key: 'listen', name: '(a.home)'}]},
  descriptors: {listen: {options: {title: 'Listen'}}},
  navigation: {emit: () => ({defaultPrevented: false}), dispatch: jest.fn()},
  emitter: {emit: () => ({defaultPrevented: false})},
} as unknown as SidebarProps;

afterEach(() => {
  delete mockBranding.sidebarLogo;
  mockTheme.isDarkMode = false;
  mockWidth = 800;
  useTabletSidebarStore.setState({collapsed: false});
});

describe('TabletSidebar mark (TECH_DEBT #355)', () => {
  it('shows the light branding mark on the light theme', () => {
    mockBranding.sidebarLogo = {light: LIGHT, dark: DARK};
    const {getByTestId, queryByTestId} = render(<TabletSidebar {...props} />);
    expect(getByTestId('tablet-sidebar-logo').props.source).toBe(LIGHT);
    expect(queryByTestId('logo-icon')).toBeNull();
  });

  it('shows the dark branding mark on the dark theme', () => {
    mockBranding.sidebarLogo = {light: LIGHT, dark: DARK};
    mockTheme.isDarkMode = true;
    const {getByTestId} = render(<TabletSidebar {...props} />);
    expect(getByTestId('tablet-sidebar-logo').props.source).toBe(DARK);
  });

  it('shows the light mark on the dark theme when there is no dark mark', () => {
    mockBranding.sidebarLogo = {light: LIGHT};
    mockTheme.isDarkMode = true;
    const {getByTestId} = render(<TabletSidebar {...props} />);
    expect(getByTestId('tablet-sidebar-logo').props.source).toBe(LIGHT);
  });

  it('keeps LogoIcon when branding sets no mark (the upstream default)', () => {
    const {getByTestId, queryByTestId} = render(<TabletSidebar {...props} />);
    expect(queryByTestId('tablet-sidebar-logo')).toBeNull();
    expect(getByTestId('logo-icon').props.size).toBe(40);
  });
});

describe('TabletSidebar, the labelled sidebar (Pass D)', () => {
  beforeEach(() => {
    mockWidth = 1032;
  });

  it('names the app with getAppDisplayName()', () => {
    const {getByText} = render(<TabletSidebar {...props} />);
    expect(getByText('قارئة')).toBeTruthy();
  });

  it('has no Adhkar and no uploads item while the flags are off', () => {
    const {queryByLabelText, getByLabelText} = render(
      <TabletSidebar {...props} />,
    );
    expect(queryByLabelText('Adhkar')).toBeNull();
    expect(queryByLabelText('Uploads')).toBeNull();
    expect(getByLabelText('Downloads')).toBeTruthy();
  });
});
