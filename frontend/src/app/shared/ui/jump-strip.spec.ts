import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { JumpLink, JumpStrip } from './jump-strip';

@Component({
  imports: [JumpStrip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-jump-strip
    label="Matter sections"
    meta="00343-00012"
    [links]="links()"
    [current]="current()"
    [stuck]="stuck()"
    (jump)="jumps.push($event)"
  />`,
})
class Host {
  readonly links = signal<JumpLink[]>([
    { key: 'summary', icon: 'pi-home', label: 'Summary' },
    { key: 'tasks', icon: 'pi-check-square', label: 'Tasks', count: 38 },
    { key: 'notes', icon: 'pi-file-edit', label: 'Notes', count: null },
  ]);
  readonly current = signal('summary');
  readonly stuck = signal(false);
  readonly jumps: string[] = [];
}

describe('mf-jump-strip (D-03b)', () => {
  function create() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const link = (key: string) => el.querySelector<HTMLAnchorElement>(`[data-jump="${key}"]`)!;
    return { fixture, el, link };
  }

  it('is a named nav landmark of links, not a tablist', () => {
    const { el } = create();
    expect(el.querySelector('nav')!.getAttribute('aria-label')).toBe('Matter sections');
    expect(el.querySelector('[role=tab], [role=tablist]')).toBeNull();
    expect(el.querySelectorAll('a[data-jump]').length).toBe(3);
  });

  it('marks the section in view with aria-current="location" and no other link', () => {
    const { fixture, el, link } = create();
    expect(link('summary').getAttribute('aria-current')).toBe('location');
    fixture.componentInstance.current.set('tasks');
    fixture.detectChanges();
    expect(link('summary').hasAttribute('aria-current')).toBe(false);
    expect(link('tasks').getAttribute('aria-current')).toBe('location');
    expect(el.querySelectorAll('[aria-current]').length).toBe(1);
  });

  it('shows a count in brackets, names it once, and leaves it out while unknown', () => {
    const { link } = create();
    expect(link('tasks').textContent).toContain('(38)');
    expect(link('tasks').getAttribute('aria-label')).toBe('Tasks, 38');
    expect(link('notes').textContent).not.toContain('(');
  });

  it('emits the key on a plain click without following the link (no hash in the address)', () => {
    const { fixture, link } = create();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link('tasks').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.jumps).toEqual(['tasks']);
  });

  it('leaves a modified click to the browser', () => {
    const { fixture, link } = create();
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    });
    link('tasks').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(fixture.componentInstance.jumps).toEqual([]);
  });

  it('shows the record number only while the strip is stuck', () => {
    const { fixture, el } = create();
    expect(el.querySelector('[data-jump-meta]')).toBeNull();
    fixture.componentInstance.stuck.set(true);
    fixture.detectChanges();
    expect(el.querySelector('[data-jump-meta]')!.textContent).toContain('00343-00012');
  });
});
