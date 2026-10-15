import {
  MAX_INSERT_COLUMNS,
  MAX_INSERT_ROWS,
  NEW_CELL_MARK,
  addColumn,
  addRow,
  buildGrid,
  buildTableHtml,
  cellCount,
  deleteColumn,
  deleteRow,
  deleteTable,
  describeCell,
  fitsCellLimit,
} from './rich-table';

function table(html: string): HTMLTableElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.querySelector('table')!;
}

/** The table as rows of cell texts, with spans written as `text[c2r3]`, for readable assertions. */
function shape(t: HTMLTableElement): string[][] {
  return Array.from(t.rows).map((tr) =>
    Array.from(tr.cells).map((c) => {
      const cs = c.colSpan > 1 ? `c${c.colSpan}` : '';
      const rs = c.rowSpan > 1 ? `r${c.rowSpan}` : '';
      return `${c.textContent}${cs || rs ? `[${cs}${rs}]` : ''}`;
    }),
  );
}

const cell = (t: HTMLTableElement, text: string): HTMLTableCellElement =>
  Array.from(t.querySelectorAll('td, th')).find(
    (c) => c.textContent === text,
  ) as HTMLTableCellElement;

describe('rich table tools', () => {
  describe('buildTableHtml', () => {
    it('builds a header row of th (scope col) and body rows of td, with a line break in each empty cell', () => {
      const host = document.createElement('div');
      host.innerHTML = buildTableHtml(3, 2, true);
      expect(host.querySelectorAll('thead th[scope=col]').length).toBe(2);
      expect(host.querySelectorAll('tbody tr').length).toBe(2);
      expect(host.querySelectorAll('tbody td').length).toBe(4);
      expect(host.querySelectorAll('td > br, th > br').length).toBe(6);
      expect(host.querySelectorAll(`[${NEW_CELL_MARK}]`).length).toBe(1);
      expect(host.querySelector('thead th')?.hasAttribute(NEW_CELL_MARK)).toBe(true);
      // A paragraph after the table gives the caret a place below it.
      expect(host.lastElementChild?.tagName).toBe('P');
    });

    it('builds a table without a header and marks the first body cell', () => {
      const host = document.createElement('div');
      host.innerHTML = buildTableHtml(2, 2, false);
      expect(host.querySelector('thead')).toBeNull();
      expect(host.querySelectorAll('td').length).toBe(4);
      expect(host.querySelector('tbody td')?.hasAttribute(NEW_CELL_MARK)).toBe(true);
    });

    it('clamps rows and columns to 1..8', () => {
      const host = document.createElement('div');
      host.innerHTML = buildTableHtml(99, 99, false);
      expect(host.querySelectorAll('tr').length).toBe(MAX_INSERT_ROWS);
      expect(host.querySelectorAll('tr:first-child td').length).toBe(MAX_INSERT_COLUMNS);
      host.innerHTML = buildTableHtml(0, -4, true);
      expect(host.querySelectorAll('th').length).toBe(1);
      expect(host.querySelectorAll('tbody').length).toBe(0);
      host.innerHTML = buildTableHtml(Number.NaN, Number.NaN, false);
      expect(host.querySelectorAll('td').length).toBe(1);
    });
  });

  describe('rows', () => {
    const plain = (): HTMLTableElement =>
      table(
        '<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>',
      );

    it('adds a row below or above with as many cells as columns and returns the cell in the same column', () => {
      const t = plain();
      const created = addRow(cell(t, 'a'), 'below')!;
      expect(shape(t)).toEqual([
        ['a', 'b'],
        ['', ''],
        ['c', 'd'],
      ]);
      expect(created).toBe(t.rows[1].cells[0]);

      addRow(cell(t, 'd'), 'above');
      expect(shape(t)).toEqual([
        ['a', 'b'],
        ['', ''],
        ['', ''],
        ['c', 'd'],
      ]);
    });

    it('puts a row added below a header row into the body', () => {
      const t = table(
        '<table><thead><tr><th scope="col">H1</th><th scope="col">H2</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
      );
      addRow(cell(t, 'H1'), 'below');
      expect(t.tHead!.rows.length).toBe(1);
      expect(t.tBodies[0].rows.length).toBe(2);
      expect(t.tBodies[0].rows[0].cells[0].tagName).toBe('TD');
    });

    it('stretches a merged cell that crosses the new row instead of adding a cell next to it', () => {
      const t = table(
        '<table><tbody><tr><td rowspan="2">m</td><td>a</td></tr><tr><td>b</td></tr></tbody></table>',
      );
      addRow(cell(t, 'a'), 'below');
      expect(shape(t)).toEqual([['m[r3]', 'a'], [''], ['b']]);
    });

    it('deletes a row, and the table when it was the last row', () => {
      const t = plain();
      expect(deleteRow(cell(t, 'a'))).toBe(t.rows[0].cells[0]);
      expect(shape(t)).toEqual([['c', 'd']]);
      expect(deleteRow(cell(t, 'c'))).toBeNull();
      expect(t.isConnected).toBe(false);
    });

    it('moves a merged cell that starts in the deleted row down into the next row', () => {
      const t = table(
        '<table><tbody><tr><td rowspan="2">m</td><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>',
      );
      deleteRow(cell(t, 'a'));
      expect(shape(t)).toEqual([
        ['m', 'b'],
        ['c', 'd'],
      ]);
    });

    it('shortens a merged cell from above that passes through the deleted row', () => {
      const t = table(
        '<table><tbody><tr><td rowspan="3">m</td><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td></tr></tbody></table>',
      );
      deleteRow(cell(t, 'b'));
      expect(shape(t)).toEqual([['m[r2]', 'a'], ['c']]);
    });

    it('removes an emptied table section', () => {
      const t = table(
        '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>',
      );
      deleteRow(cell(t, 'H'));
      expect(t.tHead).toBeNull();
      expect(shape(t)).toEqual([['a']]);
    });
  });

  describe('columns', () => {
    const plain = (): HTMLTableElement =>
      table(
        '<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>',
      );

    it('adds a column left or right in every row and returns the new cell of the row of the caret', () => {
      const t = plain();
      const created = addColumn(cell(t, 'b'), 'right')!;
      expect(shape(t)).toEqual([
        ['a', 'b', ''],
        ['c', 'd', ''],
      ]);
      expect(created).toBe(t.rows[0].cells[2]);

      addColumn(cell(t, 'c'), 'left');
      expect(shape(t)).toEqual([
        ['', 'a', 'b', ''],
        ['', 'c', 'd', ''],
      ]);
    });

    it('makes the new cells of a header column header cells', () => {
      const t = table(
        '<table><thead><tr><th scope="col">H1</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>',
      );
      addColumn(cell(t, 'H1'), 'right');
      expect(t.tHead!.rows[0].cells[1].tagName).toBe('TH');
      expect(t.tHead!.rows[0].cells[1].getAttribute('scope')).toBe('col');
      expect(t.tBodies[0].rows[0].cells[1].tagName).toBe('TD');
    });

    it('stretches a merged cell that crosses the new column', () => {
      const t = table(
        '<table><tbody><tr><td colspan="2">m</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>',
      );
      addColumn(cell(t, 'a'), 'right');
      expect(shape(t)).toEqual([['m[c3]'], ['a', '', 'b']]);
    });

    it('deletes a column; a merged cell shrinks instead; the last column deletes the table', () => {
      const t = table(
        '<table><tbody><tr><td colspan="2">m</td><td>x</td></tr><tr><td>a</td><td>b</td><td>y</td></tr></tbody></table>',
      );
      deleteColumn(cell(t, 'b'));
      expect(shape(t)).toEqual([
        ['m', 'x'],
        ['a', 'y'],
      ]);

      const single = table('<table><tbody><tr><td>only</td></tr></tbody></table>');
      expect(deleteColumn(cell(single, 'only'))).toBeNull();
      expect(single.isConnected).toBe(false);
    });

    it('drops a row that lost its last cell', () => {
      const t = table(
        '<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>',
      );
      deleteColumn(cell(t, 'c'));
      expect(shape(t)).toEqual([['b']]);
    });
  });

  describe('grid and sizes', () => {
    it('maps merged cells onto every position they cover', () => {
      const t = table(
        '<table><tbody><tr><td colspan="2" rowspan="2">m</td><td>a</td></tr><tr><td>b</td></tr></tbody></table>',
      );
      const grid = buildGrid(t);
      expect(grid[0][0]).toBe(grid[1][1]);
      expect(grid[1][2]?.textContent).toBe('b');
      expect(describeCell(cell(t, 'b'))).toEqual({ row: 2, column: 3, rows: 2, columns: 3 });
    });

    it('counts cells including nested tables and checks the 200-cell limit', () => {
      const host = document.createElement('div');
      host.innerHTML =
        '<table><tr><td>a</td><td><table><tr><td>b</td><td>c</td></tr></table></td></tr></table>';
      expect(cellCount(host)).toBe(4);
      expect(fitsCellLimit(host, 196)).toBe(true);
      expect(fitsCellLimit(host, 197)).toBe(false);
    });

    it('deletes a table', () => {
      const t = table('<table><tbody><tr><td>a</td></tr></tbody></table>');
      deleteTable(t);
      expect(t.isConnected).toBe(false);
    });
  });
});
