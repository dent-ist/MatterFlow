import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  SecurityContext,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import {
  COMMENT_MAX_TEXT,
  MAX_TABLE_CELLS,
  cellAtSelection,
  htmlToText,
  neighbourCell,
  normalizeLink,
  placeCaret,
} from './rich-text';

type Command = 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList';

type TableAction =
  | 'row-above'
  | 'row-below'
  | 'row-delete'
  | 'column-left'
  | 'column-right'
  | 'column-delete'
  | 'table-delete';

type RichTools = typeof import('./rich-tools');

/**
 * A small rich-text editor for Task descriptions and comments (UX 5.5, decision R): bold, italic, bulleted and numbered lists, links and
 * tables. No library: a contenteditable area with the browser's own commands. Pasted or dropped HTML (Outlook, Word, web pages) is rebuilt
 * from a short allow-list before it is inserted, tables included; the table and paste code is a separate lazy chunk that loads on first use.
 * The HTML it produces is only a draft; the server sanitizes it again and the UI renders the sanitized result.
 *
 * Inputs: `value` (HTML, two-way), `maxLength` (plain-text characters), `label` (accessible name), `placeholder`, `disabled`.
 * Output: `submitted` (Ctrl+Enter).
 */
@Component({
  selector: 'mf-rich-text-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rte" [class.rte--disabled]="disabled()" [class.rte--invalid]="tooLong()">
      <div class="rte__bar" role="toolbar" aria-label="Formatting">
        @for (b of buttons; track b.command) {
          <button
            type="button"
            class="rte__btn"
            [attr.data-cmd]="b.command"
            [attr.aria-label]="b.label"
            [attr.aria-pressed]="active().has(b.command)"
            [title]="b.label"
            [disabled]="disabled()"
            (mousedown)="$event.preventDefault()"
            (click)="run(b.command)"
          >
            <i [class]="'pi ' + b.icon" aria-hidden="true"></i>
          </button>
        }
        <button
          type="button"
          class="rte__btn"
          data-cmd="link"
          aria-label="Link"
          title="Link"
          [attr.aria-expanded]="linkOpen()"
          [disabled]="disabled()"
          (mousedown)="$event.preventDefault()"
          (click)="openLink()"
        >
          <i class="pi pi-link" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="rte__btn"
          data-cmd="table"
          aria-label="Insert table"
          title="Insert table"
          [attr.aria-expanded]="tableOpen()"
          [disabled]="disabled()"
          (mousedown)="$event.preventDefault()"
          (click)="openTable()"
        >
          <i class="pi pi-table" aria-hidden="true"></i>
        </button>
      </div>

      @if (inTable() && !disabled()) {
        <div class="rte__tools" role="toolbar" aria-label="Table" data-table-tools>
          @for (a of tableActions; track a.action) {
            <button
              type="button"
              class="rte__tool"
              [attr.data-table-action]="a.action"
              [class.rte__tool--danger]="a.danger"
              (mousedown)="$event.preventDefault()"
              (click)="runTable(a.action)"
            >
              {{ a.label }}
            </button>
          }
        </div>
      }

      @if (tableOpen()) {
        <form class="rte__link rte__table-form" data-table-form (submit)="applyTable($event)">
          <label class="rte__link-label" [for]="tableId + '-rows'">Rows</label>
          <input
            #tableRowsInput
            class="rte__num"
            type="number"
            min="1"
            max="8"
            inputmode="numeric"
            [id]="tableId + '-rows'"
            [value]="tableRows()"
            (input)="tableRows.set(toCount($any($event.target).value))"
            (keydown.escape)="closeTable()"
          />
          <label class="rte__link-label" [for]="tableId + '-cols'">Columns</label>
          <input
            class="rte__num"
            type="number"
            min="1"
            max="8"
            inputmode="numeric"
            [id]="tableId + '-cols'"
            [value]="tableColumns()"
            (input)="tableColumns.set(toCount($any($event.target).value))"
            (keydown.escape)="closeTable()"
          />
          <label class="rte__check">
            <input
              type="checkbox"
              data-table-header
              [checked]="tableHeader()"
              (change)="tableHeader.set($any($event.target).checked)"
            />
            Header row
          </label>
          <button type="submit" class="mf-btn" data-table-insert>Insert table</button>
          <button type="button" class="mf-btn" (click)="closeTable()">Cancel</button>
          <span class="rte__hint" [id]="tableId + '-hint'">Up to 8 rows and 8 columns.</span>
          @if (tableError()) {
            <span class="rte__error" role="alert" data-table-error>{{ tableError() }}</span>
          }
        </form>
      }

      @if (linkOpen()) {
        <form class="rte__link" data-link-form (submit)="applyLink($event)">
          <label class="rte__link-label" [for]="linkId">Link address</label>
          <input
            #linkInput
            class="rte__link-input"
            type="text"
            inputmode="url"
            autocomplete="off"
            placeholder="https://example.com or mailto:name@example.com"
            [id]="linkId"
            [value]="linkText()"
            [attr.aria-invalid]="linkError() ? 'true' : null"
            [attr.aria-describedby]="linkError() ? linkId + '-error' : null"
            (input)="linkText.set($any($event.target).value); linkError.set(false)"
            (keydown.escape)="closeLink()"
          />
          <button type="submit" class="mf-btn">Add link</button>
          <button type="button" class="mf-btn" (click)="closeLink()">Cancel</button>
          @if (linkError()) {
            <span class="rte__error" role="alert" [id]="linkId + '-error'" data-link-error
              >That address can't be used as a link. Use one that starts with http://, https:// or
              mailto:, or a web address such as example.com.</span
            >
          }
        </form>
      }

      <div
        #area
        class="rte__area mf-rich"
        role="textbox"
        tabindex="0"
        aria-multiline="true"
        [attr.aria-label]="label()"
        [attr.data-placeholder]="placeholder()"
        [attr.contenteditable]="disabled() ? 'false' : 'true'"
        [class.rte__area--empty]="empty()"
        (input)="onInput()"
        (keyup)="refreshActive()"
        (mouseup)="refreshActive()"
        (paste)="onPaste($event)"
        (drop)="onDrop($event)"
        (dragstart)="internalDrag = true"
        (dragend)="internalDrag = false"
        (keydown)="onKey($event)"
      ></div>

      <span class="rte__live" role="status" aria-live="polite" data-rte-live>{{
        announcement()
      }}</span>

      <div class="rte__foot">
        <span class="rte__count" [class.rte__count--over]="tooLong()" aria-live="polite">
          @if (showCount()) {
            {{ length() }} / {{ maxLength() }}
          }
        </span>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .rte {
      position: relative;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }
    .rte:focus-within {
      outline: 2px solid var(--mf-focus, var(--mf-link));
      outline-offset: 1px;
    }
    .rte--invalid {
      border-color: var(--mf-danger);
    }
    .rte__bar {
      display: flex;
      gap: var(--mf-s1);
      padding: var(--mf-s1) var(--mf-s2);
      border-bottom: 1px solid var(--mf-border);
    }
    .rte__btn {
      min-width: 2rem;
      min-height: 2rem;
      border: 1px solid transparent;
      border-radius: var(--mf-radius);
      background: transparent;
      color: var(--mf-text);
      font: inherit;
      cursor: pointer;
    }
    .rte__btn:hover:not(:disabled),
    .rte__btn[aria-pressed='true'] {
      background: var(--mf-selected-bg);
    }
    .rte__btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .rte__link {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      padding: var(--mf-s2);
      border-bottom: 1px solid var(--mf-border);
    }
    .rte__link-label {
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    .rte__link-input {
      flex: 1 1 14rem;
      min-height: 2rem;
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    .rte__tools {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1);
      padding: var(--mf-s1) var(--mf-s2);
      border-bottom: 1px solid var(--mf-border);
      background: var(--mf-surface-alt);
    }
    .rte__tool {
      min-height: 2rem;
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      font-size: var(--mf-fs-sm);
      cursor: pointer;
    }
    .rte__tool:hover {
      background: var(--mf-selected-bg);
    }
    .rte__tool--danger {
      color: var(--mf-danger-text, var(--mf-danger));
    }
    .rte__num {
      width: 4rem;
      min-height: 2rem;
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    .rte__check {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      font-size: var(--mf-fs-sm);
    }
    .rte__hint {
      flex-basis: 100%;
      font-size: var(--mf-fs-xs);
      color: var(--mf-text-muted);
    }
    .rte__live {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .rte__error {
      flex-basis: 100%;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
    }
    .rte__area {
      position: relative;
      /* A wide table scrolls inside the area and must not count towards the width of the form around it (inline-size containment). */
      contain: inline-size;
      min-width: 0;
      min-height: 6rem;
      max-height: 20rem;
      overflow: auto;
      padding: var(--mf-s2) var(--mf-s3);
      color: var(--mf-text);
      outline: none;
      overflow-wrap: anywhere;
    }
    .rte__area--empty::before {
      content: attr(data-placeholder);
      color: var(--mf-text-muted);
      pointer-events: none;
      position: absolute;
    }
    .rte__area p {
      margin: 0 0 var(--mf-s2);
    }
    .rte__area ul,
    .rte__area ol {
      margin: 0 0 var(--mf-s2);
      padding-left: var(--mf-s5, 1.5rem);
    }
    .rte__area a {
      color: var(--mf-link);
    }
    /* The editable area is the scrolling, focusable box of a wide table (the table inside it does not scroll on its own): the keyboard can reach it. */
    :host ::ng-deep .rte__area table {
      display: table;
      width: auto;
      max-width: none;
      margin-bottom: var(--mf-s2);
      overflow: visible;
    }
    .rte__foot {
      display: flex;
      justify-content: flex-end;
      padding: 0 var(--mf-s3) var(--mf-s1);
      min-height: 1.25rem;
    }
    .rte__count {
      font-size: var(--mf-fs-xs);
      color: var(--mf-text-muted);
    }
    .rte__count--over {
      color: var(--mf-danger);
    }
  `,
})
export class RichTextEditor {
  /** The comment as HTML (two-way). */
  readonly value = model('');
  /** Plain-text character limit; the counter appears near it. */
  readonly maxLength = input(COMMENT_MAX_TEXT);
  readonly label = input('Comment');
  readonly placeholder = input('Add a comment...');
  readonly disabled = input(false);
  /** Ctrl+Enter pressed inside the editor. */
  readonly submitted = output<void>();

  protected readonly tableActions: readonly {
    action: TableAction;
    label: string;
    danger?: boolean;
  }[] = [
    { action: 'row-above', label: 'Row above' },
    { action: 'row-below', label: 'Row below' },
    { action: 'row-delete', label: 'Delete row', danger: true },
    { action: 'column-left', label: 'Column left' },
    { action: 'column-right', label: 'Column right' },
    { action: 'column-delete', label: 'Delete column', danger: true },
    { action: 'table-delete', label: 'Delete table', danger: true },
  ];

  protected readonly buttons: readonly { command: Command; label: string; icon: string }[] = [
    { command: 'bold', label: 'Bold', icon: 'pi-bold' },
    { command: 'italic', label: 'Italic', icon: 'pi-italic' },
    { command: 'insertUnorderedList', label: 'Bulleted list', icon: 'pi-list' },
    { command: 'insertOrderedList', label: 'Numbered list', icon: 'pi-sort-numeric-down' },
  ];

  private readonly sanitizer = inject(DomSanitizer);
  private readonly area = viewChild.required<ElementRef<HTMLElement>>('area');
  private readonly linkInput = viewChild<ElementRef<HTMLInputElement>>('linkInput');
  private readonly tableRowsInput = viewChild<ElementRef<HTMLInputElement>>('tableRowsInput');

  protected readonly linkId = `mf-rte-link-${Math.random().toString(36).slice(2, 8)}`;
  protected readonly active = signal<ReadonlySet<Command>>(new Set());
  protected readonly linkOpen = signal(false);
  protected readonly linkText = signal('');
  protected readonly linkError = signal(false);
  protected readonly tableId = `mf-rte-table-${Math.random().toString(36).slice(2, 8)}`;
  protected readonly tableOpen = signal(false);
  protected readonly tableRows = signal(3);
  protected readonly tableColumns = signal(3);
  protected readonly tableHeader = signal(true);
  protected readonly tableError = signal('');
  protected readonly inTable = signal(false);
  protected readonly announcement = signal('');
  /** True while a drag that started inside the editor is under way (moving text within the editor is left to the browser). */
  protected internalDrag = false;
  protected readonly length = signal(0);
  /** True while the editor holds a table: an empty table is content (it is being filled in), although it has no text yet. */
  private readonly hasTable = signal(false);
  protected readonly empty = computed(() => this.length() === 0 && !this.hasTable());
  protected readonly tooLong = computed(() => this.length() > this.maxLength());
  protected readonly showCount = computed(
    () => this.length() >= this.maxLength() * 0.8 || this.tooLong(),
  );

  private savedRange: Range | null = null;
  private tools: Promise<RichTools> | null = null;
  /** The table cell the caret was last in, so the table buttons still work while the focus is on them. */
  private lastCell: HTMLTableCellElement | null = null;
  private announced = 0;
  /** The last HTML this editor itself produced, so an echo of it from the parent does not reset the caret. */
  private lastEmitted: string | null = null;

  constructor() {
    // Push outside changes (clear after posting, an edit's starting text) into the editable area.
    effect(() => {
      const html = this.value();
      untracked(() => {
        if (html === this.lastEmitted) return;
        this.lastEmitted = html;
        this.area().nativeElement.innerHTML =
          this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
        this.length.set(this.textLength());
        this.hasTable.set(this.area().nativeElement.querySelector('td, th') !== null);
      });
    });
    effect(() => {
      if (this.linkOpen()) queueMicrotask(() => this.linkInput()?.nativeElement.focus());
    });
    effect(() => {
      if (this.tableOpen()) queueMicrotask(() => this.tableRowsInput()?.nativeElement.focus());
    });
  }

  /** Moves the caret into the editor. */
  focus(): void {
    this.area().nativeElement.focus();
  }

  protected run(command: Command): void {
    this.area().nativeElement.focus();
    this.exec(command);
    this.onInput();
  }

  protected openLink(): void {
    const selection = document.getSelection();
    const inside =
      selection &&
      selection.rangeCount > 0 &&
      this.area().nativeElement.contains(selection.anchorNode);
    this.savedRange = inside ? selection.getRangeAt(0).cloneRange() : null;
    this.linkText.set('');
    this.linkError.set(false);
    this.linkOpen.set(true);
  }

  protected closeLink(): void {
    this.linkOpen.set(false);
    this.area().nativeElement.focus();
  }

  protected applyLink(event: Event): void {
    event.preventDefault();
    const url = normalizeLink(this.linkText());
    if (!url) {
      this.linkError.set(true);
      return;
    }
    const area = this.area().nativeElement;
    area.focus();
    const selection = document.getSelection();
    if (this.savedRange && selection) {
      selection.removeAllRanges();
      selection.addRange(this.savedRange);
    }
    const hasSelection = !!selection && selection.rangeCount > 0 && !selection.isCollapsed;
    if (hasSelection) {
      this.exec('createLink', url);
    } else {
      // Nothing selected: insert the address itself as the link text, set off by spaces so it does not run into the words around it
      // ("run QChttps://..." in UAT2-11) and the caret can carry on typing after it.
      this.exec(
        'insertHTML',
        `${leadingSpace(this.savedRange)}<a href="${escapeAttribute(url)}">${escapeText(url)}</a>&nbsp;`,
      );
    }
    this.linkOpen.set(false);
    this.onInput();
  }

  protected onInput(): void {
    const html = this.area().nativeElement.innerHTML;
    this.length.set(this.textLength());
    this.hasTable.set(this.area().nativeElement.querySelector('td, th') !== null);
    this.lastEmitted = this.empty() ? '' : html;
    this.value.set(this.lastEmitted);
    this.refreshActive();
  }

  protected onPaste(event: ClipboardEvent): void {
    const data = event.clipboardData;
    const html = data?.getData('text/html') ?? '';
    const text = data?.getData('text/plain') ?? '';
    // Nothing is pasted as the browser would paste it: HTML is rebuilt from the allow-list first, plain text goes in as text.
    event.preventDefault();
    void this.insertContent(html, text);
  }

  protected onDrop(event: DragEvent): void {
    if (this.internalDrag) {
      this.internalDrag = false;
      return; // text moved inside the editor is already clean
    }
    event.preventDefault();
    const data = event.dataTransfer;
    if (!data) return;
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    if (!html && !text) return; // files and images are not accepted
    this.moveCaretToPoint(event.clientX, event.clientY);
    void this.insertContent(html, text);
  }

  protected openTable(): void {
    const selection = document.getSelection();
    const inside =
      selection &&
      selection.rangeCount > 0 &&
      this.area().nativeElement.contains(selection.anchorNode);
    this.savedRange = inside ? selection.getRangeAt(0).cloneRange() : null;
    this.tableError.set('');
    this.tableOpen.set(true);
    void this.loadTools();
  }

  protected closeTable(): void {
    this.tableOpen.set(false);
    this.area().nativeElement.focus();
  }

  protected toCount(value: string): number {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 1;
  }

  protected async applyTable(event: Event): Promise<void> {
    event.preventDefault();
    const rows = this.tableRows();
    const columns = this.tableColumns();
    const area = this.area().nativeElement;
    const tools = await this.loadTools();
    if (!tools.fitsCellLimit(area, rows * columns)) {
      this.tableError.set(`A table field can have at most ${MAX_TABLE_CELLS} table cells.`);
      return;
    }
    area.focus();
    const selection = document.getSelection();
    if (this.savedRange && selection) {
      selection.removeAllRanges();
      selection.addRange(this.savedRange);
    }
    this.insertHtml(tools.buildTableHtml(rows, columns, this.tableHeader()));
    const first = area.querySelector<HTMLElement>(`[${tools.NEW_CELL_MARK}]`);
    if (first) {
      first.removeAttribute(tools.NEW_CELL_MARK);
      placeCaret(first, document.getSelection());
    }
    this.tableOpen.set(false);
    this.onInput();
    this.announce(
      `Table inserted with ${rows} ${rows === 1 ? 'row' : 'rows'} and ${columns} ${columns === 1 ? 'column' : 'columns'}. Press Tab to move between cells.`,
    );
  }

  /** One of the table buttons: rows and columns are added or removed around the cell that holds the caret. */
  protected async runTable(action: TableAction): Promise<void> {
    const cell = this.activeCell();
    if (!cell) return;
    const tools = await this.loadTools();
    const area = this.area().nativeElement;
    const size = tools.describeCell(cell);
    const addsRow = action === 'row-above' || action === 'row-below';
    const addsColumn = action === 'column-left' || action === 'column-right';
    if ((addsRow || addsColumn) && !tools.fitsCellLimit(area, addsRow ? size.columns : size.rows)) {
      this.announce(`Not added: a field can have at most ${MAX_TABLE_CELLS} table cells.`);
      return;
    }

    let target: HTMLTableCellElement | null = null;
    let message: string;
    switch (action) {
      case 'row-above':
        target = tools.addRow(cell, 'above');
        message = 'Row added above.';
        break;
      case 'row-below':
        target = tools.addRow(cell, 'below');
        message = 'Row added below.';
        break;
      case 'row-delete':
        target = tools.deleteRow(cell);
        message = target ? 'Row deleted.' : 'The only row was deleted, so the table was removed.';
        break;
      case 'column-left':
        target = tools.addColumn(cell, 'left');
        message = 'Column added on the left.';
        break;
      case 'column-right':
        target = tools.addColumn(cell, 'right');
        message = 'Column added on the right.';
        break;
      case 'column-delete':
        target = tools.deleteColumn(cell);
        message = target
          ? 'Column deleted.'
          : 'The only column was deleted, so the table was removed.';
        break;
      default:
        tools.deleteTable(cell.closest('table') as HTMLTableElement);
        message = 'Table deleted.';
    }

    area.focus();
    if (target) {
      placeCaret(target, document.getSelection());
      const where = tools.describeCell(target);
      message += ` Now row ${where.row} of ${where.rows}, column ${where.column} of ${where.columns}.`;
    }
    this.lastCell = target;
    this.onInput();
    this.announce(message);
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.submitted.emit();
      return;
    }
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // Inside a table Tab and Shift+Tab move between cells. At the first and last cell they carry on as usual (the focus leaves the editor),
      // so the editor never traps the keyboard.
      const cell = cellAtSelection(this.area().nativeElement, document.getSelection());
      const next = cell ? neighbourCell(cell, event.shiftKey) : null;
      if (next) {
        event.preventDefault();
        placeCaret(next, document.getSelection());
        this.refreshActive();
        this.announce(
          `Row ${(next.parentElement as HTMLTableRowElement).rowIndex + 1}, column ${next.cellIndex + 1}.`,
        );
      }
    }
  }

  protected refreshActive(): void {
    const next = new Set<Command>();
    for (const b of this.buttons) {
      try {
        if (
          typeof document.queryCommandState === 'function' &&
          document.queryCommandState(b.command)
        ) {
          next.add(b.command);
        }
      } catch {
        // queryCommandState can throw when the editor has no selection; the button then shows as not pressed.
      }
    }
    this.active.set(next);

    // Moving the focus to a table button keeps the selection (and so the buttons); they go when the caret is elsewhere in the editor.
    const selection = document.getSelection();
    const inside =
      !!selection &&
      selection.rangeCount > 0 &&
      this.area().nativeElement.contains(selection.anchorNode);
    const cell = cellAtSelection(this.area().nativeElement, selection);
    if (cell) {
      this.lastCell = cell;
      this.inTable.set(true);
    } else if (inside) {
      this.inTable.set(false);
    }
  }

  private loadTools(): Promise<RichTools> {
    return (this.tools ??= import('./rich-tools'));
  }

  private activeCell(): HTMLTableCellElement | null {
    const area = this.area().nativeElement;
    const current = cellAtSelection(area, document.getSelection());
    if (current) return current;
    return this.lastCell?.isConnected && area.contains(this.lastCell) ? this.lastCell : null;
  }

  private announce(message: string): void {
    // A trailing non-breaking space makes a repeated message count as a change, so a screen reader says it again.
    this.announced += 1;
    this.announcement.set(message + (this.announced % 2 === 0 ? '\u00A0' : ''));
  }

  /** Inserts pasted or dropped content: HTML rebuilt from the allow-list, else the plain text. */
  private async insertContent(html: string, text: string): Promise<void> {
    if (html.trim().length > 0) {
      try {
        const tools = await this.loadTools();
        const cleaned = tools.cleanPastedHtml(html);
        if (cleaned.kind === 'html') {
          this.insertHtml(cleaned.html);
          this.onInput();
          if (cleaned.cells > 0) {
            this.announce(
              `Table pasted with ${cleaned.cells} ${cleaned.cells === 1 ? 'cell' : 'cells'}.`,
            );
          }
          return;
        }
        if (cleaned.reason === 'too-many-cells') {
          this.announce(
            `That table has more than ${MAX_TABLE_CELLS} cells, so it was pasted as text.`,
          );
        }
      } catch {
        // The clean-up code could not be loaded: the text below is the safe fallback.
      }
    }
    if (text.length > 0) {
      this.exec('insertText', text);
      this.onInput();
    }
  }

  /** Inserts trusted HTML (already rebuilt from the allow-list) at the caret; undo works where the browser supports `insertHTML`. */
  private insertHtml(html: string): void {
    const area = this.area().nativeElement;
    area.focus();
    if (
      typeof document.execCommand === 'function' &&
      document.execCommand('insertHTML', false, html)
    )
      return;

    const selection = document.getSelection();
    let range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!range || !area.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(area);
      range.collapse(false);
    }
    const template = document.createElement('template');
    template.innerHTML = html;
    range.deleteContents();
    range.insertNode(template.content);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  private moveCaretToPoint(x: number, y: number): void {
    const area = this.area().nativeElement;
    const doc = document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    let range: Range | null = null;
    const position = doc.caretPositionFromPoint?.(x, y);
    if (position) {
      range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
    } else {
      range = doc.caretRangeFromPoint?.(x, y) ?? null;
    }
    if (!range || !area.contains(range.startContainer)) return;
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  private textLength(): number {
    return htmlToText(this.area().nativeElement.innerHTML).trim().length;
  }

  private exec(command: string, argument?: string): void {
    if (typeof document.execCommand === 'function') document.execCommand(command, false, argument);
  }
}

/** A space to put before an inserted link when the text just before the caret does not already end in one. */
export function leadingSpace(range: Range | null): string {
  if (!range || !range.collapsed) return '';
  const node = range.startContainer;
  const before =
    node.nodeType === Node.TEXT_NODE && range.startOffset > 0
      ? (node.textContent ?? '').charAt(range.startOffset - 1)
      : '';
  return before !== '' && !/\s/.test(before) ? '&nbsp;' : '';
}

const escapeText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttribute = (value: string): string => escapeText(value).replace(/"/g, '&quot;');
