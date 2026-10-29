// @ai-generated
// TECH_DEBT #278: the theme scale read the window width once, when the module
// loaded. A module that loads while the window is in landscape gave a larger
// theme typography for the whole session. The scale uses the short side of
// the window when a theme is made.
import {Dimensions} from 'react-native';

function setWindow(width: number, height: number) {
  const size = {width, height, scale: 3, fontScale: 1};
  Dimensions.set({window: size, screen: size});
}

type CreateTheme = typeof import('../themeUtils').createTheme;
let createTheme: CreateTheme;

beforeAll(() => {
  // The module loads while the window is in landscape.
  setWindow(874, 402);
  createTheme = require('../themeUtils').createTheme;
});

afterAll(() => setWindow(402, 874));

it('a phone in landscape gets the portrait scale', () => {
  setWindow(402, 874);
  const portrait = createTheme('light', 'Blue');
  expect(portrait.typography.bodySize).toBeCloseTo((402 / 375) * 16, 5);
  setWindow(874, 402);
  const landscape = createTheme('light', 'Blue');
  expect(landscape.typography).toEqual(portrait.typography);
  expect(landscape.spacing).toEqual(portrait.spacing);
});

it('a tablet keeps the PHONE_SCALE_CAP scale in both orientations', () => {
  setWindow(820, 1180);
  expect(createTheme('dark', 'Blue').typography.bodySize).toBeCloseTo(
    (430 / 375) * 16,
    5,
  );
  setWindow(1180, 820);
  expect(createTheme('dark', 'Blue').typography.bodySize).toBeCloseTo(
    (430 / 375) * 16,
    5,
  );
});
