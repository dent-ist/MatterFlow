import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { settle } from '../../../shared/testing/org-testing';
import { placeCaret } from './rich-text';
import { RichTextEditor, leadingSpace } from './rich-text-editor';

@Component({
  selector: 'mf-editor-host',
  imports: [RichTextEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-rich-text-editor
    [(value)]="html"
    [maxLength]="max()"
    [disabled]="disabled()"
    (submitted)="submits = submits + 1"
  />`,
})
class Host {
  readonly html = signal('');
  readonly max = signal(100);
  readonly disabled = signal(false);
  submits = 0;
}

describe('RichTextEditor', () => {
  let fixture: ComponentFixture<Host>;
  let exec: ReturnType<typeof vi.fn>;
  const el = (): HTMLElement => fixture.nativeElement;
  const area = (): HTMLElement => el().querySelector<HTMLElement>('[role=textbox]')!;
  const button = (cmd: string): HTMLButtonElement => el().querySelector(`[data-cmd=${cmd}]`)!;

  async function create(): Promise<void> {
    // jsdom has no editing commands: record the calls instead.
    exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      value: exec,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, 'queryCommandState', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
      writable: true,
    });
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(Host);
    await settle(fixture);
  }

  function type(html: string): void {
    area().innerHTML = html;
    area().dispatchEvent(new Event('input'));
  }

  it('offers exactly bold, italic, bulleted list, numbered list, link and table', async () => {
    await create();
    const labels = Array.from(el().querySelectorAll('[role=toolbar] button')).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toEqual([
      'Bold',
      'Italic',
      'Bulleted list',
      'Numbered list',
      'Link',
      'Insert table',
    ]);
    expect(el().querySelector('[role=toolbar]')?.getAttribute('aria-label')).toBe('Formatting');
  });

  it('reports what is typed as HTML and empty as an empty string', async () => {
    await create();

    type('<p>Hello <b>world</b></p>');
    await settle(fixture);
    expect(fixture.componentInstance.html()).toBe('<p>Hello <b>world</b></p>');

    type('');
    await settle(fixture);
    expect(fixture.componentInstance.html()).toBe('');
    type('<br>');
    await settle(fixture);
    expect(fixture.componentInstance.html()).toBe('');
  });

  it('shows an externally set value and clears when the host clears it', async () => {
    await create();
    fixture.componentInstance.html.set('<p>Edit me</p>');
    await settle(fixture);
    expect(area().innerHTML).toBe('<p>Edit me</p>');

    fixture.componentInstance.html.set('');
    await settle(fixture);
    expect(area().innerHTML).toBe('');
  });

  it('never puts script or event handlers from the value into the editable area', async () => {
    await create();
    fixture.componentInstance.html.set(
      '<p onclick="x()">a</p><script>alert(1)</script><img src=x onerror=y()>',
    );
    await settle(fixture);
    expect(area().innerHTML).not.toContain('<script');
    expect(area().innerHTML).not.toContain('onclick');
    expect(area().innerHTML).not.toContain('onerror');
    expect(area().textContent).toContain('a');
  });

  it('runs the browser commands for the toolbar buttons', async () => {
    await create();
    button('bold').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button('italic').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button('insertUnorderedList').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button('insertOrderedList').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(exec.mock.calls.map((c) => c[0])).toEqual([
      'bold',
      'italic',
      'insertUnorderedList',
      'insertOrderedList',
    ]);
  });

  it('keeps the selection when a toolbar button is pressed (mousedown is cancelled)', async () => {
    await create();
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button('bold').dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  /** exec that really inserts HTML at the end of the editor, like the browser does at the caret. */
  function insertingExec(): void {
    exec.mockImplementation((command: string, _ui: boolean, argument?: string) => {
      if (command === 'insertHTML') area().insertAdjacentHTML('beforeend', argument ?? '');
      if (command === 'insertText') area().append(document.createTextNode(argument ?? ''));
      return true;
    });
  }

  function clipboard(types: Record<string, string>): ClipboardEvent {
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: (type: string) => types[type] ?? '' },
    });
    return paste;
  }

  const live = (): string => {
    fixture.detectChanges();
    return el().querySelector('[data-rte-live]')!.textContent!.trim();
  };

  it('pastes plain text as text', async () => {
    await create();
    const paste = clipboard({ 'text/plain': 'plain words' });
    area().dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(exec).toHaveBeenCalledWith('insertText', false, 'plain words');
  });

  it('pastes HTML rebuilt from the allow-list: an Outlook table keeps its structure and loses its styles', async () => {
    await create();
    insertingExec();
    const paste = clipboard({
      'text/plain': 'Name\tQty',
      'text/html':
        '<table class=MsoTableGrid style="border:1px"><tr><td style="x"><p class=MsoNormal><b>Name</b><o:p></o:p></p></td><td colspan=2>Qty</td></tr></table>',
    });
    area().dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);

    await vi.waitFor(() => expect(fixture.componentInstance.html()).toContain('<table>'));
    expect(fixture.componentInstance.html()).toBe(
      '<table><tbody><tr><td><p><b>Name</b></p></td><td colspan="2">Qty</td></tr></tbody></table>',
    );
    await settle(fixture);
    expect(live()).toBe('Table pasted with 2 cells.');
  });

  it('neutralises a hostile paste: scripts, handlers, images, forms and javascript links never reach the editor', async () => {
    await create();
    insertingExec();
    area().dispatchEvent(
      clipboard({
        'text/plain': 'x',
        'text/html':
          '<p onclick="alert(1)">Hi<script>alert(2)</script><img src=x onerror=alert(3)></p><a href="javascript:alert(4)">j</a><form><input></form><table><tr><td onmouseover="alert(5)">c</td></tr></table>',
      }),
    );

    await vi.waitFor(() => expect(fixture.componentInstance.html()).toContain('Hi'));
    const html = fixture.componentInstance.html();
    for (const bad of [
      'script',
      'onclick',
      'onerror',
      'onmouseover',
      'javascript:',
      '<img',
      '<form',
      '<input',
    ]) {
      expect(html).not.toContain(bad);
    }
    expect(html).toContain('<td>c</td>');
  });

  it('pastes the text instead when the table has more than 200 cells', async () => {
    await create();
    insertingExec();
    area().dispatchEvent(
      clipboard({
        'text/plain': 'too many cells',
        'text/html': `<table><tr>${'<td>x</td>'.repeat(201)}</tr></table>`,
      }),
    );

    await vi.waitFor(() =>
      expect(exec).toHaveBeenCalledWith('insertText', false, 'too many cells'),
    );
    expect(area().querySelector('table')).toBeNull();
    expect(live()).toContain('more than 200 cells');
  });

  it('handles a dropped selection like a paste, and ignores dropped files', async () => {
    await create();
    insertingExec();
    const drop = (types: Record<string, string>): DragEvent => {
      const e = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
      Object.defineProperty(e, 'dataTransfer', {
        value: { getData: (t: string) => types[t] ?? '' },
      });
      return e;
    };

    const hostile = drop({
      'text/html': '<p>dropped</p><img src=x onerror=alert(1)>',
      'text/plain': 'dropped',
    });
    area().dispatchEvent(hostile);
    expect(hostile.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(fixture.componentInstance.html()).toBe('<p>dropped</p>'));

    const file = drop({});
    area().dispatchEvent(file);
    expect(file.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.html()).toBe('<p>dropped</p>');
  });

  it('leaves a drag that started inside the editor to the browser', async () => {
    await create();
    area().dispatchEvent(new Event('dragstart', { bubbles: true }));
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    area().dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(false);
  });

  describe('tables', () => {
    const tableHtml =
      '<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>';

    function caretIn(text: string): HTMLTableCellElement {
      const cell = Array.from(area().querySelectorAll('td, th')).find(
        (c) => c.textContent === text,
      ) as HTMLTableCellElement;
      placeCaret(cell, document.getSelection());
      area().dispatchEvent(new Event('keyup', { bubbles: true }));
      return cell;
    }

    const tool = (name: string): HTMLButtonElement =>
      el().querySelector(`[data-table-action=${name}]`)!;

    it('inserts a table of the chosen size from the toolbar, with a header row, and puts the caret in its first cell', async () => {
      await create();
      insertingExec();
      button('table').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle(fixture);
      const form = el().querySelector<HTMLFormElement>('[data-table-form]')!;
      expect(button('table').getAttribute('aria-expanded')).toBe('true');
      const [rows, columns] = Array.from(
        form.querySelectorAll<HTMLInputElement>('input[type=number]'),
      );
      rows.value = '2';
      rows.dispatchEvent(new Event('input'));
      columns.value = '3';
      columns.dispatchEvent(new Event('input'));
      form.dispatchEvent(new Event('submit', { cancelable: true }));

      await vi.waitFor(() => expect(area().querySelector('table')).not.toBeNull());
      expect(area().querySelectorAll('th[scope=col]').length).toBe(3);
      expect(area().querySelectorAll('tbody td').length).toBe(3);
      expect(area().innerHTML).not.toContain('data-mf-new');
      expect(document.getSelection()!.anchorNode).toBe(area().querySelector('th'));
      expect(fixture.componentInstance.html()).toContain('<table>');
      await settle(fixture);
      expect(live()).toContain('Table inserted with 2 rows and 3 columns');
      expect(el().querySelector('[data-table-form]')).toBeNull();
    });

    it('offers 1 to 8 rows and columns and refuses a table that would pass 200 cells', async () => {
      await create();
      insertingExec();
      type('<table><tr>' + '<td>x</td>'.repeat(190) + '</tr></table>');
      button('table').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle(fixture);
      const form = el().querySelector<HTMLFormElement>('[data-table-form]')!;
      const [rows, columns] = Array.from(
        form.querySelectorAll<HTMLInputElement>('input[type=number]'),
      );
      expect(rows.min).toBe('1');
      expect(rows.max).toBe('8');
      expect(columns.max).toBe('8');
      rows.value = '8';
      rows.dispatchEvent(new Event('input'));
      columns.value = '9';
      columns.dispatchEvent(new Event('input'));
      form.dispatchEvent(new Event('submit', { cancelable: true }));

      await vi.waitFor(() => expect(el().querySelector('[data-table-error]')).not.toBeNull());
      expect(el().querySelector('[data-table-error]')!.textContent).toContain('at most 200');
      expect(area().querySelectorAll('table').length).toBe(1);
    });

    it('shows table buttons only while the caret is in a table', async () => {
      await create();
      type(`<p>text</p>${tableHtml}`);
      await settle(fixture);
      expect(el().querySelector('[data-table-tools]')).toBeNull();

      caretIn('a');
      await settle(fixture);
      expect(el().querySelector('[data-table-tools]')).not.toBeNull();
      expect(el().querySelector('[data-table-tools]')?.getAttribute('aria-label')).toBe('Table');
      expect(
        Array.from(el().querySelectorAll('[data-table-tools] button')).map((b) =>
          b.textContent!.trim(),
        ),
      ).toEqual([
        'Row above',
        'Row below',
        'Delete row',
        'Column left',
        'Column right',
        'Delete column',
        'Delete table',
      ]);

      placeCaret(area().querySelector('p')!, document.getSelection());
      area().dispatchEvent(new Event('keyup', { bubbles: true }));
      await settle(fixture);
      expect(el().querySelector('[data-table-tools]')).toBeNull();
    });

    it('adds and removes rows and columns around the caret, reports the change and keeps the value in step', async () => {
      await create();
      type(tableHtml);
      caretIn('a');
      await settle(fixture);

      tool('row-below').click();
      await vi.waitFor(() => expect(area().querySelectorAll('tr').length).toBe(3));
      expect(live()).toContain('Row added below.');
      expect(fixture.componentInstance.html().match(/<tr>/g)?.length).toBe(3);

      tool('column-right').click();
      await vi.waitFor(() => expect(area().querySelectorAll('tr:first-child td').length).toBe(3));
      expect(live()).toContain('Column added on the right.');

      tool('column-delete').click();
      await vi.waitFor(() => expect(area().querySelectorAll('tr:first-child td').length).toBe(2));
      tool('row-delete').click();
      await vi.waitFor(() => expect(area().querySelectorAll('tr').length).toBe(2));
      expect(live()).toContain('Row deleted.');
      expect(live()).toContain('Now row');
    });

    it('deletes the table', async () => {
      await create();
      type(`<p>keep</p>${tableHtml}`);
      caretIn('d');
      await settle(fixture);
      tool('table-delete').click();
      await vi.waitFor(() => expect(area().querySelector('table')).toBeNull());
      expect(fixture.componentInstance.html()).toBe('<p>keep</p>');
      expect(live()).toBe('Table deleted.');
    });

    it('does not add past 200 cells', async () => {
      await create();
      type('<table><tr>' + '<td>x</td>'.repeat(200) + '</tr></table>');
      caretIn('x');
      await settle(fixture);
      tool('row-below').click();
      await vi.waitFor(() => expect(live()).toContain('at most 200'));
      expect(area().querySelectorAll('tr').length).toBe(1);
    });

    it('moves between cells with Tab and Shift+Tab and lets Tab leave the editor at the ends', async () => {
      await create();
      type(tableHtml);
      const key = (shift = false): KeyboardEvent => {
        const e = new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: shift,
          bubbles: true,
          cancelable: true,
        });
        area().dispatchEvent(e);
        return e;
      };

      caretIn('a');
      expect(key().defaultPrevented).toBe(true);
      expect(document.getSelection()!.anchorNode).toBe(area().querySelectorAll('td')[1]);
      expect(live()).toBe('Row 1, column 2.');

      expect(key().defaultPrevented).toBe(true);
      expect(live()).toBe('Row 2, column 1.');
      expect(key(true).defaultPrevented).toBe(true);
      expect(live()).toBe('Row 1, column 2.');

      caretIn('d');
      expect(key().defaultPrevented).toBe(false); // last cell: the focus leaves, no keyboard trap
      caretIn('a');
      expect(key(true).defaultPrevented).toBe(false); // first cell
    });

    it('does not capture Tab outside a table or with a modifier', async () => {
      await create();
      type(`<p>text</p>${tableHtml}`);
      placeCaret(area().querySelector('p')!, document.getSelection());
      const plain = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      area().dispatchEvent(plain);
      expect(plain.defaultPrevented).toBe(false);

      caretIn('a');
      const withCtrl = new KeyboardEvent('keydown', {
        key: 'Tab',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      area().dispatchEvent(withCtrl);
      expect(withCtrl.defaultPrevented).toBe(false);
    });

    it('has no table buttons while disabled', async () => {
      await create();
      type(tableHtml);
      caretIn('a');
      await settle(fixture);
      fixture.componentInstance.disabled.set(true);
      await settle(fixture);
      expect(el().querySelector('[data-table-tools]')).toBeNull();
      expect(button('table').disabled).toBe(true);
    });
  });

  it('posts on Ctrl+Enter', async () => {
    await create();
    area().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    area().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fixture.componentInstance.submits).toBe(1);
  });

  it('adds a link only for http(s) or mailto addresses', async () => {
    await create();
    button('link').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(fixture);
    const form = el().querySelector<HTMLFormElement>('[data-link-form]')!;
    const input = form.querySelector<HTMLInputElement>('input')!;

    input.value = 'javascript:alert(1)';
    input.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    expect(el().querySelector('[data-link-error]')?.textContent).toContain(
      "can't be used as a link",
    );
    expect(input.getAttribute('aria-describedby')).toBe(
      el().querySelector('[data-link-error]')!.id,
    );
    expect(exec).not.toHaveBeenCalledWith('createLink', false, expect.anything());
    expect(exec).not.toHaveBeenCalledWith('insertHTML', false, expect.anything());

    input.value = 'example.com/doc';
    input.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    // Nothing is selected, so the address itself becomes the link text.
    expect(exec).toHaveBeenCalledWith(
      'insertHTML',
      false,
      '<a href="https://example.com/doc">https://example.com/doc</a>&nbsp;',
    );
    expect(el().querySelector('[data-link-form]')).toBeNull();
  });

  it('shows a counter near the limit and marks it when over', async () => {
    await create();
    expect(el().querySelector('.rte__count')?.textContent?.trim()).toBe('');

    type('<p>' + 'a'.repeat(85) + '</p>');
    await settle(fixture);
    expect(el().querySelector('.rte__count')?.textContent?.trim()).toBe('85 / 100');

    type('<p>' + 'a'.repeat(101) + '</p>');
    await settle(fixture);
    expect(el().querySelector('.rte__count--over')).not.toBeNull();
  });

  it('is not editable while disabled', async () => {
    await create();
    fixture.componentInstance.disabled.set(true);
    await settle(fixture);
    expect(area().getAttribute('contenteditable')).toBe('false');
    expect(button('bold').disabled).toBe(true);
  });

  it('puts a space before an inserted link that would touch the word before it (UAT2-11)', () => {
    const host = document.createElement('p');
    host.textContent = 'run QC';
    const range = document.createRange();
    range.setStart(host.firstChild!, 6);
    expect(leadingSpace(range)).toBe('&nbsp;');
    range.setStart(host.firstChild!, 5);
    range.collapse(true);
    expect(leadingSpace(range)).toBe('&nbsp;');
    range.setStart(host.firstChild!, 4);
    range.collapse(true);
    expect(leadingSpace(range)).toBe('');
    host.textContent = 'run QC ';
    range.setStart(host.firstChild!, 7);
    range.collapse(true);
    expect(leadingSpace(range)).toBe('');
    expect(leadingSpace(null)).toBe('');
  });
});
