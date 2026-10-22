// @ai-generated
// Qariah (TECH_DEBT #304): Arabic labels for catalog rewayah names that
// upstream's registry does not resolve, and Arabic translation-language names.
jest.mock('../language', () => ({currentLanguage: 'en'}));

import {getDisplayLabelFromName} from '@/services/rewayah/RewayahIdentity';
import {getQariahRewayahLabel} from '../qariahRewayah';
import {getTranslationLanguageName} from '../qariahCatalog';

const ARABIC = /[؀-ۿ]/;

describe('catalog rewayah names upstream does not resolve', () => {
  it.each([
    ["Al-Doori A'n Abi Amr"],
    ["Bazzi A'n Ibn Kathir"],
    ["Khalaf A'n Hamza"],
    ["Hafs 'an 'Asim"],
    ["Hafs 'an 'Āṣim"],
    ["Al-Kisa'i"],
    ['English Translation'],
  ])('%s has an Arabic label in Arabic', name => {
    expect(getQariahRewayahLabel(name, 'short', 'ar')).toMatch(ARABIC);
    expect(getQariahRewayahLabel(name, 'long', 'ar')).toMatch(ARABIC);
  });

  it('gives nothing in English, so English keeps the catalog name', () => {
    expect(getQariahRewayahLabel("Khalaf A'n Hamza", 'short', 'en')).toBeNull();
    expect(getDisplayLabelFromName("Khalaf A'n Hamza")).toBe(
      "Khalaf A'n Hamza",
    );
  });

  it('gives nothing for a name it does not know', () => {
    expect(getQariahRewayahLabel('Unknown Rewayah', 'short', 'ar')).toBeNull();
  });
});

describe('translation language names', () => {
  it('shows the Arabic name in Arabic and the catalog value in English', () => {
    expect(getTranslationLanguageName('English', 'ar')).toBe('الإنجليزية');
    expect(getTranslationLanguageName('Spanish', 'ar')).toBe('الإسبانية');
    expect(getTranslationLanguageName('Russian', 'ar')).toBe('الروسية');
    expect(getTranslationLanguageName('English', 'en')).toBe('English');
    expect(getTranslationLanguageName('Klingon', 'ar')).toBe('Klingon');
  });
});
