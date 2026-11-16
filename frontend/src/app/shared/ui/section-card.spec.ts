import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SectionCard } from './section-card';

@Component({
  imports: [SectionCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-section-card
    key="tasks"
    heading="Tasks"
    icon="pi-check-square"
    hint="Open tasks"
    noun="tasks"
    [count]="count()"
    [shown]="shown()"
    [total]="total()"
    [more]="more()"
    [state]="state()"
    [fullView]="['/matters', 5]"
    [fullViewParams]="{ tab: 'tasks' }"
  >
    <button scAction type="button" data-act>New Task</button>
    <p data-body>rows</p>
  </mf-section-card>`,
})
class Host {
  readonly count = signal<number | null>(38);
  readonly shown = signal(10);
  readonly total = signal<number | null>(38);
  readonly more = signal(false);
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('ready');
}

describe('mf-section-card (D-03c)', () => {
  function create() {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const note = () => el.querySelector('[data-section-note]')!.textContent!.trim();
    return { fixture, el, note };
  }

  it('is a region named by its heading, with the count chip, the hint, the action and the body', () => {
    const { el } = create();
    const region = el.querySelector('section')!;
    expect(region.id).toBe('section-tasks');
    expect(region.getAttribute('aria-labelledby')).toBe('section-tasks-h');
    const heading = el.querySelector<HTMLElement>('h2')!;
    expect(heading.id).toBe('section-tasks-h');
    expect(heading.tabIndex).toBe(-1);
    expect(el.querySelector('[data-section-count]')!.textContent).toContain('38');
    expect(el.querySelector('.sc__hint')!.textContent).toBe('Open tasks');
    expect(el.querySelector('.sc__act [data-act]')).not.toBeNull();
    expect(el.querySelector('[data-body]')).not.toBeNull();
  });

  it('says "Showing 10 of 38 tasks" and links to the full view of the section', () => {
    const { el, note } = create();
    expect(note()).toBe('Showing 10 of 38 tasks');
    const link = el.querySelector<HTMLAnchorElement>('a[data-full-view]')!;
    expect(link.textContent).toContain('Open Full View');
    expect(link.getAttribute('href')).toBe('/matters/5?tab=tasks');
    expect(link.classList).toContain('mf-btn--text');
  });

  it('says "Showing all" when every row is shown and "0 tasks" when there are none', () => {
    const { fixture, note } = create();
    fixture.componentInstance.shown.set(6);
    fixture.componentInstance.total.set(6);
    fixture.detectChanges();
    expect(note()).toBe('Showing all 6 tasks');
    fixture.componentInstance.shown.set(0);
    fixture.componentInstance.total.set(0);
    fixture.detectChanges();
    expect(note()).toBe('0 tasks');
  });

  it('words a list without a total (a cursor list) by whether more rows remain', () => {
    const { fixture, note } = create();
    fixture.componentInstance.total.set(null);
    fixture.componentInstance.more.set(true);
    fixture.detectChanges();
    expect(note()).toBe('Showing the latest 10 tasks');
    fixture.componentInstance.more.set(false);
    fixture.detectChanges();
    expect(note()).toBe('Showing all 10 tasks');
  });

  it('says it loads on scroll while idle, announces Loading while loading and has no count text for an error', () => {
    const { fixture, el, note } = create();
    fixture.componentInstance.state.set('idle');
    fixture.detectChanges();
    expect(note()).toBe('Tasks load when you scroll here');
    fixture.componentInstance.state.set('loading');
    fixture.detectChanges();
    expect(note()).toBe('Loading tasks...');
    expect(el.querySelector('[data-section-note]')!.getAttribute('role')).toBe('status');
    fixture.componentInstance.state.set('error');
    fixture.detectChanges();
    expect(note()).toBe('');
    expect(el.querySelector('a[data-full-view]')).not.toBeNull();
  });

  it('leaves the count chip out when the count is unknown', () => {
    const { fixture, el } = create();
    fixture.componentInstance.count.set(null);
    fixture.detectChanges();
    expect(el.querySelector('[data-section-count]')).toBeNull();
  });
});
