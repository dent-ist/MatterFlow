import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WORK_COLUMNS } from './column-prefs';
import { ColumnWidthsPanel, stepWidth } from './column-widths-panel';
import { WorkWidths } from './work-widths';

describe('ColumnWidthsPanel', () => {
  let fixture: ComponentFixture<ColumnWidthsPanel>;
  let store: WorkWidths;
  let said: string[];
  const el = () => fixture.nativeElement as HTMLElement;
  const row = (key: string) => el().querySelector<HTMLElement>(`[data-width-row="${key}"]`)!;
  const input = (key: string) => row(key).querySelector<HTMLInputElement>('[data-width-input]')!;
  const click = (key: string, sel: string, init: MouseEventInit = {}) =>
    row(key)
      .querySelector<HTMLElement>(sel)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
  const due = WORK_COLUMNS.find((c) => c.key === 'due')!;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    fixture = TestBed.createComponent(ColumnWidthsPanel);
    store = TestBed.inject(WorkWidths);
    said = [];
    fixture.componentInstance.announced.subscribe((m) => said.push(m));
    fixture.componentRef.setInput('columns', ['ref', 'title', 'due', 'assignee']);
    fixture.componentRef.setInput('scope', 'taskQueue');
    fixture.componentRef.setInput('userId', 7);
    await fixture.whenStable();
  });
  afterEach(() => localStorage.clear());

  it('lists the shown columns, the Title as informational', () => {
    expect(el().querySelectorAll('[data-width-row]').length).toBe(4);
    expect(row('title').textContent).toContain('Fills the space left');
    expect(row('title').querySelector('input')).toBeNull();
    expect(input('due').value).toBe('136');
  });

  it('+ and - step 8 px, Shift steps 32 px, and each change is announced', async () => {
    for (let i = 0; i < 3; i++) {
      click('due', '[data-width-plus]');
      fixture.detectChanges();
    }
    await fixture.whenStable();
    expect(input('due').value).toBe('160');
    expect(said.at(-1)).toBe('Due column 160 pixels');
    expect(store.widths('taskQueue', 7)['due']).toBeCloseTo(160 / 14);
    click('due', '[data-width-minus]', { shiftKey: true });
    await fixture.whenStable();
    expect(input('due').value).toBe('128');
    expect(said.at(-1)).toBe('Due column 128 pixels');
  });

  it('three quick presses before the next render still step three times (the step reads the current width, not the rendered one)', async () => {
    for (let i = 0; i < 3; i++) click('due', '[data-width-plus]');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(input('due').value).toBe('160');
    expect(said.at(-1)).toBe('Due column 160 pixels');
  });

  it('clamps a typed value to the minimum or maximum and shows the clamped value', async () => {
    input('due').value = '999';
    input('due').dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(input('due').value).toBe('200');
    input('due').value = '3';
    input('due').dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(input('due').value).toBe('120');
    input('due').value = '';
    input('due').dispatchEvent(new Event('change'));
    expect(input('due').value).toBe('120');
  });

  it('Up and Down in the field step by 8', async () => {
    input('due').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await fixture.whenStable();
    expect(input('due').value).toBe('144');
  });

  it('Reset width is off until the column has a width of its own, then restores the default', async () => {
    const reset = row('due').querySelector<HTMLElement>('[data-width-reset]')!;
    expect(reset.getAttribute('aria-disabled')).toBe('true');
    click('due', '[data-width-reset]');
    expect(said).toEqual([]);
    click('due', '[data-width-plus]');
    await fixture.whenStable();
    expect(reset.getAttribute('aria-disabled')).toBeNull();
    click('due', '[data-width-reset]');
    await fixture.whenStable();
    expect(input('due').value).toBe('136');
    expect(said.at(-1)).toBe('Due column 136 pixels');
    expect(store.has('taskQueue', 7)).toBe(false);
  });

  it('stops at the limits', () => {
    expect(stepWidth(due, 200, 8)).toBe(200);
    expect(stepWidth(due, 124, -8)).toBe(120);
    expect(stepWidth(due, 136, 32)).toBe(168);
  });

  it('the Pod Work Assignee default is the wider one', async () => {
    fixture.componentRef.setInput('assignLink', true);
    await fixture.whenStable();
    expect(input('assignee').value).toBe('216');
  });
});
