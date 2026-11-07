// @ai-generated
// Qariah (TECH_DEBT #323): the country rows of the Listen tab have one order
// on each platform and in each language. A `localeCompare` of the Arabic
// names used the ICU data of the device, and iOS and Android sorted them in
// different orders (Spain first on iOS, Australia first on Android).
import {getAllCountries} from '@/data/countryCollections';
import {RECITERS, type Reciter} from '@/data/reciterData';
import type {AppLanguage} from '@/i18n/language';

const catalog: Reciter[] = require('../../assets/data/catalog.json');
const ARABIC_LETTER = /\p{Script=Arabic}/u;

function ids(language: AppLanguage): string[] {
  return getAllCountries(language).map(country => country.id);
}

function reciterIn(country: string, id: string): Reciter {
  return {id, name: `Reciter ${id}`, country} as unknown as Reciter;
}

describe('getAllCountries order (TECH_DEBT #323)', () => {
  const original = [...RECITERS];

  beforeEach(() => {
    RECITERS.splice(0, RECITERS.length, ...catalog);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    RECITERS.splice(0, RECITERS.length, ...original);
  });

  it('shows the Arabic names in Arabic and the catalog names in English', () => {
    const arabic = getAllCountries('ar');
    const english = getAllCountries('en');
    expect(arabic.length).toBeGreaterThan(1);
    expect(arabic.every(country => ARABIC_LETTER.test(country.name))).toBe(
      true,
    );
    expect(english.some(country => ARABIC_LETTER.test(country.name))).toBe(
      false,
    );
  });

  it('has the same order in English and in Arabic', () => {
    expect(ids('ar')).toEqual(ids('en'));
  });

  it('does not use the collation data of the device', () => {
    const expected = ids('en');
    // A device whose ICU data sorts in a different order: here, the reverse.
    jest.spyOn(String.prototype, 'localeCompare').mockImplementation(function (
      this: string,
      other: string,
    ) {
      return this < other ? 1 : this > other ? -1 : 0;
    });
    const collator = jest.spyOn(Intl, 'Collator');

    expect(ids('ar')).toEqual(expected);
    expect(ids('en')).toEqual(expected);
    expect(collator).not.toHaveBeenCalled();
  });

  it('keeps the English order of the catalog names', () => {
    const names = getAllCountries('en').map(country => country.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('puts Australia before Spain in each language', () => {
    RECITERS.splice(
      0,
      RECITERS.length,
      reciterIn('Spain', '1'),
      reciterIn('Egypt', '2'),
      reciterIn('Australia', '3'),
      reciterIn('United States of America', '4'),
    );
    const expected = [
      'australia',
      'egypt',
      'spain',
      'united-states-of-america',
    ];
    expect(ids('en')).toEqual(expected);
    expect(ids('ar')).toEqual(expected);
  });

  it('sorts an accented name with the names of the same base letters', () => {
    // A plain comparison puts "å", "ô" and "ü" after "z". Without the
    // diacritics step, "åland-islands" sorts after "yemen", "côte-d'ivoire"
    // after "cuba", and "türkiye" after "turkmenistan".
    RECITERS.splice(
      0,
      RECITERS.length,
      reciterIn('Yemen', '1'),
      reciterIn('Turkmenistan', '2'),
      reciterIn('Türkiye', '3'),
      reciterIn('Tunisia', '4'),
      reciterIn('Cuba', '5'),
      reciterIn("Côte d'Ivoire", '6'),
      reciterIn('Canada', '7'),
      reciterIn('Algeria', '8'),
      reciterIn('Åland Islands', '9'),
    );
    const expected = [
      'åland-islands',
      'algeria',
      'canada',
      "côte-d'ivoire",
      'cuba',
      'tunisia',
      'türkiye',
      'turkmenistan',
      'yemen',
    ];
    expect(ids('en')).toEqual(expected);
    expect(ids('ar')).toEqual(expected);

    // The same order as the English names in an English collation.
    const names = getAllCountries('en').map(country => country.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });
});
