import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { settle } from '../../../shared/testing/org-testing';
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

  it('offers exactly bold, italic, bulleted list, numbered list and link', async () => {
    await create();
    const labels = Array.from(el().querySelectorAll('[role=toolbar] button')).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Bold', 'Italic', 'Bulleted list', 'Numbered list', 'Link']);
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

  it('pastes as plain text only', async () => {
    await create();
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        getData: (type: string) =>
          type === 'text/plain' ? 'plain words' : '<b onclick="x()">rich</b>',
      },
    });
    area().dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(exec).toHaveBeenCalledWith('insertText', false, 'plain words');
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
