import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FakeMeApi, provideFakeMe, withPermissions } from '../testing/org-testing';
import {
  RESIZE_MAX_PX,
  RESIZE_MIN_PX,
  ResizableColumns,
  clampColumnWidth,
  columnKeyOf,
  columnWidthsKey,
  loadColumnWidths,
  saveColumnWidths,
} from './resizable-columns';

@Component({
  imports: [ResizableColumns],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <table mfResizable="test-grid">
      <thead>
        <tr>
          <th data-no-resize>Pick</th>
          <th data-col="name">Name</th>
          <th mfsort="client">Client</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>x</td>
          <td>Smith v Jones</td>
          <td>Acme</td>
        </tr>
      </tbody>
    </table>
  `,
})
class Host {}

describe('resizable columns (MD-21, #1025)', () => {
  beforeEach(() => localStorage.clear());

  describe('pure rules', () => {
    it('clamps a width to the limits and whole pixels', () => {
      expect(clampColumnWidth(10)).toBe(RESIZE_MIN_PX);
      expect(clampColumnWidth(5000)).toBe(RESIZE_MAX_PX);
      expect(clampColumnWidth(150.6)).toBe(151);
      expect(clampColumnWidth(40, 32)).toBe(40);
    });

    it('keys the storage by grid and person', () => {
      expect(columnWidthsKey('matters', 7)).toBe('mf.col-widths.v1.matters.7');
      expect(columnWidthsKey('matters', null)).toBe('mf.col-widths.v1.matters.anon');
    });

    it('round-trips widths and ignores corrupt or foreign data', () => {
      const key = columnWidthsKey('t', 1);
      saveColumnWidths(key, { name: 300, client: 20 });
      expect(loadColumnWidths(key)).toEqual({ name: 300, client: RESIZE_MIN_PX });
      localStorage.setItem(key, '{not json');
      expect(loadColumnWidths(key)).toEqual({});
      localStorage.setItem(key, JSON.stringify({ v: 2, w: { name: 300 } }));
      expect(loadColumnWidths(key)).toEqual({});
      localStorage.setItem(key, JSON.stringify({ v: 1, w: { name: 'wide', x: 200 } }));
      expect(loadColumnWidths(key)).toEqual({ x: 200 });
    });

    it('never throws when storage is blocked', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(loadColumnWidths('k')).toEqual({});
      expect(() => saveColumnWidths('k', { a: 100 })).not.toThrow();
      spy.mockRestore();
      set.mockRestore();
    });

    it('names a header cell by data-col, then mfSort, then its text', () => {
      const th = (html: string) => {
        const t = document.createElement('table');
        t.innerHTML = `<thead><tr>${html}</tr></thead>`;
        return t.querySelector('th')!;
      };
      expect(columnKeyOf(th('<th data-col="a" mfsort="b">Text</th>'))).toBe('a');
      expect(columnKeyOf(th('<th mfsort="b">Text</th>'))).toBe('b');
      expect(columnKeyOf(th('<th> Some Text </th>'))).toBe('some text');
    });
  });

  describe('the directive', () => {
    async function start() {
      TestBed.configureTestingModule({
        providers: [provideFakeMe(new FakeMeApi(withPermissions('Matter.View')))],
      });
      const fixture = TestBed.createComponent(Host);
      await fixture.whenStable();
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r));
      return fixture.nativeElement as HTMLElement;
    }
    const handles = (el: HTMLElement) =>
      Array.from(el.querySelectorAll<HTMLElement>('thead th > .mf-resize'));

    it('adds an accessible handle to every header cell that is not opted out', async () => {
      const el = await start();
      const hs = handles(el);
      expect(hs.length).toBe(2);
      expect(hs[0].getAttribute('role')).toBe('separator');
      expect(hs[0].getAttribute('aria-orientation')).toBe('vertical');
      expect(hs[0].getAttribute('aria-label')).toBe('Resize Name column');
      expect(hs[0].tabIndex).toBe(0);
      expect(hs[0].getAttribute('aria-valuemin')).toBe(String(RESIZE_MIN_PX));
      expect(hs[0].hasAttribute('aria-valuenow')).toBe(true);
      expect(el.querySelector('thead th[data-no-resize] > .mf-resize')).toBeNull();
    });

    it('resizes with the arrow keys, remembers the width and keeps the table layout fixed from then on', async () => {
      const el = await start();
      const table = el.querySelector('table')!;
      expect(table.classList.contains('mf-rz--fixed')).toBe(false);
      // jsdom has no layout: a header cell is as wide as its style says (200 px before anything is set).
      el.querySelectorAll('thead th').forEach((c) => {
        (c as HTMLElement).getBoundingClientRect = () =>
          ({ width: parseFloat((c as HTMLElement).style.width) || 200 }) as DOMRect;
      });
      const [name] = handles(el);
      const th = name.parentElement as HTMLTableCellElement;
      name.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(table.classList.contains('mf-rz--fixed')).toBe(true);
      const w1 = parseFloat(th.style.width);
      name.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
      );
      expect(parseFloat(th.style.width)).toBe(w1 + 64);
      name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      expect(parseFloat(th.style.width)).toBe(RESIZE_MIN_PX);
      const stored = loadColumnWidths(columnWidthsKey('test-grid', undefined));
      expect(stored['name']).toBe(RESIZE_MIN_PX);
    });

    it('does not let an arrow key reach the sort button or the row navigation', async () => {
      const el = await start();
      const [name] = handles(el);
      const seen = vi.fn();
      el.addEventListener('keydown', seen);
      name.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      expect(seen).not.toHaveBeenCalled();
    });
  });
});
