import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SEARCH_DEBOUNCE_MS } from '../ui/search-box';
import { RangeValue } from './filter-def';
import { ColumnNumberRangeFilter } from './number-range-filter';

describe('number range column filter', () => {
  let fixture: ComponentFixture<ColumnNumberRangeFilter>;
  let emitted: RangeValue[];
  const el = (): HTMLElement => fixture.nativeElement;
  const button = () => el().querySelector<HTMLButtonElement>('button.ft-btn')!;
  const boxes = () =>
    Array.from(el().querySelectorAll<HTMLInputElement>('mf-filter-popover input, .nr input'));

  function create(inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(ColumnNumberRangeFilter);
    fixture.componentRef.setInput('label', 'Age');
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    emitted = [];
    fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
    fixture.detectChanges();
  }

  function type(box: HTMLInputElement, text: string) {
    box.value = text;
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('is a button that says Any, "3 to 10", "3 or more" or "10 or less"', () => {
    create();
    expect(button().getAttribute('aria-label')).toBe('Filter by Age, Any');
    for (const [value, text] of [
      [{ from: '3', to: '10' }, '3 to 10'],
      [{ from: '3', to: '' }, '3 or more'],
      [{ from: '', to: '10' }, '10 or less'],
    ] as const) {
      fixture.componentRef.setInput('value', value);
      fixture.detectChanges();
      expect(button().textContent).toContain(text);
    }
  });

  it('applies 300 ms after the last key and at once on Enter', () => {
    create();
    button().click();
    fixture.detectChanges();
    type(boxes()[0], '3');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(emitted).toEqual([{ from: '3', to: '' }]);

    type(boxes()[1], '10');
    boxes()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(emitted[1]).toEqual({ from: '3', to: '10' });
  });

  it('rejects text that is not a whole number and a Min above Max, without applying', () => {
    create();
    button().click();
    fixture.detectChanges();
    type(boxes()[0], 'abc');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(emitted).toEqual([]);
    expect(el().querySelector('[data-number-error]')?.textContent).toContain('whole numbers');
    expect(boxes()[0].getAttribute('aria-invalid')).toBe('true');

    type(boxes()[0], '20');
    type(boxes()[1], '5');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(emitted).toEqual([]);
    expect(el().querySelector('[data-range-error]')?.textContent).toContain('Min is above Max');
  });

  it('clears from the panel and follows the committed value', () => {
    create({ value: { from: '2', to: '' } });
    button().click();
    fixture.detectChanges();
    expect(boxes()[0].value).toBe('2');
    [...el().querySelectorAll<HTMLButtonElement>('mf-filter-popover button')]
      .find((b) => b.textContent?.trim() === 'Clear')!
      .click();
    expect(emitted).toEqual([{ from: '', to: '' }]);
  });

  it('shows the two boxes in place in the sheet', () => {
    create({ inline: true });
    expect(el().querySelector('button.ft-btn')).toBeNull();
    expect(boxes()).toHaveLength(2);
    expect(boxes()[0].getAttribute('aria-label')).toBe('Age minimum');
  });
});
