import { personInitials } from './person-initials';

describe('personInitials', () => {
  it.each([
    ['Dana Whitfield', 'DW'],
    ['Mary Jane Smith', 'MS'],
    ['KE\\kekim', 'KE'],
    ['ke\\dana.whitfield', 'DW'],
    ['dana.whitfield@firm.test', 'DW'],
    ['dana@firm.test', 'DA'],
    ['Dana', 'DA'],
    ['X', 'X'],
    ["  Liam O'Connor ", 'LO'],
    ['Élodie Brun', 'ÉB'],
  ])('%s gives %s', (name, expected) => {
    expect(personInitials(name)).toBe(expected);
  });

  it.each([[''], ['   '], [null], [undefined], ['\\'], ['@']])(
    '%s has no name: a question mark',
    (name) => {
      expect(personInitials(name)).toBe('?');
    },
  );
});
