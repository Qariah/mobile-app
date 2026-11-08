// @ai
// TECH_DEBT #258 — the queue rows have a remove ✕ that a device test finds.
//
// Pass D (2026-11-07): upstream redesigned the queue (QueueRow, with the
// sections "Now Playing", "Up Next" and "Played"). The current row shows the
// playing indicator, and every other row has a remove ✕. Qariah keeps the
// testID `queue-remove-<index>` on each ✕ (the Maestro and iPhone driver
// flows), the space under the player overlays (TECH_DEBT #295) and the remote
// photo of a tagged upload (TECH_DEBT #262).
//
// FlashList, the scrollable, the player store and the row parts are stubs.

import React from 'react';
import {StyleSheet} from 'react-native';
import {fireEvent, render, screen} from '@testing-library/react-native';

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

jest.mock('@/services/dataService', () => ({
  getReciterByIdSync: () => undefined,
  getSurahById: () => undefined,
}));

jest.mock('@/hooks/usePlayerScrollable', () => ({
  usePlayerScrollable: () => undefined,
}));

jest.mock('@/hooks/useReadingThemeColors', () => ({
  useReadingThemeColors: () => ({
    text: '#111111',
    textSecondary: '#666666',
    background: '#ffffff',
    card: '#ffffff',
  }),
}));

// Renders the header and every item, as FlashList does for a short list.
jest.mock('@shopify/flash-list', () => {
  const ReactLib = require('react');
  const {View} = require('react-native');
  return {
    // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
    FlashList: props => {
      const Header = props.ListHeaderComponent;
      return ReactLib.createElement(
        View,
        // TECH_DEBT #295: expose the content padding to the test.
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

// TECH_DEBT #262: the mock keeps the props, so a test can read them.
jest.mock('@/components/ReciterImage', () => {
  const {View} = require('react-native');
  return {
    // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
    ReciterImage: props => <View testID="queue-reciter-image" {...props} />,
  };
});
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

import {QueueList} from '../QueueList';
import {moderateScale} from '@/utils/scale';

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
  it('gives every row after the current one a remove button with a testID', () => {
    renderQueue();

    // The current row shows the playing indicator instead (upstream design).
    expect(screen.queryByTestId('queue-remove-0')).toBeNull();
    for (const index of [1, 2]) {
      const button = screen.getByTestId(`queue-remove-${index}`);
      expect(button.props.accessibilityRole).toBe('button');
      expect(button.props.accessibilityLabel).toMatch(/from queue$/);
    }
  });

  it('gives a played row a remove button too', () => {
    mockState.queue.currentIndex = 2;
    renderQueue();

    expect(screen.getByTestId('queue-remove-0')).toBeTruthy();
    expect(screen.getByTestId('queue-remove-1')).toBeTruthy();
    expect(screen.queryByTestId('queue-remove-2')).toBeNull();
  });

  it('calls onRemoveQueueItem with the row index', () => {
    const onRemove = renderQueue();

    fireEvent.press(screen.getByTestId('queue-remove-1'));
    expect(onRemove).toHaveBeenCalledWith(1);
    fireEvent.press(screen.getByTestId('queue-remove-2'));
    expect(onRemove).toHaveBeenLastCalledWith(2);
    expect(onRemove).toHaveBeenCalledTimes(2);
  });

  it('shows no remove button with no tracks', () => {
    mockState.queue.tracks = [];
    renderQueue();

    expect(screen.queryByTestId('queue-remove-0')).toBeNull();
    expect(screen.queryByTestId('mock-flash-list')).toBeNull();
  });
});

// TECH_DEBT #295 — the full player's top bar and controls float over the
// queue. The list pads its content by the space they cover.
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
      top: 120 + moderateScale(8),
      bottom: 270 + moderateScale(28),
    });
  });

  it('keeps the own gaps when no overlay space is given', () => {
    renderQueue();

    expect(contentPadding()).toEqual({
      top: moderateScale(8),
      bottom: moderateScale(28),
    });
  });
});

// TECH_DEBT #262: the row of an upload that is tagged to a catalog reciter
// shows the reciter photo, as the mini player does.
describe('QueueList — the photo of an upload row (TECH_DEBT #262)', () => {
  it('gives ReciterImage the photo URL of a tagged upload', () => {
    const photo = 'https://example.test/reciters/zaynab-talha/photo.jpg?v=1';
    mockState.queue.tracks = [
      track('u1', {
        isUserUpload: true,
        surahId: '18',
        reciterName: 'Zaynab Talha',
        artwork: photo,
      }),
    ];
    renderQueue();
    const image = screen.getByTestId('queue-reciter-image');
    expect(image.props.imageUrl).toBe(photo);
    expect(image.props.reciterName).toBe('Zaynab Talha');
  });

  it('gives no URL when the upload has no remote photo', () => {
    mockState.queue.tracks = [
      track('u1', {
        isUserUpload: true,
        surahId: '18',
        reciterName: 'Zaynab Talha',
        artwork: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    ];
    renderQueue();
    expect(
      screen.getByTestId('queue-reciter-image').props.imageUrl,
    ).toBeUndefined();
  });
});
