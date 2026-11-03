import { shortAccountName } from './person-name';

describe('shortAccountName', () => {
  it.each([
    ['KE\\kekim', 'kekim'],
    ['ke\\dana.whitfield', 'dana.whitfield'],
    ['dana@firm.test', 'dana'],
    ['Dana Whitfield', 'Dana Whitfield'],
    ['Dana', 'Dana'],
    ['  ', ''],
  ])('%s shows %s', (name, shown) => {
    expect(shortAccountName(name)).toBe(shown);
  });
  it('has nothing for no name', () => {
    expect(shortAccountName(null)).toBe('');
    expect(shortAccountName(undefined)).toBe('');
  });
});
