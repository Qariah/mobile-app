// @ai-generated
// Qariah (TECH_DEBT #314): the item layout of the horizontal Listen rows is
// the real one: the scaled card width, the gap and the padding.
import {moderateScale} from 'react-native-size-matters';
import {
  ROW_GAP,
  ROW_PADDING,
  rowCardWidth,
  rowItemLayout,
  type RowVariant,
} from '../rowItemLayout';
import {RECENT_CARD_WIDTH} from '@/components/cards/recentCardStyles';

const VARIANTS: RowVariant[] = [
  'recent',
  'circular',
  'default',
  'featured',
  'rewayat',
  'playlist',
  'country',
  'translation',
];

describe('rowItemLayout', () => {
  it('uses the card widths that RecitersView renders', () => {
    expect(rowCardWidth('rewayat')).toBe(moderateScale(130));
    expect(rowCardWidth('country')).toBe(moderateScale(130));
    expect(rowCardWidth('translation')).toBe(moderateScale(130));
    expect(rowCardWidth('default')).toBe(moderateScale(120));
    expect(rowCardWidth('featured')).toBe(moderateScale(140));
    expect(rowCardWidth('playlist')).toBe(moderateScale(110));
    expect(rowCardWidth('recent')).toBe(RECENT_CARD_WIDTH);
    expect(rowCardWidth('circular')).toBe(64 + moderateScale(6));
    expect(ROW_PADDING).toBe(moderateScale(16));
    expect(ROW_GAP).toBe(moderateScale(8));
  });

  it.each(VARIANTS)(
    '%s: the length is the card, the offset adds a card and a gap',
    variant => {
      const width = rowCardWidth(variant);
      const first = rowItemLayout(variant, 0);
      const fifth = rowItemLayout(variant, 4);
      expect(first).toEqual({length: width, offset: ROW_PADDING, index: 0});
      expect(fifth.length).toBe(width);
      expect(fifth.offset).toBeCloseTo(ROW_PADDING + 4 * (width + ROW_GAP));
      expect(fifth.index).toBe(4);
    },
  );

  it('ends the last card where the content ends, before the padding', () => {
    // 27 country cards: padding, 27 cards, 26 gaps, padding.
    const count = 27;
    const width = rowCardWidth('country');
    const contentWidth =
      2 * ROW_PADDING + count * width + (count - 1) * ROW_GAP;
    const last = rowItemLayout('country', count - 1);
    expect(last.offset + last.length + ROW_PADDING).toBeCloseTo(contentWidth);
  });

  it('starts after a header and its gap', () => {
    const leading = 100 + ROW_GAP;
    expect(rowItemLayout('recent', 0, leading).offset).toBe(
      ROW_PADDING + leading,
    );
    expect(rowItemLayout('recent', 2, leading).offset).toBeCloseTo(
      ROW_PADDING + leading + 2 * (RECENT_CARD_WIDTH + ROW_GAP),
    );
  });
});
