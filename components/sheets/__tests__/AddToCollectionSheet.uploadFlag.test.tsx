// @ai Sprint 52 Task 7: the "Upload recitation" row follows the `userUploads`
// flag (Qariah: off). The other rows stay.
import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({Feather: () => null}));
jest.mock('@/components/Icons', () => ({PlaylistIcon: () => null}));
jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {show: jest.fn(), hide: jest.fn()},
}));
jest.mock('@/components/sheets/AdaptiveActionSheet', () => ({
  __esModule: true,
  default: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@/store/uploadsStore', () => ({
  useUploadsStore: () => ({importFile: jest.fn(), importFiles: jest.fn()}),
}));
jest.mock('@/hooks/usePlaylists', () => ({
  usePlaylists: () => ({playlists: [], createPlaylist: jest.fn()}),
}));
jest.mock('@/utils/importAudio', () => ({pickAndImportAudioFiles: jest.fn()}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {colors: {background: '#fff', text: '#000', textSecondary: '#666'}},
  }),
}));
let mockUploads = false;
jest.mock('@/config/featureFlags', () => ({
  isFeatureEnabled: (flag: string) =>
    flag === 'userUploads' ? mockUploads : false,
}));

import {AddToCollectionSheet} from '../AddToCollectionSheet';

const props = {
  sheetId: 'add-to-collection',
} as unknown as React.ComponentProps<typeof AddToCollectionSheet>;

describe('AddToCollectionSheet upload row', () => {
  it('is hidden while userUploads is off', () => {
    mockUploads = false;
    const screen = render(<AddToCollectionSheet {...props} />);
    expect(screen.queryByText('Upload Recitation')).toBeNull();
    expect(screen.getByText('Create New Playlist')).toBeTruthy();
  });

  it('shows while userUploads is on', () => {
    mockUploads = true;
    const screen = render(<AddToCollectionSheet {...props} />);
    expect(screen.getByText('Upload Recitation')).toBeTruthy();
  });
});
