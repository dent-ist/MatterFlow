import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { WORK_COLUMNS } from './column-prefs';
import {
  ColumnAction,
  WIDTH_STEP_PX,
  columnMenuItems,
  steppedPx,
  widthMessage,
} from './column-menu-items';
import { ROW_SHORTCUTS, isShortcut } from '../layout/shortcut-registry';
import { aRow, provideClock, provideLookups } from './work-queue-testing';
import { TaskTable } from './task-table';

const def = (key: string) => WORK_COLUMNS.find((c) => c.key === key)!;
const state = { currentPx: 136, stored: false, canHide: true };
const ids = (key: string, s = state) => columnMenuItems(def(key), s).map((i) => i.id);

describe('column menu items (#207)', () => {
  it('a sortable column starts with Sort, then the width items, then Hide', () => {
    expect(ids('due')).toEqual([
      'sort-asc',
      'sort-desc',
      'widen',
      'narrow',
      'fit',
      'reset',
      'hide',
    ]);
  });

  it('a column that cannot sort has no Sort items', () => {
    expect(ids('project')).toEqual(['widen', 'narrow', 'fit', 'reset', 'hide']);
  });

  it('Ref cannot be hidden; the Title has Sort and a disabled Fit that says why, no width items', () => {
    expect(ids('ref')).not.toContain('hide');
    const title = columnMenuItems(def('title'), { ...state, currentPx: 160 });
    expect(title.map((i) => i.id)).toEqual(['sort-asc', 'sort-desc', 'fit']);
    const fit = title[2];
    expect(fit.disabled).toBe(true);
    expect(fit.hint).toBe('Fills the space left');
    expect(fit.name).toBe('Fit to content Title, Fills the space left');
  });

  it('names carry the column and start with the visible text', () => {
    for (const item of columnMenuItems(def('due'), state)) {
      expect(item.name.startsWith(item.label)).toBe(true);
      expect(item.name).toContain('Due');
    }
    expect(columnMenuItems(def('due'), state)[2].name).toBe('Widen Due');
  });

  it('disables Widen at the maximum, Narrow at the minimum and Reset while nothing is stored', () => {
    const at = (s: Partial<typeof state>, id: string) =>
      columnMenuItems(def('due'), { ...state, ...s }).find((i) => i.id === id)!.disabled;
    expect(at({ currentPx: 200 }, 'widen')).toBe(true);
    expect(at({ currentPx: 199 }, 'widen')).toBe(false);
    expect(at({ currentPx: 120 }, 'narrow')).toBe(true);
    expect(at({ currentPx: 121 }, 'narrow')).toBe(false);
    expect(at({ stored: false }, 'reset')).toBe(true);
    expect(at({ stored: true }, 'reset')).toBe(false);
  });

  it('steps by 8 px and clamps', () => {
    expect(WIDTH_STEP_PX).toBe(8);
    expect(steppedPx(def('due'), 136, 1)).toBe(144);
    expect(steppedPx(def('due'), 136, -1)).toBe(128);
    expect(steppedPx(def('due'), 196, 1)).toBe(200);
    expect(steppedPx(def('due'), 124, -1)).toBe(120);
    expect(steppedPx(def('due'), 135.6, 1)).toBe(144);
  });

  it('words the width for the live region', () => {
    expect(widthMessage(def('due'), 144)).toBe('Due column 144 pixels');
  });

  it('Menu and Shift+F10 are the shortcut, Ctrl, Alt and plain F10 are not', () => {
    const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
    expect(isShortcut('column-menu', key({ key: 'ContextMenu' }))).toBe(true);
    expect(isShortcut('column-menu', key({ key: 'F10', shiftKey: true }))).toBe(true);
    expect(isShortcut('column-menu', key({ key: 'F10' }))).toBe(false);
    expect(isShortcut('column-menu', key({ key: 'F10', shiftKey: true, ctrlKey: true }))).toBe(
      false,
    );
    expect(ROW_SHORTCUTS.find((s) => s.id === 'column-menu')?.group).toBe('work-lists');
  });
});

describe('TaskTable column menu (#207) and fit (#205)', () => {
  let el: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<TaskTable>>;
  const resized: { key: string; rem: number; defaultRem?: number }[] = [];
  const actions: ColumnAction[] = [];
  const said: string[] = [];

  async function create(widths: Record<string, number> = {}, editable = true): Promise<void> {
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
    fixture.componentRef.setInput('rows', [aRow({ taskId: 1, taskNumber: 'TSK-1' })]);
    fixture.componentRef.setInput('columns', ['ref', 'title', 'matter', 'project', 'due']);
    fixture.componentRef.setInput('colWidths', widths);
    fixture.componentRef.setInput('widthsEditable', editable);
    fixture.componentInstance.columnResized.subscribe((e) => resized.push(e));
    fixture.componentInstance.columnAction.subscribe((e) => actions.push(e));
    fixture.componentInstance.announce.subscribe((e) => said.push(e));
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const th = (key: string) =>
    el.querySelector<HTMLElement>(`thead tr:first-child th[data-col="${key}"]`)!;
  const control = (key: string) =>
    th(key).querySelector<HTMLElement>('[data-col-focus]') ?? th(key);
  const menu = () => document.querySelector<HTMLElement>('[data-column-menu]');
  const item = (id: string) => menu()!.querySelector<HTMLElement>(`[data-item="${id}"]`)!;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const openMenu = async (key: string) => {
    keydown(control(key), { key: 'F10', shiftKey: true });
    await vi.waitFor(() => expect(menu()).not.toBeNull());
    await settle();
  };
  const keydown = (target: Element, init: KeyboardEventInit) =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    );

  beforeEach(() => {
    resized.length = 0;
    actions.length = 0;
    said.length = 0;
    vi.stubGlobal('innerWidth', 1366);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelectorAll('[data-column-menu]').forEach((m) => m.remove());
  });

  it('opens on Shift+F10 on the sort button and on the Menu key, with a labelled menu; no extra tab stop on a sortable header', async () => {
    await create();
    expect(th('due').hasAttribute('tabindex')).toBe(false);
    await openMenu('due');
    expect(menu()).not.toBeNull();
    expect(menu()!.getAttribute('role')).toBe('menu');
    expect(menu()!.getAttribute('aria-label')).toBe('Due column options');
    expect(item('widen').getAttribute('aria-label')).toBe('Widen Due');
    expect(document.activeElement).toBe(item('sort-asc'));
  });

  it('a column that cannot sort is focusable only for the menu and opens it on the Menu key', async () => {
    await create();
    expect(th('project').getAttribute('tabindex')).toBe('0');
    keydown(th('project'), { key: 'ContextMenu' });
    await vi.waitFor(() => expect(menu()).not.toBeNull());
    expect(menu()).not.toBeNull();
    expect(menu()!.querySelector('[data-item="sort-asc"]')).toBeNull();
  });

  it('canHideColumns off (the Matter and Project grids): the menu has no Hide column, the rest stays', async () => {
    await create();
    fixture.componentRef.setInput('canHideColumns', false);
    await settle();
    await openMenu('due');
    expect(item('widen')).not.toBeNull();
    expect(item('sort-asc')).not.toBeNull();
    expect(menu()!.querySelector('[data-item="hide"]')).toBeNull();
  });

  it('a right click opens it and keeps the browser menu away', async () => {
    await create();
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 400,
      clientY: 60,
    });
    th('due').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(menu()).not.toBeNull());
  });

  it('Widen stores +8 px, announces it and returns focus to the header', async () => {
    await create();
    await openMenu('due');
    item('widen').click();
    await settle();
    expect(resized).toEqual([{ key: 'due', rem: 144 / 14, defaultRem: undefined }]);
    expect(said).toEqual(['Due column 144 pixels']);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(control('due'));
  });

  it('Narrow works from the stored width; a disabled item does nothing and keeps the menu open', async () => {
    await create({ due: 120 / 14 });
    await openMenu('due');
    expect(item('narrow').getAttribute('aria-disabled')).toBe('true');
    item('narrow').click();
    await settle();
    expect(resized).toEqual([]);
    expect(menu()).not.toBeNull();
    expect(item('reset').getAttribute('aria-disabled')).toBeNull();
  });

  it('Reset width, Sort and Hide go to the page as actions', async () => {
    await create({ due: 150 / 14 });
    await openMenu('due');
    item('reset').click();
    await settle();
    expect(actions).toEqual([{ kind: 'reset', key: 'due' }]);
    expect(said).toEqual(['Due column 136 pixels']);

    await openMenu('due');
    item('sort-desc').click();
    await settle();
    expect(actions[1]).toEqual({ kind: 'sort', field: 'due', dir: 'desc' });

    await openMenu('matter');
    item('hide').click();
    await settle();
    expect(actions[2]).toEqual({ kind: 'hide', key: 'matter' });
    expect(said.at(-1)).toBe('Matter Number column hidden');
  });

  it('arrow keys move through the items with wrap, Home and End', async () => {
    await create();
    await openMenu('due');
    const names = () => (document.activeElement as HTMLElement).getAttribute('data-item');
    keydown(menu()!, { key: 'ArrowDown' });
    expect(names()).toBe('sort-desc');
    keydown(menu()!, { key: 'End' });
    expect(names()).toBe('hide');
    keydown(menu()!, { key: 'ArrowDown' });
    expect(names()).toBe('sort-asc');
    keydown(menu()!, { key: 'ArrowUp' });
    expect(names()).toBe('hide');
    keydown(menu()!, { key: 'Home' });
    expect(names()).toBe('sort-asc');
  });

  it('Esc closes it and gives the header its focus back', async () => {
    await create();
    await openMenu('due');
    keydown(item('widen'), { key: 'Escape' });
    await settle();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(control('due'));
  });

  it('Tab closes it and continues from the header', async () => {
    await create();
    await openMenu('due');
    keydown(item('widen'), { key: 'Tab' });
    await settle();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(control('due'));
  });

  it('does nothing below 640 px, where the header gets no tab stop either', async () => {
    vi.stubGlobal('innerWidth', 600);
    await create();
    fixture.componentInstance['wide'].set(false);
    fixture.detectChanges();
    expect(th('project').hasAttribute('tabindex')).toBe(false);
    keydown(control('due'), { key: 'F10', shiftKey: true });
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    th('due').dispatchEvent(event);
    await settle();
    expect(menu()).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('a grid whose page stores no widths has no menu and no handles', async () => {
    await create({}, false);
    keydown(control('due'), { key: 'F10', shiftKey: true });
    await settle();
    expect(menu()).toBeNull();
    expect(el.querySelector('.wt-resize')).toBeNull();
    expect(th('project').hasAttribute('tabindex')).toBe(false);
  });

  it('a long press (touch, 500 ms) opens the menu and the release does not sort', async () => {
    await create();
    vi.useFakeTimers();
    try {
      const sorted: string[] = [];
      fixture.componentInstance.sortChange.subscribe((e) => sorted.push(e));
      const pointer = (type: string) =>
        new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 300, clientY: 50 });
      const down = pointer('pointerdown');
      Object.defineProperty(down, 'pointerType', { value: 'touch' });
      control('due').dispatchEvent(down);
      vi.advanceTimersByTime(499);
      expect(menu()).toBeNull();
      vi.advanceTimersByTime(2);
      fixture.detectChanges();
      control('due').dispatchEvent(pointer('pointerup'));
      control('due').click();
      expect(sorted).toEqual([]);
      vi.useRealTimers();
      await vi.waitFor(() => expect(menu()).not.toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it('a tap or a drag before 500 ms opens nothing and the tap still sorts', async () => {
    await create();
    vi.useFakeTimers();
    try {
      const sorted: string[] = [];
      fixture.componentInstance.sortChange.subscribe((e) => sorted.push(e));
      const down = new MouseEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 50 });
      Object.defineProperty(down, 'pointerType', { value: 'touch' });
      control('due').dispatchEvent(down);
      vi.advanceTimersByTime(200);
      control('due').dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
      control('due').click();
      vi.advanceTimersByTime(600);
      expect(sorted).toEqual(['due']);
      expect(menu()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the handle says what a double-click does', async () => {
    await create();
    expect(el.querySelector('.wt-resize')!.getAttribute('title')).toBe(
      'Double-click to fit the rows on this page',
    );
  });
});
