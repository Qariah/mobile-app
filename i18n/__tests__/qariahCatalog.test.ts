// @ai-generated
// Qariah (Sprint 47 Task 8): catalog text in the UI language
// (i18n/qariahCatalog.ts). English shows the catalog's own text; Arabic shows
// the review pack's Arabic (planning/pass-c/arabic-review/), through the
// catalog fields, the `qariah` namespace or upstream's rewayah keys.
import {getCountryISO} from '@/data/countryISO';
import {getAllCountries} from '@/data/countryCollections';
import {RECITERS, type Reciter} from '@/data/reciterData';
import {
  getCatalogRewayahLabel,
  getCountryDisplayName,
  getReciterBio,
  rewayahSlug,
} from '../qariahCatalog';
import {itWithReviewPack, readReviewSheet} from '@/test-utils/reviewPack';

const catalog: Reciter[] = require('../../assets/data/catalog.json');
const ARABIC_LETTER = /\p{Script=Arabic}/u;
const LATIN_LETTER = /[A-Za-z]/;

describe('getReciterBio', () => {
  const reciter = {bio_en: ' Hafitha ', bio_ar: ' حافظة '};

  it('shows bio_en in English', () => {
    expect(getReciterBio(reciter, 'en')).toBe('Hafitha');
  });

  it('shows bio_ar in Arabic', () => {
    expect(getReciterBio(reciter, 'ar')).toBe('حافظة');
  });

  it('falls back to bio_en in Arabic when bio_ar is missing or empty', () => {
    expect(getReciterBio({bio_en: 'Hafitha'}, 'ar')).toBe('Hafitha');
    expect(getReciterBio({bio_en: 'Hafitha', bio_ar: ' '}, 'ar')).toBe(
      'Hafitha',
    );
  });

  it('is null without a bio', () => {
    expect(getReciterBio({}, 'en')).toBeNull();
    expect(getReciterBio({bio_en: null, bio_ar: null}, 'ar')).toBeNull();
  });

  it('gives every bundled reciter with a bio an Arabic bio', () => {
    const english = catalog.filter(r => r.bio_en?.trim());
    expect(english.length).toBeGreaterThan(0);
    for (const item of english) {
      expect({
        slug: item.slug,
        arabic: ARABIC_LETTER.test(getReciterBio(item, 'ar') ?? ''),
      }).toEqual({slug: item.slug, arabic: true});
      expect(getReciterBio(item, 'en')).toBe(item.bio_en?.trim());
    }
  });
});

describe('getCountryDisplayName', () => {
  const countries = [
    ...new Set(catalog.map(r => r.country).filter((c): c is string => !!c)),
  ];

  it('keeps the catalog value in English', () => {
    for (const country of countries) {
      expect(getCountryDisplayName(country, 'en')).toBe(country);
    }
  });

  it('has an Arabic name for every country in the bundled catalog', () => {
    for (const country of countries) {
      const arabic = getCountryDisplayName(country, 'ar');
      expect({
        country,
        arabic: ARABIC_LETTER.test(arabic) && !LATIN_LETTER.test(arabic),
      }).toEqual({country, arabic: true});
    }
  });

  it('gives "USA" and "United States of America" the same Arabic', () => {
    expect(getCountryDisplayName('USA', 'ar')).toBe(
      getCountryDisplayName('United States of America', 'ar'),
    );
  });

  it('keeps a country without a code in both languages', () => {
    expect(getCountryDisplayName('Atlantis', 'ar')).toBe('Atlantis');
    expect(getCountryDisplayName('Atlantis', 'en')).toBe('Atlantis');
  });

  itWithReviewPack(
    'matches countries.csv, and its codes match countryISO',
    () => {
      const rows = readReviewSheet('countries.csv');
      expect(rows).toHaveLength(27);
      for (const row of rows) {
        const [, slug, code] = /^(\S+) \(([A-Z]{2})\)$/.exec(row.key) ?? [];
        expect({row: row.number, code: getCountryISO(slug)}).toEqual({
          row: row.number,
          code,
        });
        expect(getCountryDisplayName(row.english, 'ar')).toBe(row.arabic);
        expect(getCountryDisplayName(row.english, 'en')).toBe(row.english);
      }
    },
  );

  describe('the Listen tab country cards', () => {
    afterEach(() => {
      RECITERS.splice(0, RECITERS.length);
    });

    it('name each card in the UI language (the browse title uses it)', () => {
      RECITERS.splice(0, RECITERS.length, ...catalog);
      const cards = getAllCountries();
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        // The Jest app language is English: the catalog value.
        expect(countries).toContain(card.name);
      }
    });
  });
});

describe('getCatalogRewayahLabel', () => {
  const names = [
    ...new Set(catalog.flatMap(r => r.rewayat.map(rewayah => rewayah.name))),
  ];

  it('keeps the catalog name in English', () => {
    for (const name of names) {
      expect(getCatalogRewayahLabel({name}, 'en')).toBe(name);
    }
  });

  it('has an Arabic label for every rewayah name in the bundled catalog', () => {
    for (const name of names) {
      const arabic = getCatalogRewayahLabel({name}, 'ar');
      expect({
        name,
        arabic: ARABIC_LETTER.test(arabic) && !LATIN_LETTER.test(arabic),
      }).toEqual({name, arabic: true});
    }
  });

  it('reads a spelling with diacritics like the plain one', () => {
    expect(getCatalogRewayahLabel({name: "Hafs 'an 'Āṣim"}, 'ar')).toBe(
      getCatalogRewayahLabel({name: "Hafs A'n Assem"}, 'ar'),
    );
  });

  it("uses the ops console's name_ar only for an unknown name", () => {
    expect(
      getCatalogRewayahLabel({name: 'Unknown A', name_ar: 'رواية'}, 'ar'),
    ).toBe('رواية');
    expect(getCatalogRewayahLabel({name: 'Unknown A'}, 'ar')).toBe('Unknown A');
    expect(
      getCatalogRewayahLabel({name: "Hafs A'n Assem", name_ar: 'x'}, 'ar'),
    ).not.toBe('x');
  });

  it('makes the same slugs as the generator', () => {
    expect(rewayahSlug("Al-Kisa'i")).toBe('al-kisai');
    expect(rewayahSlug('English Translation')).toBe('english-translation');
    expect(rewayahSlug("Hafs 'an 'Āṣim")).toBe('hafs-an-asim');
    expect(rewayahSlug("Al-Doori A'n Abi Amr")).toBe('al-doori-an-abi-amr');
  });

  itWithReviewPack('matches rewayat.csv section 2 (catalog names)', () => {
    const rows = readReviewSheet('rewayat.csv').filter(row =>
      row.section.startsWith('2.'),
    );
    expect(rows).toHaveLength(13);
    for (const row of rows) {
      expect({
        row: row.number,
        label: getCatalogRewayahLabel({name: row.english}, 'ar'),
      }).toEqual({row: row.number, label: row.arabic});
    }
  });
});
