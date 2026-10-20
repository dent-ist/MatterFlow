import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TextField } from './text-field';

@Component({
  imports: [TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-text-field
    inputId="lr-name"
    label="Name"
    help="Shown in the link menu."
    [maxLength]="50"
    [counter]="counter()"
    [(value)]="name"
  />`,
})
class Host {
  readonly counter = signal(true);
  readonly name = signal('Source');
}

describe('TextField counter (#583)', () => {
  function create() {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  }

  it('shows "n / max" under the field and names it in aria-describedby with the help', () => {
    const { el } = create();
    expect(el.querySelector('[data-char-count]')!.textContent!.trim()).toBe('6 / 50');
    const input = el.querySelector('input')!;
    expect(input.getAttribute('aria-describedby')).toBe('lr-name-help lr-name-count');
    expect(el.querySelector('#lr-name-count')).not.toBeNull();
    expect(input.getAttribute('maxlength')).toBe('50');
  });

  it('follows the typing', () => {
    const { f, el } = create();
    const input = el.querySelector('input')!;
    input.value = 'Source system';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(el.querySelector('[data-char-count]')!.textContent!.trim()).toBe('13 / 50');
  });

  it('shows no counter unless asked for (the old forms stay as they are)', () => {
    const { f, el } = create();
    f.componentInstance.counter.set(false);
    f.detectChanges();
    expect(el.querySelector('[data-char-count]')).toBeNull();
    expect(el.querySelector('input')!.getAttribute('aria-describedby')).toBe('lr-name-help');
  });
});
