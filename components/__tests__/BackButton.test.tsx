// @ai
// TECH_DEBT #274: in landscape on iOS 18 (a notch or Dynamic Island inset of
// 62 pt), the "Search surahs" button of the Mushaf reader covered the back
// arrow. The reader header pads both sides by the safe-area inset, and the
// back button added the inset a second time, so it grew wider than its header
// slot. The container owns the inset; the button must not add it.
import React from 'react';
import {StyleSheet} from 'react-native';
import {render} from '@testing-library/react-native';
import {BackButton} from '../BackButton';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 21, left: 62, right: 62}),
  SafeAreaProvider: ({children}: {children: React.ReactNode}) => children,
}));

jest.mock('expo-router', () => ({
  useNavigation: () => ({goBack: jest.fn()}),
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({theme: {colors: {text: '#000'}}}),
}));

jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));

describe('BackButton', () => {
  it('does not add the safe-area inset to its own width', () => {
    const {UNSAFE_root} = render(<BackButton onPress={() => undefined} />);
    const styled = UNSAFE_root.findAll(
      (node: {props: {style?: unknown}}) => node.props.style != null,
    );
    expect(styled.length).toBeGreaterThan(0);
    for (const node of styled) {
      const style = StyleSheet.flatten(node.props.style as never) ?? {};
      for (const prop of [
        'margin',
        'marginLeft',
        'marginStart',
        'marginHorizontal',
        'paddingLeft',
        'paddingStart',
      ] as const) {
        expect((style as Record<string, unknown>)[prop]).not.toBe(62);
      }
    }
  });

  it('keeps the style that the caller gives', () => {
    const {UNSAFE_root} = render(
      <BackButton onPress={() => undefined} style={{marginTop: 7}} />,
    );
    const withCallerStyle = UNSAFE_root.findAll(
      (node: {props: {style?: unknown}}) => {
        const style = StyleSheet.flatten(node.props.style as never) ?? {};
        return (style as Record<string, unknown>).marginTop === 7;
      },
    );
    expect(withCallerStyle.length).toBeGreaterThan(0);
  });
});
