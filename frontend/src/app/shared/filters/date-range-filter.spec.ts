import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { ColumnDateRangeFilter, shortRange } from './date-range-filter';
import { RangeValue } from './filter-def';

describe('date range column filter', () => {
  let fixture: ComponentFixture<ColumnDateRangeFilter>;
  let emitted: RangeValue[];
  const el = (): HTMLElement => fixture.nativeElement;
  const button = () => el().querySelector<HTMLButtonElement>('button.ft-btn')!;
  const dates = () => Array.from(el().querySelectorAll<HTMLInputElement>('input.di__input'));
  const preset = (key: string) => el().querySelector<HTMLButtonElement>(`[data-preset=${key}]`)!;

  function create(inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(ColumnDateRangeFilter);
    fixture.componentRef.setInput('label', 'Due');
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    emitted = [];
    fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
    fixture.detectChanges();
  }

  function typeDate(box: HTMLInputElement, text: string) {
    box.value = text;
    box.dispatchEvent(new Event('input'));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
  }

  beforeEach(() => {
    // Thursday 15 Oct 2026, 23:30 UTC: still the 15th in Los Angeles.
    TestBed.configureTestingModule({
      providers: [
        { provide: Clock, useValue: { now: () => new Date('2026-10-15T23:30:00Z') } },
        { provide: USER_TIME_ZONE, useValue: 'America/Los_Angeles' },
      ],
    });
  });
  afterEach(() => TestBed.resetTestingModule());

  it('is a button named for its column that says Any date or the range', () => {
    create();
    expect(button().getAttribute('aria-label')).toBe('Filter by Due, Any date');
    expect(button().getAttribute('aria-haspopup')).toBe('dialog');
    fixture.componentRef.setInput('value', { from: '2026-10-01', to: '2026-10-16' });
    fixture.detectChanges();
    expect(button().textContent).toContain('Oct 1 to Oct 16');
    expect(button().hasAttribute('data-active')).toBe(true);
  });

  it('writes the year when the range is not in this year, and one-sided ranges in words', () => {
    expect(shortRange({ from: '2026-10-01', to: '2026-10-16' }, 2026)).toBe('Oct 1 to Oct 16');
    expect(shortRange({ from: '2025-12-30', to: '2026-01-02' }, 2026)).toBe(
      'Dec 30, 2025 to Jan 2',
    );
    expect(shortRange({ from: '2026-10-05', to: '' }, 2026)).toBe('From Oct 5');
    expect(shortRange({ from: '', to: '2026-10-05' }, 2026)).toBe('Until Oct 5');
    expect(shortRange({ from: '2026-10-05', to: '2026-10-05' }, 2026)).toBe('Oct 5');
  });

  it('opens a dialog with From, To and the presets', () => {
    create();
    button().click();
    fixture.detectChanges();
    const dialog = el().querySelector('mf-filter-popover')!;
    expect(dialog.getAttribute('aria-label')).toBe('Filter by Due');
    expect(dates()).toHaveLength(2);
    expect(dialog.querySelector('label[for$="-from"]')?.textContent).toContain('From');
    expect(
      Array.from(dialog.querySelectorAll('[data-preset]')).map((b) => b.textContent!.trim()),
    ).toEqual(['Today', 'This week', 'Last 7 days', 'Last 30 days', 'This month']);
  });

  it("fills both dates from a preset, in the viewer's zone, weeks starting on Monday", () => {
    create();
    button().click();
    fixture.detectChanges();
    preset('thisWeek').click();
    fixture.detectChanges();
    expect(emitted).toEqual([{ from: '2026-10-12', to: '2026-10-18' }]);
    expect(preset('thisWeek').getAttribute('aria-pressed')).toBe('true');
    preset('today').click();
    expect(emitted[1]).toEqual({ from: '2026-10-15', to: '2026-10-15' });
    preset('last7').click();
    expect(emitted[2]).toEqual({ from: '2026-10-09', to: '2026-10-15' });
  });

  it('applies a typed date when the user presses Enter, either side alone', () => {
    create();
    button().click();
    fixture.detectChanges();
    typeDate(dates()[0], '10/01/2026');
    expect(emitted).toEqual([{ from: '2026-10-01', to: '' }]);
    typeDate(dates()[1], '10/16/2026');
    expect(emitted[1]).toEqual({ from: '2026-10-01', to: '2026-10-16' });
  });

  it('does not apply a range whose From is after To, and says so', () => {
    create({ value: { from: '2026-10-01', to: '2026-10-16' } });
    button().click();
    fixture.detectChanges();
    typeDate(dates()[0], '10/20/2026');
    expect(emitted).toEqual([]);
    expect(el().querySelector('[data-range-error]')?.textContent).toContain('From is after To');
    typeDate(dates()[0], '10/02/2026');
    expect(emitted).toEqual([{ from: '2026-10-02', to: '2026-10-16' }]);
    expect(el().querySelector('[data-range-error]')).toBeNull();
  });

  it('clears the range from the panel', () => {
    create({ value: { from: '2026-10-01', to: '' } });
    button().click();
    fixture.detectChanges();
    [...el().querySelectorAll<HTMLButtonElement>('mf-filter-popover button')]
      .find((b) => b.textContent?.trim() === 'Clear')!
      .click();
    expect(emitted).toEqual([{ from: '', to: '' }]);
  });

  it('offers the presets a screen asks for and shows the group in place in the sheet', () => {
    create({ inline: true, presets: ['next7', 'thisMonth'] });
    expect(el().querySelector('button.ft-btn')).toBeNull();
    expect(
      Array.from(el().querySelectorAll('[data-preset]')).map((b) => b.textContent!.trim()),
    ).toEqual(['Next 7 days', 'This month']);
    preset('next7').click();
    expect(emitted).toEqual([{ from: '2026-10-15', to: '2026-10-21' }]);
  });
});
