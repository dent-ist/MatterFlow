import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ColumnMultiselectFilter, FIND_BOX_FROM, MULTI_COMMIT_MS } from './multiselect-filter';
import { FilterOption } from './filter-def';

const OPTIONS: FilterOption[] = [
  { value: '1', label: 'Critical', count: 4 },
  { value: '2', label: 'High' },
  { value: '3', label: 'Normal', hint: '(default)' },
];

describe('multi-select column filter', () => {
  let fixture: ComponentFixture<ColumnMultiselectFilter>;
  let emitted: string[][];
  const el = (): HTMLElement => fixture.nativeElement;
  const button = () => el().querySelector<HTMLButtonElement>('button.ft-btn')!;
  const popover = () =>
    document.body.querySelector('mf-filter-popover') ?? el().querySelector('mf-filter-popover');
  const boxes = () => Array.from(el().querySelectorAll<HTMLInputElement>('input[type=checkbox]'));

  function create(inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(ColumnMultiselectFilter);
    fixture.componentRef.setInput('label', 'Priority');
    fixture.componentRef.setInput('options', OPTIONS);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    emitted = [];
    fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
    fixture.detectChanges();
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('is a button named for its column that says what is chosen: All, the one value, or a count', () => {
    create();
    expect(button().getAttribute('aria-label')).toBe('Filter by Priority, All');
    expect(button().getAttribute('aria-haspopup')).toBe('dialog');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(button().textContent).toContain('All');

    fixture.componentRef.setInput('value', ['2']);
    fixture.detectChanges();
    expect(button().textContent).toContain('High');
    expect(button().hasAttribute('data-active')).toBe(true);

    fixture.componentRef.setInput('value', ['1', '2']);
    fixture.detectChanges();
    expect(button().textContent).toContain('2 selected');
    expect(button().getAttribute('aria-label')).toBe('Filter by Priority, 2 selected');
  });

  it('opens a dialog named "Filter by Priority" with a checkbox group, counts and hints', () => {
    create({ value: ['1'] });
    button().click();
    fixture.detectChanges();
    expect(button().getAttribute('aria-expanded')).toBe('true');
    const dialog = el().querySelector('mf-filter-popover')!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Filter by Priority');
    expect(dialog.querySelector('[role=group]')?.getAttribute('aria-label')).toBe('Priority');
    expect(boxes().map((b) => b.checked)).toEqual([true, false, false]);
    expect(dialog.textContent).toContain('4');
    expect(dialog.textContent).toContain('(default)');
    expect(popover()).not.toBeNull();
  });

  it('applies 400 ms after the last tick, once, not per tick', () => {
    create();
    button().click();
    fixture.detectChanges();
    boxes()[0].checked = true;
    boxes()[0].dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(MULTI_COMMIT_MS - 100);
    boxes()[1].checked = true;
    boxes()[1].dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(MULTI_COMMIT_MS - 1);
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(emitted).toEqual([['1', '2']]);
  });

  it('applies at once when Done closes the panel and gives the button focus back', () => {
    create();
    button().click();
    fixture.detectChanges();
    boxes()[2].checked = true;
    boxes()[2].dispatchEvent(new Event('change'));
    [...el().querySelectorAll<HTMLButtonElement>('mf-filter-popover button')]
      .find((b) => b.textContent?.trim() === 'Done')!
      .click();
    fixture.detectChanges();
    expect(emitted).toEqual([['3']]);
    expect(el().querySelector('mf-filter-popover')).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it('closes on Esc, applies what was ticked and returns focus to the button', () => {
    create();
    button().click();
    fixture.detectChanges();
    boxes()[1].checked = true;
    boxes()[1].dispatchEvent(new Event('change'));
    el()
      .querySelector('mf-filter-popover')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el().querySelector('mf-filter-popover')).toBeNull();
    expect(emitted).toEqual([['2']]);
    expect(document.activeElement).toBe(button());
  });

  it('clears all choices from the panel', () => {
    create({ value: ['1', '2'] });
    button().click();
    fixture.detectChanges();
    [...el().querySelectorAll<HTMLButtonElement>('mf-filter-popover button')]
      .find((b) => b.textContent?.trim() === 'Clear')!
      .click();
    expect(emitted).toEqual([[]]);
  });

  it('shows a find box only above 8 options and narrows the list by what is typed', () => {
    create();
    button().click();
    fixture.detectChanges();
    expect(el().querySelector('input[type=search]')).toBeNull();
    fixture.destroy();

    const many = Array.from({ length: FIND_BOX_FROM + 2 }, (_, i) => ({
      value: String(i),
      label: i === 3 ? 'Review team' : `Pod ${i}`,
    }));
    create({ options: many, label: 'Pod' });
    button().click();
    fixture.detectChanges();
    const find = el().querySelector<HTMLInputElement>('input[type=search]')!;
    expect(find.getAttribute('aria-label')).toBe('Find in Pod');
    find.value = 'review';
    find.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(boxes()).toHaveLength(1);
    find.value = 'zzz';
    find.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el().textContent).toContain('No match');
  });

  it('follows a change of the committed value from outside (Clear filters, Back)', () => {
    create({ value: ['1'] });
    fixture.componentRef.setInput('value', []);
    fixture.detectChanges();
    expect(button().textContent).toContain('All');
  });

  it('keeps a tick made while an earlier change is still on its way back from the address', () => {
    create({ value: [] });
    button().click();
    fixture.detectChanges();
    boxes()[0].checked = true;
    boxes()[0].dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(MULTI_COMMIT_MS); // "1" is applied; the address has not answered yet
    expect(emitted).toEqual([['1']]);

    boxes()[1].checked = true;
    boxes()[1].dispatchEvent(new Event('change')); // the next tick
    fixture.componentRef.setInput('value', ['1']); // the answer to the first change arrives now
    fixture.detectChanges();
    expect(boxes().map((b) => b.checked)).toEqual([true, true, false]);

    vi.advanceTimersByTime(MULTI_COMMIT_MS);
    expect(emitted).toEqual([['1'], ['1', '2']]);
  });

  it('shows the group in place, without a button or popover, in the sheet (inline)', () => {
    create({ inline: true, value: ['2'] });
    expect(el().querySelector('button.ft-btn')).toBeNull();
    expect(el().querySelector('mf-filter-popover')).toBeNull();
    expect(boxes().map((b) => b.checked)).toEqual([false, true, false]);
    boxes()[0].checked = true;
    boxes()[0].dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(MULTI_COMMIT_MS);
    expect(emitted).toEqual([['2', '1']]);
  });

  it('can be disabled', () => {
    create({ disabled: true });
    expect(button().disabled).toBe(true);
  });
});
