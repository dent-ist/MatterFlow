import { TestBed } from '@angular/core/testing';
import { NoteEditor } from './note-editor';

/**
 * Regression test for MD-38 (#1054): the editor loads its text again only when `contentKey` changes. A host that feeds the typed text back through `html`
 * (the template form does) must not reset the document, or the caret jumps to the end after every letter.
 */
describe('NoteEditor content sync', () => {
  async function make(html: string, key: string) {
    const fixture = TestBed.createComponent(NoteEditor);
    fixture.componentRef.setInput('html', html);
    fixture.componentRef.setInput('contentKey', key);
    fixture.componentRef.setInput('editable', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('keeps the document when only html changes under the same key', async () => {
    const f = await make('<p>first</p>', 'k1');
    expect(f.componentInstance.getHtml()).toContain('first');
    f.componentRef.setInput('html', '<p>other</p>');
    f.detectChanges();
    await f.whenStable();
    expect(f.componentInstance.getHtml()).toContain('first');
    expect(f.componentInstance.getHtml()).not.toContain('other');
  });

  it('loads the new text when the key changes', async () => {
    const f = await make('<p>first</p>', 'k1');
    f.componentRef.setInput('html', '<p>second</p>');
    f.componentRef.setInput('contentKey', 'k2');
    f.detectChanges();
    await f.whenStable();
    expect(f.componentInstance.getHtml()).toContain('second');
  });

  it('does nothing when the editor is destroyed before the deferred token marking runs (#1328)', async () => {
    const f = await make('<p>first {{Name}}</p>', 'k1');
    f.componentRef.setInput('contentKey', 'k2');
    f.detectChanges();
    f.destroy();
    // The microtask queued by the key change runs now, against a destroyed editor and with no `CSS` global.
    const css = (globalThis as { CSS?: unknown }).CSS;
    Object.defineProperty(globalThis, 'CSS', { value: undefined, configurable: true });
    try {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      Object.defineProperty(globalThis, 'CSS', { value: css, configurable: true });
    }
    expect(true).toBe(true);
  });
});
