import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ColumnMove, ReorderColumns } from './reorder-columns';

@Component({
  imports: [ReorderColumns],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <table mfReorder (columnMove)="moves.push($event)">
      <thead>
        <tr>
          <th data-col="a" data-no-reorder>A</th>
          <th data-col="b">B</th>
          <th data-col="c">C</th>
          <th data-col="d">D</th>
        </tr>
      </thead>
    </table>
  `,
})
class Host {
  readonly moves: ColumnMove[] = [];
}

describe('ReorderColumns (MD-28, #1032)', () => {
  async function start() {
    const f = TestBed.createComponent(Host);
    await f.whenStable();
    await new Promise((r) => setTimeout(r));
    return f;
  }
  const th = (f: { nativeElement: HTMLElement }, k: string) =>
    f.nativeElement.querySelector<HTMLElement>(`th[data-col="${k}"]`)!;
  const drag = (el: HTMLElement, type: string, x = 0) => {
    const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(e, 'clientX', { value: x });
    Object.defineProperty(e, 'dataTransfer', { value: null });
    el.dispatchEvent(e);
    return e;
  };

  it('makes the headers draggable except the opted-out ones', async () => {
    const f = await start();
    expect(th(f, 'a').draggable).toBe(false);
    expect(th(f, 'b').draggable).toBe(true);
  });

  it('reports a drop on the left half as "before that column" and on the right half as "before its next column"', async () => {
    const f = await start();
    th(f, 'd').getBoundingClientRect = () => ({ left: 100, width: 100 }) as DOMRect;
    th(f, 'c').getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    drag(th(f, 'b'), 'dragstart');
    drag(th(f, 'd'), 'dragover', 110);
    expect(th(f, 'd').classList.contains('mf-drop-start')).toBe(true);
    drag(th(f, 'd'), 'drop', 110);
    expect(f.componentInstance.moves.at(-1)).toEqual({ key: 'b', beforeKey: 'd' });
    drag(th(f, 'b'), 'dragstart');
    drag(th(f, 'd'), 'drop', 190);
    expect(f.componentInstance.moves.at(-1)).toEqual({ key: 'b', beforeKey: null });
  });

  it('accepts no drop on an opted-out header and nothing without a drag', async () => {
    const f = await start();
    drag(th(f, 'a'), 'drop');
    drag(th(f, 'c'), 'drop');
    expect(f.componentInstance.moves).toEqual([]);
    drag(th(f, 'b'), 'dragstart');
    drag(th(f, 'a'), 'drop');
    expect(f.componentInstance.moves).toEqual([]);
  });
});
