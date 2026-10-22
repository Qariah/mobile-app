// @ai
// TECH_DEBT #258 — every queue row shows its remove ✕.
//
// The queue row is a flex row: the track item, then the ✕. TrackItem's outer
// view has no flex, so the track item took the full row width and the ✕ sat
// past the right edge of the screen. The row content is now in a wrapper with
// `flex: 1, minWidth: 0`, and the ✕ has a testID and a label.
//
// FlashList, the bottom-sheet scrollable, the player store and the row
// components are stubs. The test checks the row structure that the layout
// fix needs, the remove control on each row, and the press handler.

import React from 'react';
import {StyleSheet} from 'react-native';
import {fireEvent, render, screen} from '@testing-library/react-native';
import type {ReactTestInstance} from 'react-test-renderer';

const mockState: {
  queue: {tracks: Record<string, unknown>[]; currentIndex: number};
  playback: {state: string};
} = {
  queue: {tracks: [], currentIndex: 0},
  playback: {state: 'paused'},
};

jest.mock('@/services/player/store/playerStore', () => {
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  const usePlayerStore = selector => selector(mockState);
  usePlayerStore.getState = () => mockState;
  return {usePlayerStore};
});

jest.mock('@/store/uploadsStore', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  useUploadsStore: selector => selector({recitations: []}),
}));

jest.mock('@gorhom/bottom-sheet', () => ({
  useBottomSheetScrollableCreator: () => undefined,
}));

// Renders the header and every row, as FlashList does for a short list.
jest.mock('@shopify/flash-list', () => {
  const ReactLib = require('react');
  const {View} = require('react-native');
  return {
    // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
    FlashList: props => {
      const Header = props.ListHeaderComponent;
      return ReactLib.createElement(
        View,
        // @ai TECH_DEBT #295: expose the content padding to the test.
        {testID: 'mock-flash-list', style: props.contentContainerStyle},
        Header ? ReactLib.createElement(Header) : null,
        // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
        props.data.map((item, index) =>
          ReactLib.createElement(
            ReactLib.Fragment,
            {key: props.keyExtractor(item, index)},
            props.renderItem({item, index}),
          ),
        ),
      );
    },
  };
});

jest.mock('@/components/TrackItem', () => {
  const {View} = require('react-native');
  return {
    // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
    TrackItem: props => <View testID={`track-item-${props.surahId}`} />,
  };
});

jest.mock('@/components/ReciterImage', () => ({ReciterImage: () => null}));
jest.mock('@/components/NowPlayingIndicator', () => ({
  NowPlayingIndicator: () => null,
}));
jest.mock('@/components/GradientText', () => {
  const {Text} = require('react-native');
  return {
    // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
    GradientText: props => <Text>{props.children}</Text>,
  };
});

jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
  MaterialCommunityIcons: () => null,
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        text: '#111111',
        textSecondary: '#666666',
        card: '#ffffff',
        border: '#eeeeee',
      },
    },
  }),
}));

import {QueueList} from '../QueueList';
import {verticalScale} from '@/utils/scale';

function track(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    url: `https://example.invalid/${id}.mp3`,
    title: id,
    artist: 'Reciter',
    reciterId: 'r1',
    reciterName: 'Reciter',
    surahId: id,
    ...overrides,
  };
}

/** The host (native) views above a node, nearest first. */
function hostAncestors(node: ReactTestInstance): ReactTestInstance[] {
  const out: ReactTestInstance[] = [];
  let parent = node.parent;
  while (parent) {
    if (typeof parent.type === 'string') out.push(parent);
    parent = parent.parent;
  }
  return out;
}

function renderQueue(onRemoveQueueItem = jest.fn()) {
  render(
    <QueueList
      onQueueItemPress={jest.fn()}
      onRemoveQueueItem={onRemoveQueueItem}
    />,
  );
  return onRemoveQueueItem;
}

beforeEach(() => {
  mockState.queue.tracks = [
    track('1'),
    track('2'),
    track('u3', {isUserUpload: true, surahId: '3', reciterName: 'Me'}),
  ];
  mockState.queue.currentIndex = 0;
});

describe('QueueList — the remove ✕ (TECH_DEBT #258)', () => {
  it('gives every row a remove button with a testID and a label', () => {
    renderQueue();

    for (const index of [0, 1, 2]) {
      const button = screen.getByTestId(`queue-remove-${index}`);
      expect(button.props.accessibilityRole).toBe('button');
      expect(button.props.accessibilityLabel).toBe('Remove from queue');
    }
    expect(
      screen.getAllByRole('button', {name: 'Remove from queue'}),
    ).toHaveLength(3);
  });

  it('puts the row content in a flex: 1, minWidth: 0 wrapper next to the ✕', () => {
    renderQueue();

    for (const [index, surahId] of [
      [0, '1'],
      [1, '2'],
    ] as const) {
      const [wrapper, row] = hostAncestors(
        screen.getByTestId(`track-item-${surahId}`),
      );
      const style = StyleSheet.flatten(wrapper.props.style);
      expect(style.flex).toBe(1);
      expect(style.minWidth).toBe(0);

      // The ✕ is the wrapper's sibling: both sit directly in the row.
      expect(StyleSheet.flatten(row.props.style).flexDirection).toBe('row');
      const [removeRow] = hostAncestors(
        screen.getByTestId(`queue-remove-${index}`),
      );
      expect(removeRow).toBe(row);
    }
  });

  it('calls onRemoveQueueItem with the row index', () => {
    const onRemove = renderQueue();

    fireEvent.press(screen.getByTestId('queue-remove-1'));
    expect(onRemove).toHaveBeenCalledWith(1);

    // The first match by label is row 0.
    fireEvent.press(screen.getAllByLabelText('Remove from queue')[0]);
    expect(onRemove).toHaveBeenLastCalledWith(0);
    expect(onRemove).toHaveBeenCalledTimes(2);
  });

  it('shows "Queue is empty" with no tracks', () => {
    mockState.queue.tracks = [];
    renderQueue();

    expect(screen.getByText('Queue is empty')).toBeTruthy();
    expect(screen.queryByTestId('queue-remove-0')).toBeNull();
  });
});

// @ai-start TECH_DEBT #295 — the full player's top bar and controls float over
// the queue. The list pads its content by the space they cover, so the header
// and the first row start below the top bar and the last row ends above the
// controls.
describe('QueueList — content clear of the player overlays (TECH_DEBT #295)', () => {
  function contentPadding() {
    const style = StyleSheet.flatten(
      screen.getByTestId('mock-flash-list').props.style,
    );
    return {top: style.paddingTop, bottom: style.paddingBottom};
  }

  it('adds the overlay space to the list gaps', () => {
    render(
      <QueueList
        onQueueItemPress={jest.fn()}
        onRemoveQueueItem={jest.fn()}
        contentPaddingTop={120}
        contentPaddingBottom={270}
      />,
    );

    expect(contentPadding()).toEqual({
      top: 120 + verticalScale(8),
      bottom: 270 + verticalScale(20),
    });
  });

  it('keeps the old gaps when no overlay space is given', () => {
    renderQueue();

    expect(contentPadding()).toEqual({
      top: verticalScale(8),
      bottom: verticalScale(20),
    });
  });
});
// @ai-end
