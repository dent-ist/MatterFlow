import { nextNumberError } from './next-numbers-dialog';

describe('nextNumberError (#1297)', () => {
  it('says the spec sentences', () => {
    expect(nextNumberError('', 8)).toBe('Enter the next number.');
    expect(nextNumberError('  ', 8)).toBe('Enter the next number.');
    expect(nextNumberError('1.5', 8)).toBe('Next Number must be a whole number.');
    expect(nextNumberError('abc', 8)).toBe('Next Number must be a whole number.');
    expect(nextNumberError('1000000', 8)).toBe('Enter 999999 or less.');
    expect(nextNumberError('7', 8)).toBe(
      'The next number can’t be lower than 8, the number the next asset gets now.',
    );
  });

  it('accepts the current number, a higher one and the maximum', () => {
    expect(nextNumberError('8', 8)).toBeNull();
    expect(nextNumberError('120', 8)).toBeNull();
    expect(nextNumberError('999999', 8)).toBeNull();
  });
});
