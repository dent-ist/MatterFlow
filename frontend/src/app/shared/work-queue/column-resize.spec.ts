import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { AuthStore } from '../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { WORK_COLUMNS } from './column-prefs';
import { LIVE_ROW_LIMIT, resizeSide, resizedPx, useGuideLine } from './column-resize';
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

  it('puts the handle on the right edge of columns before the Title and on the left edge after it; never on the Title', () => {
    const shown = ['ref', 'title', 'matter', 'due', 'status'].map(def);
    expect(resizeSide(def('ref'), shown)).toBe('end');
    expect(resizeSide(def('title'), shown)).toBeNull();
    expect(resizeSide(def('due'), shown)).toBe('start');
    expect(resizeSide(def('status'), shown)).toBe('start');
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
        MessageService,
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

  it('renders aria-hidden handles outside the tab order, none on the Title, none in the body', async () => {
    await create();
    const keys = Array.from(el.querySelectorAll('.wt-resize')).map((h) =>
      h.getAttribute('data-resize'),
    );
    expect(keys).toEqual(['ref', 'matter', 'due', 'status']);
    for (const h of Array.from(el.querySelectorAll('.wt-resize'))) {
      expect(h.getAttribute('aria-hidden')).toBe('true');
      expect(h.hasAttribute('tabindex')).toBe(false);
      expect(h.closest('thead')).not.toBeNull();
    }
    expect(el.querySelector('tbody .wt-resize')).toBeNull();
  });

  it('drags a left-edge handle: the live width follows, the pointer travel is inverted, and release emits once', async () => {
    await create();
    expect(width('due')).toBe(`${136 / 14}rem`);
    const h = handle('due');
    fire(h, 'pointerdown', 500);
    expect(document.body.classList.contains('wt-resizing')).toBe(true);
    fire(h, 'pointermove', 480);
    expect(width('due')).toBe(`${156 / 14}rem`);
    expect(resized).toEqual([]); // nothing is stored per frame
    fire(h, 'pointermove', 470);
    fire(h, 'pointerup', 470);
    expect(resized).toEqual([{ key: 'due', rem: 166 / 14, defaultRem: undefined }]);
    expect(document.body.classList.contains('wt-resizing')).toBe(false);
  });

  it('clamps at the minimum and maximum', async () => {
    await create();
    const h = handle('due');
    fire(h, 'pointerdown', 500);
    fire(h, 'pointermove', 100);
    expect(width('due')).toBe(`${200 / 14}rem`);
    fire(h, 'pointermove', 900);
    expect(width('due')).toBe(`${120 / 14}rem`);
    fire(h, 'pointerup', 900);
    expect(resized[0].rem).toBe(120 / 14);
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
    fire(h, 'pointermove', 470);
    expect(width('due')).toBe(`${136 / 14}rem`);
    expect(document.querySelector('.wt-resize-guide')).not.toBeNull();
    fire(h, 'pointerup', 470);
    expect(document.querySelector('.wt-resize-guide')).toBeNull();
    expect(resized[0].rem).toBe(166 / 14);
  });

  it('does not start below 640 px', async () => {
    await create();
    vi.stubGlobal('innerWidth', 600);
    fire(handle('due'), 'pointerdown', 500);
    expect(document.body.classList.contains('wt-resizing')).toBe(false);
  });
});
