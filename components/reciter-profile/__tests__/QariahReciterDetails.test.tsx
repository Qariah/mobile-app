// @ai-generated
// Qariah (Sprint 52 Task 3): the Qariah reciter details (country and
// translation chips, bio, narration line, recitation count) show in upstream's
// iPad hero through its `details` slot, and the phone header keeps them.
import React from 'react';
import {fireEvent, render, screen, within} from '@testing-library/react-native';
import {TabletReciterHero} from '../components/TabletReciterHero';
import {ReciterHeader} from '../components/ReciterHeader';
import {QariahReciterDetails} from '../components/QariahReciterDetails';
import type {Reciter} from '@/data/reciterData';

jest.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => ({width: 1180, isTablet: true}),
}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        text: '#000000',
        textSecondary: '#666666',
        background: '#ffffff',
        card: '#eeeeee',
        primary: '#008080',
      },
      fonts: {bold: 'b', semiBold: 's'},
    },
  }),
}));
jest.mock('@/hooks/useGlassProps', () => ({USE_GLASS: false}));
jest.mock('expo-router', () => ({Link: {AppleZoomTarget: () => null}}));
jest.mock('@/components/ReciterImage', () => {
  const {View} = jest.requireActual('react-native');
  return {ReciterImage: () => <View testID="photo" />};
});
jest.mock('@/components/Icons', () => ({
  DownloadIcon: () => null,
  PlayIcon: () => null,
  ShuffleIcon: () => null,
}));
jest.mock('@/components/CircularProgress', () => ({
  CircularProgress: () => null,
}));
jest.mock('@expo/vector-icons', () => ({Ionicons: () => null}));

const BIO = 'Hafitha, Shaykha, Ijazaat, Quran Teacher, Ph.D';
const LONG_BIO = `${'A teacher of the Quran for many years. '.repeat(8)}End.`;

function makeReciter(overrides: Partial<Reciter> = {}): Reciter {
  return {
    id: 'r1',
    name: 'Zaynab Talha',
    date: null,
    image_url: null,
    country: 'Algeria',
    bio_en: BIO,
    rewayat: [
      {id: 'h', name: "Hafs A'n Assem", surah_list: [1, 2, 3]},
    ] as Reciter['rewayat'],
    ...overrides,
  };
}

function renderHero(reciter: Reciter) {
  return render(
    <TabletReciterHero
      reciter={reciter}
      paddingTop={8}
      margin={32}
      onPlayPress={jest.fn()}
      onShufflePress={jest.fn()}
      onFavoritePress={jest.fn()}
      isFavoriteReciter={false}
      details={
        <QariahReciterDetails
          reciter={reciter}
          surahCount={3}
          variant="tablet"
        />
      }
    />,
  );
}

/** The own string children of every host Text node, in render order. */
function textsInOrder(): string[] {
  return screen.UNSAFE_root.findAll(n => (n.type as unknown) === 'Text').map(
    n =>
      ([] as unknown[])
        .concat(n.props.children)
        .filter((c): c is string => typeof c === 'string')
        .join(''),
  );
}

describe('TabletReciterHero with the Qariah details', () => {
  it('shows the country chip and the bio under the meta line, above Play all', () => {
    renderHero(makeReciter());
    expect(screen.getByText('Algeria')).toBeTruthy();
    expect(screen.getByText(BIO)).toBeTruthy();

    const texts = textsInOrder();
    const meta = texts.findIndex(t => t.includes('surah'));
    const country = texts.indexOf('Algeria');
    const bio = texts.indexOf(BIO);
    const playAll = texts.indexOf('Play all');
    expect(meta).toBeGreaterThanOrEqual(0);
    expect(playAll).toBeGreaterThanOrEqual(0);
    expect(meta).toBeLessThan(country);
    expect(country).toBeLessThan(bio);
    expect(bio).toBeLessThan(playAll);
  });

  it('keeps the hero and the details out of the accessibility tree as one element', () => {
    renderHero(makeReciter());
    const notAccessible = screen.UNSAFE_root.findAll(
      n => (n.type as unknown) === 'View' && n.props.accessible === false,
    );
    // The hero container and the details container both hold buttons.
    expect(notAccessible.length).toBeGreaterThanOrEqual(2);
    expect(
      within(notAccessible[0]).getByRole('button', {name: /favorite/i}),
    ).toBeTruthy();
  });

  it('shows the translation chip, the narration line and a differing recitation count', () => {
    renderHero(
      makeReciter({
        translation: 'English',
        recitationsCount: 5,
        rewayat: [
          {id: 'w', name: "Warsh A'n Nafi'", surah_list: [1, 2]},
          {id: 'h', name: "Hafs A'n Assem", surah_list: [1, 2, 3]},
        ] as Reciter['rewayat'],
      }),
    );
    expect(screen.getByText('English translation')).toBeTruthy();
    expect(screen.getByText("Warsh A'n Nafi' · Hafs A'n Assem")).toBeTruthy();
    expect(screen.getByText('5 recitations')).toBeTruthy();
  });

  it('cuts a long bio with Read more, and the button opens it', () => {
    renderHero(makeReciter({bio_en: LONG_BIO}));
    expect(screen.queryByText(LONG_BIO)).toBeNull();
    const toggle = screen.getByRole('button', {name: /Read more/});
    expect(toggle.props.accessibilityHint).toBe('Expand bio');
    fireEvent.press(toggle);
    expect(screen.getByText(LONG_BIO, {exact: false})).toBeTruthy();
    expect(screen.getByText('Show less', {exact: false})).toBeTruthy();
  });

  it('renders nothing for a reciter with no Qariah details', () => {
    const reciter = makeReciter({country: null, bio_en: null});
    render(
      <QariahReciterDetails
        reciter={reciter}
        surahCount={3}
        variant="tablet"
      />,
    );
    expect(screen.toJSON()).toBeNull();
  });
});

describe('ReciterHeader (phone) keeps the Qariah details', () => {
  it('shows the chips, the bio and the narration line as before', () => {
    const reciter = makeReciter({
      translation: 'English',
      rewayat: [
        {id: 'w', name: "Warsh A'n Nafi'", surah_list: [1, 2]},
        {id: 'h', name: "Hafs A'n Assem", surah_list: [1, 2, 3]},
      ] as Reciter['rewayat'],
    });
    render(
      <ReciterHeader
        reciter={reciter}
        showSearch={false}
        insets={{top: 0, bottom: 0, left: 0, right: 0}}
      />,
    );
    expect(screen.getByText('Algeria')).toBeTruthy();
    expect(screen.getByText('English translation')).toBeTruthy();
    expect(screen.getByText(BIO)).toBeTruthy();
    expect(screen.getByText("Warsh A'n Nafi' · Hafs A'n Assem")).toBeTruthy();
    // The phone puts the chips and the bio straight in the header, with no
    // wrapper of their own (the layout is the same as before the move).
    const texts = textsInOrder();
    expect(texts.indexOf('Zaynab Talha')).toBeLessThan(
      texts.indexOf('Algeria'),
    );
    expect(
      screen.UNSAFE_root.findAll(
        n => (n.type as unknown) === 'View' && n.props.accessible === false,
      ),
    ).toHaveLength(0);
  });
});
