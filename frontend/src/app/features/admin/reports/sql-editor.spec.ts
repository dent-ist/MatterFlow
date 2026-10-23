import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SqlEditor, lineCount, segmentsOf } from './sql-editor';

describe('segmentsOf', () => {
  it('cuts the text at the marks and keeps the plain parts', () => {
    const text = 'SELECT :A, :TODAY FROM t';
    const segments = segmentsOf(text, [
      { start: 7, length: 2, kind: 'param' },
      { start: 11, length: 6, kind: 'builtin' },
    ]);
    expect(segments.map((s) => [s.text, s.kind])).toEqual([
      ['SELECT ', null],
      [':A', 'param'],
      [', ', null],
      [':TODAY', 'builtin'],
      [' FROM t', null],
    ]);
    expect(segments.map((s) => s.text).join('')).toBe(text);
  });

  it('trims marks that run past the end, skips overlaps and prefers an error at the same spot', () => {
    const text = 'abcdef';
    expect(segmentsOf(text, [{ start: 4, length: 10, kind: 'error' }]).map((s) => s.text)).toEqual([
      'abcd',
      'ef',
    ]);
    const overlap = segmentsOf(text, [
      { start: 1, length: 3, kind: 'param' },
      { start: 2, length: 3, kind: 'error' },
    ]);
    expect(overlap.map((s) => s.text).join('')).toBe(text);
    const same = segmentsOf(text, [
      { start: 1, length: 2, kind: 'param' },
      { start: 1, length: 2, kind: 'error' },
    ]);
    expect(same.find((s) => s.kind)?.kind).toBe('error');
    expect(segmentsOf(text, [{ start: 99, length: 2, kind: 'param' }])).toEqual([
      { text, kind: null },
    ]);
    expect(segmentsOf('', [])).toEqual([]);
  });

  it('counts lines', () => {
    expect(lineCount('')).toBe(1);
    expect(lineCount('a\nb\nc')).toBe(3);
    expect(lineCount('a\n')).toBe(2);
  });
});

@Component({
  imports: [SqlEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-sql-editor #ed [(value)]="text" [marks]="marks" describedBy="problems" />`,
})
class Host {
  text = 'SELECT 1\nFROM t';
  marks = [{ start: 0, length: 6, kind: 'param' as const }];
  readonly editor = viewChild.required<SqlEditor>('ed');
}

describe('SqlEditor', () => {
  it('shows line numbers, a hidden highlight layer and a labelled textarea that does not trap Tab', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.ed__gutter div').length).toBe(2);
    expect(el.querySelector('[data-highlight]')?.getAttribute('aria-hidden')).toBe('true');
    const area = el.querySelector('textarea')!;
    expect(area.getAttribute('aria-label')).toBe('Query');
    expect(area.getAttribute('aria-describedby')).toBe('problems');
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    area.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(el.querySelector('mark')?.textContent).toBe('SELECT');
  });

  it('writes typing back to the model and inserts text at the cursor, replacing a selection', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const host = fixture.componentInstance;
    const area = (fixture.nativeElement as HTMLElement).querySelector('textarea')!;
    area.value = 'SELECT 2';
    area.dispatchEvent(new Event('input'));
    expect(host.text).toBe('SELECT 2');

    area.setSelectionRange(7, 8);
    host.editor().insertAtCursor('[TaskId]');
    fixture.detectChanges();
    expect(host.text).toBe('SELECT [TaskId]');
    expect(area.selectionStart).toBe(15);
  });
});
