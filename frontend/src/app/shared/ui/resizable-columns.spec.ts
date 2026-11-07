import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
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
      // The handle is not a Tab stop (#1245): the heading is.
      expect(hs[0].tabIndex).toBe(-1);
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

    it('tells the page the widths after a resize, and lays the table out with the stored widths again on reload (#722)', async () => {
      TestBed.configureTestingModule({
        providers: [provideFakeMe(new FakeMeApi(withPermissions('Matter.View')))],
      });
      const fixture = TestBed.createComponent(Host);
      await fixture.whenStable();
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r));
      const el = fixture.nativeElement as HTMLElement;
      const rz = fixture.debugElement
        .query(By.directive(ResizableColumns))
        .injector.get(ResizableColumns);
      const seen: Record<string, number>[] = [];
      rz.widthsChange.subscribe((w) => seen.push({ ...w }));
      el.querySelectorAll('thead th').forEach((c) => {
        (c as HTMLElement).getBoundingClientRect = () =>
          ({ width: parseFloat((c as HTMLElement).style.width) || 200 }) as DOMRect;
      });
      const [name, client] = handles(el);
      name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      expect(seen).toHaveLength(1);
      expect(seen[0]['name']).toBe(RESIZE_MIN_PX);
      expect(Object.keys(seen[0]).sort()).toEqual(['client', 'name']);

      const key = columnWidthsKey('test-grid', undefined);
      saveColumnWidths(key, { name: 321, client: 150 });
      rz.reload();
      const table = el.querySelector('table')!;
      expect((name.parentElement as HTMLElement).style.width).toBe('321px');
      expect((client.parentElement as HTMLElement).style.width).toBe('150px');
      expect(table.classList.contains('mf-rz--fixed')).toBe(true);
      expect(seen).toHaveLength(1);

      localStorage.removeItem(key);
      rz.reload();
      expect((name.parentElement as HTMLElement).style.width).toBe('');
      expect(table.classList.contains('mf-rz--fixed')).toBe(false);
    });

    it('has one Tab stop per header cell: the heading itself, never the handle (#1245)', async () => {
      const el = await start();
      const heads = Array.from(el.querySelectorAll<HTMLElement>('thead th'));
      expect(heads.map((h) => h.tabIndex)).toEqual([-1, 0, 0]);
      expect(handles(el).every((h) => h.tabIndex === -1)).toBe(true);
    });

    it('resizes from the focused heading with Shift and the arrow keys, and ignores the plain arrows (#1245)', async () => {
      const el = await start();
      el.querySelectorAll('thead th').forEach((c) => {
        (c as HTMLElement).getBoundingClientRect = () =>
          ({ width: parseFloat((c as HTMLElement).style.width) || 200 }) as DOMRect;
      });
      const th = el.querySelector<HTMLElement>('thead th[data-col="name"]')!;
      th.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(th.style.width).toBe('');
      th.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
      );
      expect(parseFloat(th.style.width)).toBe(216);
      th.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowLeft',
          shiftKey: true,
          ctrlKey: true,
          bubbles: true,
        }),
      );
      expect(parseFloat(th.style.width)).toBe(152);
      expect(loadColumnWidths(columnWidthsKey('test-grid', undefined))['name']).toBe(152);
    });

    it('never gives a width to a data-no-resize column, stored or not (#1245)', async () => {
      localStorage.setItem(
        columnWidthsKey('test-grid', undefined),
        JSON.stringify({ v: 1, w: { pick: 72, name: 300, client: 200 } }),
      );
      const el = await start();
      const pick = el.querySelector<HTMLElement>('thead th[data-no-resize]')!;
      expect(pick.style.width).toBe('');
      expect(el.querySelector<HTMLElement>('thead th[data-col="name"]')!.style.width).toBe('300px');
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
