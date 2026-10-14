import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DateInput, dateToIso, isoToDate } from './date-input';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateInput],
  template: `
    <mf-date-input
      inputId="due"
      label="due date"
      [isoValue]="iso()"
      (isoChange)="iso.set($event)"
      (textInvalid)="bad.set($event)"
    />
  `,
})
class Host {
  readonly iso = signal<string | null>(null);
  readonly bad = signal(false);
}

describe('mf-date-input (the shared date control)', () => {
  let fixture: ComponentFixture<Host>;
  const el = (): HTMLElement => fixture.nativeElement;
  const input = (): HTMLInputElement => el().querySelector('input[type=text]')!;

  async function type(text: string, blur = true): Promise<void> {
    input().value = text;
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    if (blur) {
      input().dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      await fixture.whenStable();
    }
  }

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('converts between yyyy-MM-dd and a local Date', () => {
    expect(dateToIso(new Date(2026, 9, 2))).toBe('2026-10-02');
    expect(isoToDate('2026-10-02')).toEqual(new Date(2026, 9, 2));
    expect(isoToDate('')).toBeNull();
    expect(isoToDate('nonsense')).toBeNull();
  });

  it('shows a format hint that the field references, and a named calendar button', () => {
    expect(el().querySelector('#due-hint')!.textContent).toContain('Oct 12, 2026');
    expect(input().getAttribute('aria-describedby')).toContain('due-hint');
    expect(el().querySelector('button')!.getAttribute('aria-label')).toBe(
      'Choose due date from a calendar',
    );
  });

  it.each([
    ['Oct 12, 2026', '2026-10-12'],
    ['10/12/2026', '2026-10-12'],
    ['10/12/26', '2026-10-12'],
    ['2026-10-12', '2026-10-12'],
    ['12 Oct 2026', '2026-10-12'],
  ])('reads %s and tidies it to the display format', async (typed, iso) => {
    await type(typed);
    expect(fixture.componentInstance.iso()).toBe(iso);
    expect(input().value).toBe('Oct 12, 2026');
    expect(el().querySelector('[role=alert]')).toBeNull();
  });

  it('does not rewrite the text while the user is typing', async () => {
    await type('10/1', false);
    expect(input().value).toBe('10/1');
    await type('10/12/2026', false);
    expect(input().value).toBe('10/12/2026');
    expect(fixture.componentInstance.iso()).toBe('2026-10-12');
  });

  it('keeps text it cannot read, says so and reports it to the host (no silent clearing)', async () => {
    await type('next tuesday');
    expect(input().value).toBe('next tuesday');
    expect(fixture.componentInstance.iso()).toBeNull();
    expect(fixture.componentInstance.bad()).toBe(true);
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(el().querySelector('[role=alert]')!.textContent).toContain('Enter a valid date');
    await type('Oct 13, 2026');
    expect(fixture.componentInstance.bad()).toBe(false);
    expect(el().querySelector('[role=alert]')).toBeNull();
  });

  it('shows a value set from outside in the display format and clears when emptied', async () => {
    fixture.componentInstance.iso.set('2026-03-04');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(input().value).toBe('Mar 4, 2026');
    await type('');
    expect(fixture.componentInstance.iso()).toBeNull();
    expect(input().value).toBe('');
  });
});
