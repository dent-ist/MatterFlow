import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WorkStrip, WorkStripItem } from './work-strip';

@Component({
  imports: [WorkStrip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-work-strip
    label="Summary"
    [items]="items()"
    [interactive]="interactive()"
    [active]="active()"
    (pick)="picked.push($event)"
  />`,
})
class Host {
  readonly items = signal<WorkStripItem[]>([
    { key: 'a', label: 'Overdue', count: 4, alert: true },
    { key: 'b', label: 'Due today', count: 0 },
    { key: 'c', label: 'ASAP', count: null },
  ]);
  readonly interactive = signal(true);
  readonly active = signal<string | null>(null);
  readonly picked: string[] = [];
}

describe('WorkStrip', () => {
  function create() {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  }

  it('shows label and count per item, -- for an unknown count and the zero muted', () => {
    const { el } = create();
    expect(el.textContent!.replace(/\s+/g, ' ').trim()).toBe('Overdue 4 Due today 0 ASAP --');
    expect(el.querySelector('[data-strip-item="b"]')!.classList).toContain('zero');
    expect(el.querySelector('[data-strip-item="a"]')!.classList).toContain('alert');
    expect(el.querySelector('[data-strip-item="a"] .pi')).not.toBeNull();
  });

  it('emits the key of a clicked item and marks the active one pressed', () => {
    const { f, el } = create();
    f.componentInstance.active.set('a');
    f.detectChanges();
    expect(el.querySelector('[data-strip-item="a"]')!.getAttribute('aria-pressed')).toBe('true');
    el.querySelector<HTMLButtonElement>('[data-strip-item="b"]')!.click();
    expect(f.componentInstance.picked).toEqual(['b']);
  });

  it('renders plain text, no buttons, when not interactive', () => {
    const { f, el } = create();
    f.componentInstance.interactive.set(false);
    f.detectChanges();
    expect(el.querySelectorAll('button').length).toBe(0);
    expect(el.querySelectorAll('[data-strip-item]').length).toBe(3);
  });
});
