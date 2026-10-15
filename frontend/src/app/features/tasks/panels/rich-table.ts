/**
 * Table editing for the rich text editor (decision R): building a new table and adding or removing rows and columns of an existing one,
 * also when cells are merged (`colspan`/`rowspan`), plus cell-to-cell navigation. Pure DOM functions with no Angular, loaded on demand
 * (the editor imports this file lazily) so tables cost nothing until someone uses them.
 *
 * The functions work on a grid map of the table (every logical position points at the cell that covers it), so a merged cell is counted once
 * and is stretched or shrunk instead of being duplicated.
 */
import { MAX_TABLE_CELLS } from './rich-text';

export { cellAtSelection, neighbourCell, placeCaret } from './rich-text';

export type TableCell = HTMLTableCellElement;

/** Largest table the toolbar inserts (rows and columns each). */
export const MAX_INSERT_ROWS = 8;
export const MAX_INSERT_COLUMNS = 8;

/** Marks the first cell of a table that was just inserted, so the caret can be put there; removed straight away. */
export const NEW_CELL_MARK = 'data-mf-new';

/** The HTML of an empty table, for insertion at the caret. Empty cells hold a line break so the caret can enter them. */
export function buildTableHtml(rows: number, columns: number, header: boolean): string {
  const r = clamp(rows, 1, MAX_INSERT_ROWS);
  const c = clamp(columns, 1, MAX_INSERT_COLUMNS);
  const cell = (tag: 'td' | 'th', first: boolean): string =>
    `<${tag}${tag === 'th' ? ' scope="col"' : ''}${first ? ` ${NEW_CELL_MARK}="1"` : ''}><br></${tag}>`;
  const row = (tag: 'td' | 'th', first: boolean): string =>
    `<tr>${Array.from({ length: c }, (_, i) => cell(tag, first && i === 0)).join('')}</tr>`;
  const bodyRows = header ? r - 1 : r;
  const head = header ? `<thead>${row('th', true)}</thead>` : '';
  const body =
    bodyRows > 0
      ? `<tbody>${Array.from({ length: bodyRows }, (_, i) => row('td', !header && i === 0)).join('')}</tbody>`
      : '';
  // A paragraph after the table gives the caret a place below it.
  return `<table>${head}${body}</table><p><br></p>`;
}

/** Number of cells (td and th, nested tables included) under `root`. */
export function cellCount(root: ParentNode): number {
  return root.querySelectorAll('td, th').length;
}

export function tableOf(cell: TableCell): HTMLTableElement | null {
  return cell.closest('table');
}

/** Where a cell is: 1-based row and column of its top left corner and the size of the table. */
export function describeCell(cell: TableCell): {
  row: number;
  column: number;
  rows: number;
  columns: number;
} {
  const table = tableOf(cell);
  if (!table) return { row: 1, column: 1, rows: 1, columns: 1 };
  const grid = buildGrid(table);
  const r = rowIndex(table, cell);
  const c = grid[r]?.indexOf(cell) ?? 0;
  return { row: r + 1, column: c + 1, rows: grid.length, columns: columnCount(grid) };
}

type Grid = (TableCell | null)[][];

/** The grid map of a table: `grid[row][column]` is the cell that covers that position (merged cells appear several times). */
export function buildGrid(table: HTMLTableElement): Grid {
  const rows = Array.from(table.rows);
  const grid: Grid = rows.map(() => []);
  rows.forEach((tr, r) => {
    let c = 0;
    for (const cell of Array.from(tr.cells)) {
      while (grid[r][c]) c++;
      const rowSpan = Math.min(span(cell, 'rowSpan'), rows.length - r);
      const colSpan = span(cell, 'colSpan');
      for (let i = 0; i < rowSpan; i++) {
        for (let j = 0; j < colSpan; j++) grid[r + i][c + j] = cell;
      }
      c += colSpan;
    }
  });
  return grid;
}

function columnCount(grid: Grid): number {
  return grid.reduce((max, row) => Math.max(max, row.length), 0);
}

function rowIndex(table: HTMLTableElement, cell: TableCell): number {
  return Array.from(table.rows).indexOf(cell.parentElement as HTMLTableRowElement);
}

function span(cell: TableCell, property: 'rowSpan' | 'colSpan'): number {
  const value = cell[property];
  return Number.isFinite(value) && value >= 1 ? Math.min(value, 100) : 1;
}

function setSpan(cell: TableCell, name: 'rowspan' | 'colspan', value: number): void {
  if (value > 1) cell.setAttribute(name, String(value));
  else cell.removeAttribute(name);
}

function newCell(doc: Document, header: boolean): TableCell {
  const cell = doc.createElement(header ? 'th' : 'td');
  if (header) cell.setAttribute('scope', 'col');
  cell.appendChild(doc.createElement('br'));
  return cell;
}

/** Adds a row above or below the row of `cell`; returns the new cell in the same column, or null when nothing was added. */
export function addRow(cell: TableCell, where: 'above' | 'below'): TableCell | null {
  const table = tableOf(cell);
  if (!table) return null;
  const grid = buildGrid(table);
  const r = rowIndex(table, cell);
  const column = Math.max(0, grid[r].indexOf(cell));
  const reference = table.rows[r];
  const boundary = where === 'above' ? r : r + span(cell, 'rowSpan');
  const columns = columnCount(grid);

  const row = table.ownerDocument.createElement('tr');
  const stretched = new Set<TableCell>();
  let focus: TableCell | null = null;
  const headerRow = reference.parentElement?.tagName === 'THEAD' && where === 'above';
  for (let c = 0; c < columns; c++) {
    const above = boundary > 0 ? grid[boundary - 1]?.[c] : null;
    const below = grid[boundary]?.[c];
    if (above && above === below) {
      // A merged cell crosses the new row: it grows by one row instead of getting a neighbour.
      if (!stretched.has(above)) {
        stretched.add(above);
        setSpan(above, 'rowspan', span(above, 'rowSpan') + 1);
      }
      continue;
    }
    const created = newCell(table.ownerDocument, headerRow);
    row.appendChild(created);
    if (c === column || (focus === null && c > column)) focus ??= created;
  }

  // Below a header row the new row belongs to the body.
  const headerParent = table.rows[boundary - 1]?.parentElement;
  if (where === 'below' && headerParent?.tagName === 'THEAD') {
    const body = table.tBodies[0] ?? table.appendChild(table.ownerDocument.createElement('tbody'));
    body.insertBefore(row, body.firstChild);
  } else if (where === 'above') {
    reference.parentElement?.insertBefore(row, reference);
  } else {
    const last = table.rows[boundary - 1];
    last.parentElement?.insertBefore(row, last.nextSibling);
  }
  return focus ?? (row.cells[0] as TableCell | undefined) ?? null;
}

/** Deletes the row of `cell`; the last remaining row deletes the table. Returns the cell to put the caret in (null when the table went). */
export function deleteRow(cell: TableCell): TableCell | null {
  const table = tableOf(cell);
  if (!table) return null;
  const grid = buildGrid(table);
  const r = rowIndex(table, cell);
  if (grid.length <= 1) {
    deleteTable(table);
    return null;
  }
  const column = Math.max(0, grid[r].indexOf(cell));
  const row = table.rows[r];
  const next = table.rows[r + 1] ?? null;

  const shrunk = new Set<TableCell>();
  for (let c = 0; c < grid[r].length; c++) {
    const covering = grid[r][c];
    if (!covering || shrunk.has(covering)) continue;
    shrunk.add(covering);
    if (covering.parentElement === row) {
      if (span(covering, 'rowSpan') > 1 && next) {
        // A merged cell that starts here carries on in the next row.
        setSpan(covering, 'rowspan', span(covering, 'rowSpan') - 1);
        const nextGrid = grid[r + 1];
        const before = Array.from(next.cells).find((candidate) => nextGrid.indexOf(candidate) > c);
        next.insertBefore(covering, before ?? null);
      }
    } else {
      // A merged cell from above passes through this row.
      setSpan(covering, 'rowspan', span(covering, 'rowSpan') - 1);
    }
  }

  const section = row.parentElement;
  row.remove();
  if (section && section.tagName !== 'TABLE' && section.children.length === 0) section.remove();

  const after = buildGrid(table);
  const target = after[Math.min(r, after.length - 1)];
  return target?.[Math.min(column, target.length - 1)] ?? null;
}

/** Adds a column left or right of the column of `cell`; returns the new cell in the row of `cell`. */
export function addColumn(cell: TableCell, where: 'left' | 'right'): TableCell | null {
  const table = tableOf(cell);
  if (!table) return null;
  const grid = buildGrid(table);
  const r = rowIndex(table, cell);
  const start = Math.max(0, grid[r].indexOf(cell));
  const boundary = where === 'left' ? start : start + span(cell, 'colSpan');

  const stretched = new Set<TableCell>();
  let focus: TableCell | null = null;
  grid.forEach((cells, row) => {
    const left = boundary > 0 ? cells[boundary - 1] : null;
    const right = cells[boundary];
    if (left && left === right) {
      if (!stretched.has(left)) {
        stretched.add(left);
        setSpan(left, 'colspan', span(left, 'colSpan') + 1);
      }
      return;
    }
    const tr = table.rows[row];
    const neighbour = left ?? right;
    const header =
      neighbour?.tagName === 'TH' && (neighbour.getAttribute('scope') ?? 'col') === 'col';
    const created = newCell(table.ownerDocument, header);
    // Position among the cells that start in this row.
    const before = Array.from(tr.cells).find((candidate) => cells.indexOf(candidate) >= boundary);
    tr.insertBefore(created, before ?? null);
    if (row === r) focus = created;
  });
  return focus;
}

/** Deletes the column of `cell`; the last remaining column deletes the table. Returns the cell to put the caret in. */
export function deleteColumn(cell: TableCell): TableCell | null {
  const table = tableOf(cell);
  if (!table) return null;
  const grid = buildGrid(table);
  const r = rowIndex(table, cell);
  const column = Math.max(0, grid[r].indexOf(cell));
  if (columnCount(grid) <= 1) {
    deleteTable(table);
    return null;
  }

  const handled = new Set<TableCell>();
  for (const cells of grid) {
    const covering = cells[column];
    if (!covering || handled.has(covering)) continue;
    handled.add(covering);
    if (span(covering, 'colSpan') > 1) setSpan(covering, 'colspan', span(covering, 'colSpan') - 1);
    else covering.remove();
  }
  // A row that has lost all its cells (and has none from a merge above) goes too.
  const remaining = buildGrid(table);
  Array.from(table.rows).forEach((tr, i) => {
    if (remaining[i].every((covering) => !covering)) {
      const section = tr.parentElement;
      tr.remove();
      if (section && section.tagName !== 'TABLE' && section.children.length === 0) section.remove();
    }
  });

  const after = buildGrid(table);
  const target = after[Math.min(r, after.length - 1)];
  return target?.[Math.min(column, target.length - 1)] ?? null;
}

export function deleteTable(table: HTMLTableElement): void {
  table.remove();
}

/** Whether `count` more cells fit under the per-field limit. */
export function fitsCellLimit(root: ParentNode, extra: number): boolean {
  return cellCount(root) + extra <= MAX_TABLE_CELLS;
}

function clamp(value: number, min: number, max: number): number {
  const n = Math.trunc(Number.isFinite(value) ? value : min);
  return Math.min(max, Math.max(min, n));
}
