import { buildList, csvCell, textCell } from './list-export';

describe('list export (PM v2, #879)', () => {
  it('quotes a CSV cell that needs it and neutralises a formula start', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    for (const start of ['=1+1', '+49', '-5', '@SUM(A1)']) expect(csvCell(start)).toBe(`'${start}`);
    expect(csvCell('=a,b')).toBe('"\'=a,b"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12)).toBe('12');
  });

  it('keeps a text cell on one line', () => {
    expect(textCell('a\tb\r\nc')).toBe('a b  c');
    expect(textCell('=cmd')).toBe("'=cmd");
  });

  it('builds the header and one line per row in either format', () => {
    const rows = [
      ['TSK-1', 'A, B'],
      ['TSK-2', null],
    ];
    expect(buildList('csv', ['Task', 'Title'], rows)).toBe(
      'Task,Title\r\nTSK-1,"A, B"\r\nTSK-2,\r\n',
    );
    expect(buildList('text', ['Task', 'Title'], rows)).toBe('Task\tTitle\nTSK-1\tA, B\nTSK-2\t\n');
  });
});
