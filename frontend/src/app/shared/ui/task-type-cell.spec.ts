import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TaskTypeCell } from './task-type-cell';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TaskTypeCell],
  template: `<mf-task-type-cell name="Data Processing" iconKey="cpu-2" colourKey="violet" [typeId]="3" />`,
})
class Host {}

describe('mf-task-type-cell (#1232)', () => {
  it('shows the coloured chip and the type name beside it, with the name as the tooltip', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-type-chip]')).not.toBeNull();
    expect(el.querySelector('[data-type-name]')!.textContent).toBe('Data Processing');
    expect(el.querySelector('.ttc')!.getAttribute('title')).toBe('Data Processing');
  });
});
