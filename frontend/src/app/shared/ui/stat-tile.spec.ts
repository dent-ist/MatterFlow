import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StatTile } from './stat-tile';

@Component({
  imports: [StatTile],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-stat-tile
      [value]="value()"
      [unit]="unit()"
      [label]="label()"
      [note]="note()"
      [muted]="muted()"
      [pressable]="pressable()"
      [pressed]="pressed()"
      (pick)="picks.set(picks() + 1)"
    />
  `,
})
class Host {
  value = signal('1,234');
  unit = signal('');
  label = signal('Total assets');
  note = signal('');
  muted = signal(false);
  pressable = signal(false);
  pressed = signal(false);
  picks = signal(0);
}

describe('StatTile', () => {
  let fixture: ComponentFixture<Host>;
  const el = (): HTMLElement => fixture.nativeElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('is a labelled group whose name starts with the value, the unit said once', () => {
    const group = el().querySelector('[role=group]')!;
    expect(group.getAttribute('aria-label')).toBe('1,234 total assets');
    fixture.componentInstance.value.set('21.5');
    fixture.componentInstance.unit.set('GB');
    fixture.componentInstance.label.set('Total size');
    fixture.detectChanges();
    expect(el().querySelector('[role=group]')!.getAttribute('aria-label')).toBe(
      '21.5 GB total size',
    );
    expect(el().querySelectorAll('.st__unit')).toHaveLength(1);
    expect(el().querySelector('button')).toBeNull();
  });

  it('adds the note to the name and mutes a zero', () => {
    const c = fixture.componentInstance;
    c.value.set('2');
    c.label.set('Pending disposition');
    c.note.set('oldest 41 days');
    c.muted.set(true);
    fixture.detectChanges();
    expect(el().querySelector('[role=group]')!.getAttribute('aria-label')).toBe(
      '2 pending disposition, oldest 41 days',
    );
    expect(el().querySelector('.st--zero')).not.toBeNull();
  });

  it('is a toggle button when it can filter, pressed with a tick and not by colour alone', () => {
    const c = fixture.componentInstance;
    c.pressable.set(true);
    fixture.detectChanges();
    const button = el().querySelector('button')!;
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(el().querySelector('.st__tick')).toBeNull();
    button.click();
    expect(c.picks()).toBe(1);
    c.pressed.set(true);
    fixture.detectChanges();
    expect(el().querySelector('button')!.getAttribute('aria-pressed')).toBe('true');
    expect(el().querySelector('.st__tick')).not.toBeNull();
    expect(el().querySelector('.st--on')).not.toBeNull();
  });
});
