import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NotificationService } from '../../core/notify/notification.service';
import { NoteEditor } from './note-editor';
import { PASTE_COPY } from './note-paste';
import { EXCEL_365, WORD_365, WORD_REDLINE, bigTable } from './note-paste.fixtures';

/** The paste flow in the editor (#1411): the clean-up result goes in as one undo step, the Paste Options chip offers Keep Formatting and Paste as Plain Text, toasts and messages come from the shared table. */
describe('NoteEditor formatted paste', () => {
  // ProseMirror makes `new ClipboardEvent('paste')` for Paste as Plain Text; jsdom has no such class.
  beforeAll(() => {
    if (!('ClipboardEvent' in globalThis)) {
      (globalThis as unknown as { ClipboardEvent: typeof Event }).ClipboardEvent =
        class extends Event {} as typeof Event;
    }
  });

  async function make(
    html = '<p>Start</p>',
    editable = true,
  ): Promise<ComponentFixture<NoteEditor>> {
    const fixture = TestBed.createComponent(NoteEditor);
    fixture.componentRef.setInput('html', html);
    fixture.componentRef.setInput('contentKey', 'k1');
    fixture.componentRef.setInput('editable', editable);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  /** A paste event as the browser sends it: a cancelable event on the editable element with a `clipboardData` that answers `getData`. */
  function paste(f: ComponentFixture<NoteEditor>, flavours: Record<string, string>): Event {
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', {
      value: { getData: (t: string) => flavours[t] ?? '', files: [], types: Object.keys(flavours) },
    });
    (f.nativeElement as HTMLElement).querySelector('.ProseMirror')?.dispatchEvent(ev);
    return ev;
  }

  const chip = (f: ComponentFixture<NoteEditor>) =>
    (f.nativeElement as HTMLElement).querySelector('[data-paste-options]');
  const q = (f: ComponentFixture<NoteEditor>, sel: string) =>
    (f.nativeElement as HTMLElement).querySelector<HTMLElement>(sel);
  const editor = (f: ComponentFixture<NoteEditor>) =>
    (
      f.componentInstance as unknown as {
        editor: {
          state: { doc: unknown };
          commands: { undo(): boolean; insertContent(s: string): boolean };
        };
      }
    ).editor;

  async function settle(f: ComponentFixture<NoteEditor>) {
    await f.whenStable();
    f.detectChanges();
    await Promise.resolve();
    f.detectChanges();
  }

  afterEach(() => {
    TestBed.inject(NotificationService).toasts.set([]);
  });

  it('keeps the formatting of pasted Word text and offers Paste Options', async () => {
    const f = await make();
    const ev = paste(f, {
      'text/html': WORD_365,
      'text/plain': 'Custodian Collection Plan\nStatus',
    });
    await settle(f);
    expect(ev.defaultPrevented).toBe(true);
    const html = f.componentInstance.getHtml();
    expect(html).toContain('<h1>');
    expect(html).toContain('<strong>Status as of Monday.</strong>');
    expect(html).toContain('<table');
    expect(html).toContain('<ul>');
    expect(html).not.toMatch(/Calibri|color|<s>|mso-/);
    expect(chip(f)).not.toBeNull();
    expect(q(f, '[data-paste-live]')?.textContent?.trim()).toBe(PASTE_COPY.live);
    expect(q(f, '[data-paste-options]')?.textContent).toContain('Pasted with formatting');
  });

  it('has no toolbar button and no shortcut for it: the only way in is the chip after a paste', async () => {
    const f = await make();
    expect(q(f, '[data-editor-toolbar]')?.textContent?.toLowerCase()).not.toContain('paste');
    expect(chip(f)).toBeNull();
  });

  it('opens the menu with Keep Formatting checked and the Ctrl + Shift + V tip', async () => {
    const f = await make();
    paste(f, { 'text/html': WORD_365, 'text/plain': 'x' });
    await settle(f);
    q(f, '[data-paste-caret]')?.click();
    await settle(f);
    const menu = q(f, '[data-paste-menu]');
    expect(menu?.getAttribute('role')).toBe('menu');
    expect(q(f, '[data-paste-keep]')?.getAttribute('aria-checked')).toBe('true');
    expect(q(f, '[data-paste-plain]')?.getAttribute('aria-checked')).toBe('false');
    expect(q(f, '[data-paste-plain]')?.textContent).toContain('Paste as Plain Text');
    expect(menu?.textContent).toContain('Replaces this paste with its text only, no layout.');
    expect(menu?.textContent).toMatch(
      /Ctrl\s*\+\s*Shift\s*\+\s*V pastes as plain text from the start\./,
    );
    expect(q(f, '[data-paste-caret]')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('Paste as Plain Text takes the paste back and inserts its text only, without reading the clipboard', async () => {
    const f = await make();
    const before = f.componentInstance.getHtml();
    paste(f, { 'text/html': WORD_365, 'text/plain': 'Plan line one\nPlan line two' });
    await settle(f);
    q(f, '[data-paste-caret]')?.click();
    await settle(f);
    q(f, '[data-paste-plain]')?.click();
    await settle(f);
    const html = f.componentInstance.getHtml();
    expect(html).not.toMatch(/<h1>|<table|<ul>|<strong>/);
    expect(html).toContain('Plan line one');
    expect(html).toContain('Plan line two');
    expect(html).toContain('Start');
    expect(chip(f)).toBeNull();
    expect(q(f, '[data-paste-live]')?.textContent?.trim()).toBe(PASTE_COPY.livePlain);
    // One Undo removes the plain paste as well: back to the text before the paste.
    editor(f).commands.undo();
    expect(f.componentInstance.getHtml()).toBe(before);
  });

  it('Keep Formatting only closes the menu; the chip stays until the next edit (no timer)', async () => {
    const f = await make();
    paste(f, { 'text/html': WORD_365, 'text/plain': 'x' });
    await settle(f);
    q(f, '[data-paste-caret]')?.click();
    await settle(f);
    q(f, '[data-paste-keep]')?.click();
    await settle(f);
    expect(q(f, '[data-paste-menu]')).toBeNull();
    await new Promise((r) => setTimeout(r, 300));
    f.detectChanges();
    expect(chip(f)).not.toBeNull();
    editor(f).commands.insertContent('typing');
    await settle(f);
    expect(chip(f)).toBeNull();
  });

  it('a click elsewhere puts the chip away; a click on the chip does not', async () => {
    const f = await make();
    paste(f, { 'text/html': WORD_365, 'text/plain': 'x' });
    await settle(f);
    q(f, '[data-paste-caret]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await settle(f);
    expect(chip(f)).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await settle(f);
    expect(chip(f)).toBeNull();
  });

  it('a text-only clipboard (the browser Ctrl+Shift+V) is pasted as paragraphs with no chip', async () => {
    const f = await make('');
    paste(f, { 'text/plain': 'line one\nline two' });
    await settle(f);
    expect(f.componentInstance.getHtml()).toBe('<p>line one</p><p>line two</p>');
    expect(chip(f)).toBeNull();
  });

  it('html that is only paragraphs pastes without a chip', async () => {
    const f = await make('');
    paste(f, { 'text/html': '<div>One</div><div>Two</div>', 'text/plain': 'One\nTwo' });
    await settle(f);
    expect(f.componentInstance.getHtml()).toBe('<p>One</p><p>Two</p>');
    expect(chip(f)).toBeNull();
  });

  it('says so in a toast when tracked deletions and pictures were left out', async () => {
    const f = await make('');
    paste(f, { 'text/html': WORD_REDLINE, 'text/plain': 'x' });
    await settle(f);
    const toasts = TestBed.inject(NotificationService).toasts();
    expect(toasts.map((t) => t.summary)).toEqual([
      'Pasted without 2 images',
      'Pasted without tracked deletions',
    ]);
    expect(toasts[0].severity).toBe('info');
    expect(toasts[0].detail).toBe(PASTE_COPY.imagesDetail);
    expect(f.componentInstance.getHtml()).toContain('sixty');
    expect(f.componentInstance.getHtml()).not.toContain('thirty');
  });

  it('pastes an Excel table and drops its hidden columns', async () => {
    const f = await make('');
    paste(f, { 'text/html': EXCEL_365, 'text/plain': 'a' });
    await settle(f);
    const html = f.componentInstance.getHtml();
    expect(html).toContain('<table');
    expect(html).not.toContain('SSN-HIDDEN');
    expect(html).toContain('1,234.50');
  });

  it('refuses a table over 1,000 cells with the inline message and inserts nothing', async () => {
    const f = await make();
    const before = f.componentInstance.getHtml();
    paste(f, { 'text/html': bigTable(1240), 'text/plain': 'x' });
    await settle(f);
    expect(q(f, '[data-paste-message]')?.textContent).toBe(
      'That table has 1,240 cells; a note holds at most 1,000.',
    );
    expect(q(f, '[data-paste-message]')?.getAttribute('role')).toBe('alert');
    expect(f.componentInstance.getHtml()).toBe(before);
    expect(chip(f)).toBeNull();
    // The message goes with the next paste.
    paste(f, { 'text/plain': 'ok' });
    await settle(f);
    expect(q(f, '[data-paste-message]')).toBeNull();
  });

  it('a read-only note never pastes', async () => {
    const f = await make('<p>Locked text</p>', false);
    const ev = paste(f, { 'text/html': WORD_365, 'text/plain': 'x' });
    await settle(f);
    expect(f.componentInstance.getHtml()).not.toContain('<h1>');
    expect(chip(f)).toBeNull();
    void ev;
  });

  it('one Undo removes the whole formatted paste', async () => {
    const f = await make();
    const before = f.componentInstance.getHtml();
    paste(f, { 'text/html': WORD_365, 'text/plain': 'x' });
    await settle(f);
    expect(f.componentInstance.getHtml()).not.toBe(before);
    editor(f).commands.undo();
    expect(f.componentInstance.getHtml()).toBe(before);
  });
});
