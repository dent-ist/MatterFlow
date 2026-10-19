import { CARD_TEXT_MAX, cardText } from './type-card-text';

describe('cardText', () => {
  it('returns short text as it is (spaces collapsed)', () => {
    expect(cardText('  Add   6 custodians ')).toBe('Add 6 custodians');
    expect(cardText(null)).toBe('');
    expect(cardText(undefined)).toBe('');
  });

  it('cuts long text after the last whole word and ends with an ellipsis', () => {
    const long = 'Add custodians to the review platform. '.repeat(6).trim();
    const out = cardText(long);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(CARD_TEXT_MAX + 1);
    // Every word before the ellipsis is a whole word of the source.
    const words = new Set(long.split(' ').map((w) => w.replace(/[.,]/g, '')));
    for (const w of out.slice(0, -1).split(' '))
      expect(words.has(w.replace(/[.,]/g, ''))).toBe(true);
  });

  it('does not leave punctuation before the ellipsis', () => {
    expect(cardText('One, two, three, four, five', 10)).toBe('One, two…');
  });

  it('cuts inside a word only when one word is longer than the room', () => {
    expect(cardText('a'.repeat(200), 20)).toBe('a'.repeat(20) + '…');
  });
});
