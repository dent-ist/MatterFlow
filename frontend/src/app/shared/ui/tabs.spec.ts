import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MfTab, Tabs } from './tabs';

@Component({
  imports: [Tabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-tabs
    label="Sections"
    idPrefix="x"
    [tabs]="tabs()"
    [selected]="selected()"
    (tabChange)="changed.push($event)"
  />`,
})
class Host {
  readonly tabs = signal<MfTab[]>([
    { key: 'a', label: 'Overview' },
    { key: 'b', label: 'Workflows', count: 2 },
    { key: 'c', label: 'Request form', disabledReason: 'Save the task type first' },
  ]);
  readonly selected = signal('a');
  readonly changed: string[] = [];
}

describe('mf-tabs', () => {
  function create() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tab = (key: string) => el.querySelector<HTMLButtonElement>(`[data-tab="${key}"]`)!;
    return { fixture, el, tab };
  }

  it('names a counted tab "Workflows, 2" and makes the selected tab the only tab stop', () => {
    const { tab } = create();
    expect(tab('b').getAttribute('aria-label')).toBe('Workflows, 2');
    expect(tab('a').tabIndex).toBe(0);
    expect(tab('b').tabIndex).toBe(-1);
  });

  it('a badge is a small number after the label, hidden from assistive technology (the name says it), and not drawn for 0', () => {
    const { fixture, tab } = create();
    fixture.componentInstance.tabs.set([
      { key: 'a', label: 'Overview', badge: 0 },
      { key: 'b', label: 'Activity', badge: 7, name: 'Activity, 7 changes since your last visit' },
    ]);
    fixture.detectChanges();
    expect(tab('a').querySelector('[data-tab-badge]')).toBeNull();
    const badge = tab('b').querySelector('[data-tab-badge]')!;
    expect(badge.textContent!.trim()).toBe('7');
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    expect(tab('b').getAttribute('aria-label')).toBe('Activity, 7 changes since your last visit');
  });

  it('a tab with a disabled reason is aria-disabled, described by the reason, and does nothing when chosen (#381)', () => {
    const { fixture, el, tab } = create();
    const c = tab('c');
    expect(c.getAttribute('aria-disabled')).toBe('true');
    expect(c.disabled).toBe(false); // still in the tab order, so the reason can be read
    expect(c.getAttribute('title')).toBe('Save the task type first');
    const why = el.querySelector('#' + c.getAttribute('aria-describedby'))!;
    expect(why.textContent).toBe('Save the task type first');
    c.click();
    expect(fixture.componentInstance.changed).toEqual([]);
    tab('b').click();
    expect(fixture.componentInstance.changed).toEqual(['b']);
  });

  it('moves with the arrows, wraps, and does not select the disabled tab', () => {
    const { fixture, tab } = create();
    fixture.componentInstance.selected.set('b');
    fixture.detectChanges();
    tab('b').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    tab('b').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    tab('b').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(fixture.componentInstance.changed).toEqual(['a', 'a']);
  });
});
