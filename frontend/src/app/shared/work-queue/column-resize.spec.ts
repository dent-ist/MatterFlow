import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { WORK_COLUMNS } from './column-prefs';
import { LIVE_ROW_LIMIT, dragLayout, resizeSide, resizedPx, useGuideLine } from './column-resize';
import { aRow, provideClock, provideLookups } from './work-queue-testing';
import { TaskTable } from './task-table';

const def = (key: string) => WORK_COLUMNS.find((c) => c.key === key)!;

describe('column resize rules (#204)', () => {
  it('adds the pointer travel to the width of a right-edge handle and subtracts it for a left-edge handle', () => {
    expect(resizedPx(136, 44, 'end', 120, 200)).toBe(180);
    expect(resizedPx(136, 44, 'start', 120, 200)).toBe(120); // 92 clamped to the minimum
    expect(resizedPx(136, -20, 'start', 120, 200)).toBe(156);
  });

  it('clamps to the column minimum and maximum and rounds to whole pixels', () => {
    expect(resizedPx(136, -500, 'end', 120, 200)).toBe(120);
    expect(resizedPx(136, 500, 'end', 120, 200)).toBe(200);
    expect(resizedPx(136, 10.4, 'end', 120, 200)).toBe(146);
  });

  it('puts every handle on the right edge of its own column, the Title included (DB-10, #1073)', () => {
    const shown = ['ref', 'title', 'matter', 'due', 'status'].map(def);
    for (const c of shown) expect(resizeSide(c), c.key).toBe('end');
  });

  describe('drag geometry: the divider resizes the column on its left and nothing else (DB-10, #1073)', () => {
    // A grid of 1000 px: fixed columns 600 px (Ref 100, Matter 200, Due 150, Status 150), Title 400 px (the spring).
    const base = {
      isTitle: false,
      startPx: 150,
      titlePx: 400,
      fixedPx: 600,
      minPx: 100,
      maxPx: 400,
    };

    it('widens a column after the Title by the pointer travel; the Title keeps its width, so the grid grows and scrolls', () => {
      const r = dragLayout({ ...base, dx: 40 });
      expect(r.widthPx).toBe(190);
      expect(r.titleMinPx).toBe(400);
      expect(r.tableMinPx).toBe(1040); // 640 fixed + 400 Title: the total grew by exactly the pointer travel
    });

    it('narrows it: the total shrinks by the travel (the window keeps the grid at least as wide as itself)', () => {
      const r = dragLayout({ ...base, dx: -30 });
      expect(r.widthPx).toBe(120);
      expect(r.tableMinPx).toBe(970);
    });

    it('the divider follows the pointer: the new right edge moves by exactly the travel (within the limits)', () => {
      for (const dx of [-30, 10, 99]) {
        const r = dragLayout({ ...base, dx });
        expect(r.widthPx - base.startPx).toBe(dx);
      }
    });

    it('clamps at the limits and the total follows the clamped width', () => {
      expect(dragLayout({ ...base, dx: 900 }).widthPx).toBe(400);
      expect(dragLayout({ ...base, dx: 900 }).tableMinPx).toBe(600 - 150 + 400 + 400);
      expect(dragLayout({ ...base, dx: -900 }).widthPx).toBe(100);
    });

    it('dragging the Title sets the width it keeps and leaves every other column alone', () => {
      const r = dragLayout({ ...base, isTitle: true, startPx: 400, dx: 60 });
      expect(r.titleMinPx).toBe(460);
      expect(r.tableMinPx).toBe(1060);
      expect(dragLayout({ ...base, isTitle: true, startPx: 400, dx: -900 }).titleMinPx).toBe(96);
      expect(dragLayout({ ...base, isTitle: true, startPx: 400, dx: 9000 }).titleMinPx).toBe(1600);
    });
  });

  it('uses the guide line above 100 rows or after a frame slower than 24 ms', () => {
    expect(useGuideLine(LIVE_ROW_LIMIT, 5)).toBe(false);
    expect(useGuideLine(LIVE_ROW_LIMIT + 1, 5)).toBe(true);
    expect(useGuideLine(25, 24)).toBe(false);
    expect(useGuideLine(25, 24.5)).toBe(true);
  });
});

describe('TaskTable resize handles (#204)', () => {
  let el: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<TaskTable>>;
  const resized: { key: string; rem: number; defaultRem?: number }[] = [];
  const sorted: string[] = [];

  async function create(rows = 3): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions())),
        ...provideLookups(),
        ...provideClock('2026-10-14T15:00:00Z', 'America/Chicago'),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(TaskTable);
    fixture.componentRef.setInput(
      'rows',
      Array.from({ length: rows }, (_, i) => aRow({ taskId: i + 1, taskNumber: `TSK-${i + 1}` })),
    );
    fixture.componentRef.setInput('columns', ['ref', 'title', 'matter', 'due', 'status']);
    fixture.componentInstance.columnResized.subscribe((e) => resized.push(e));
    fixture.componentInstance.sortChange.subscribe((e) => sorted.push(e));
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const handle = (key: string) =>
    el.querySelector<HTMLElement>(`.wt-resize[data-resize="${key}"]`)!;
  const table = () => el.querySelector<HTMLTableElement>('table.wt')!;
  const fire = (target: Element, type: string, x: number) =>
    target.dispatchEvent(
      new MouseEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true }),
    );
  /** The width in force: the dragged <col> while a drag runs, else the table's variable. */
  const width = (key: string) => {
    const inline = el.querySelector<HTMLElement>(`col[data-col="${key}"]`)!.style.width;
    return inline.startsWith('var(') ? table().style.getPropertyValue(`--w-${key}`) : inline;
  };

  beforeEach(() => {
    resized.length = 0;
    sorted.length = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders aria-hidden handles outside the tab order, one per column (the Title too), none in the body', async () => {
    await create();
    const keys = Array.from(el.querySelectorAll('.wt-resize')).map((h) =>
      h.getAttribute('data-resize'),
    );
    expect(keys).toEqual(['ref', 'title', 'matter', 'due', 'status']);
    for (const h of Array.from(el.querySelectorAll('.wt-resize'))) {
      expect(h.getAttribute('aria-hidden')).toBe('true');
      expect(h.hasAttribute('tabindex')).toBe(false);
      expect(h.closest('thead')).not.toBeNull();
    }
    expect(el.querySelector('tbody .wt-resize')).toBeNull();
  });

  it('drags a handle: the live width follows the pointer to the right, and release emits the Title it keeps and the column, once', async () => {
    await create();
    expect(width('due')).toBe(`${136 / 14}rem`);
    const h = handle('due');
    fire(h, 'pointerdown', 500);
    expect(document.body.classList.contains('wt-resizing')).toBe(true);
    fire(h, 'pointermove', 520);
    expect(width('due')).toBe('156px');
    expect(resized).toEqual([]); // nothing is stored per frame
    fire(h, 'pointermove', 530);
    fire(h, 'pointerup', 530);
    expect(resized.map((r) => r.key)).toEqual(['title', 'due']);
    expect(resized[1]).toEqual({ key: 'due', rem: 166 / 14, defaultRem: undefined });
    expect(document.body.classList.contains('wt-resizing')).toBe(false);
  });

  it('only the dragged column changes: the neighbours keep their widths (DB-10, #1073)', async () => {
    await create();
    const before = ['ref', 'matter', 'due', 'status'].map((k) => width(k));
    fire(handle('matter'), 'pointerdown', 300);
    fire(handle('matter'), 'pointermove', 340);
    const during = ['ref', 'matter', 'due', 'status'].map((k) => width(k));
    expect(during[0]).toBe(before[0]);
    expect(during[1]).not.toBe(before[1]);
    expect(during[2]).toBe(before[2]);
    expect(during[3]).toBe(before[3]);
    fire(handle('matter'), 'pointerup', 340);
  });

  it('the Title handle resizes the Title only and emits its width', async () => {
    await create();
    const before = ['ref', 'matter', 'due', 'status'].map((k) => width(k));
    fire(handle('title'), 'pointerdown', 300);
    fire(handle('title'), 'pointermove', 360);
    expect(['ref', 'matter', 'due', 'status'].map((k) => width(k))).toEqual(before);
    fire(handle('title'), 'pointerup', 360);
    expect(resized).toEqual([{ key: 'title', rem: 220 / 14 }]);
  });

  it('clamps at the minimum and maximum', async () => {
    await create();
    const h = handle('due');
    fire(h, 'pointerdown', 500);
    fire(h, 'pointermove', 900);
    expect(width('due')).toBe('200px');
    fire(h, 'pointermove', 100);
    expect(width('due')).toBe('120px');
    fire(h, 'pointerup', 100);
    expect(resized.at(-1)!.rem).toBe(120 / 14);
  });

  it('Escape restores the start width and stores nothing', async () => {
    await create();
    const h = handle('ref');
    const before = width('ref');
    const minBefore = table().style.minWidth;
    fire(h, 'pointerdown', 100);
    fire(h, 'pointermove', 105);
    expect(width('ref')).not.toBe(before);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(width('ref')).toBe(before);
    expect(table().style.minWidth).toBe(minBefore);
    fire(h, 'pointermove', 140);
    fire(h, 'pointerup', 140);
    expect(resized).toEqual([]);
    expect(document.body.classList.contains('wt-resizing')).toBe(false);
  });

  it('a click or a zero-travel drag changes nothing, and the handle never triggers the sort button', async () => {
    await create();
    const h = handle('due');
    fire(h, 'pointerdown', 300);
    fire(h, 'pointerup', 300);
    h.click();
    expect(resized).toEqual([]);
    expect(sorted).toEqual([]);
  });

  it('uses a guide line above 100 rows: the table is not touched until release', async () => {
    await create(LIVE_ROW_LIMIT + 1);
    const h = handle('due');
    fire(h, 'pointerdown', 500);
    fire(h, 'pointermove', 530);
    expect(width('due')).toBe(`${136 / 14}rem`);
    expect(document.querySelector('.wt-resize-guide')).not.toBeNull();
    fire(h, 'pointerup', 530);
    expect(document.querySelector('.wt-resize-guide')).toBeNull();
    expect(resized.at(-1)!.rem).toBe(166 / 14);
  });

  it('does not start below 640 px', async () => {
    await create();
    vi.stubGlobal('innerWidth', 600);
    fire(handle('due'), 'pointerdown', 500);
    expect(document.body.classList.contains('wt-resizing')).toBe(false);
  });
});
