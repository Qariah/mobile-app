// @ai-generated
// Qariah: lists in the UI language. Hermes has no Intl.ListFormat, so
// `formatList` takes its words from the qariah namespace.
import i18n from '@/i18n';
import {formatCommaList, formatList} from '../qariahList';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('formatList', () => {
  it('joins English with "and" before the last item', () => {
    expect(formatList([])).toBe('');
    expect(formatList(['2 reciter favorites'])).toBe('2 reciter favorites');
    expect(formatList(['a', 'b'])).toBe('a and b');
    expect(formatList(['a', 'b', 'c'])).toBe('a, b, and c');
    expect(formatList(['a', 'b', 'c', 'd'])).toBe('a, b, c, and d');
  });

  it('joins Arabic with "،" and "و"', async () => {
    await i18n.changeLanguage('ar');
    expect(formatList(['أ'])).toBe('أ');
    expect(formatList(['أ', 'ب'])).toBe('أ وب');
    expect(formatList(['أ', 'ب', 'ج'])).toBe('أ، ب، وج');
  });
});

describe('formatCommaList', () => {
  it('joins with the comma only', async () => {
    expect(formatCommaList([])).toBe('');
    expect(formatCommaList(['a', 'b', 'c'])).toBe('a, b, c');
    await i18n.changeLanguage('ar');
    expect(formatCommaList(['أ', 'ب', 'ج'])).toBe('أ، ب، ج');
  });
});
