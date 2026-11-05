import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DashTab, DashTabs } from './dash-tabs';

const TABS: DashTab[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'breakdowns', label: 'Breakdowns' },
  { key: 'trends', label: 'Trends' },
  { key: 'swimlane', label: 'Swimlane' },
  { key: 'users', label: 'Users' },
];

@Component({
  imports: [DashTabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-dash-tabs
    [tabs]="tabs"
    [selected]="selected()"
    (tabChange)="selected.set($event)"
  />`,
})
class Host {
  readonly tabs = TABS;
  readonly selected = signal('summary');
}

describe('DashTabs (WP9b: the tab strip on a phone)', () => {
  let el: HTMLElement;
  let fixture: ComponentFixture<Host>;
  const tabs = () => Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });
  afterEach(() => el.remove());

  it('keeps the tablist semantics: one tab stop, aria-selected, the labelled list', () => {
    expect(el.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe(
      'Dashboard views',
    );
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
  });

  it('shows the Dashboard section icon before the title, hidden from assistive technology', () => {
    const h1 = el.querySelector('h1[data-page-title]')!;
    const glyph = h1.querySelector('i[data-page-icon]')!;
    expect(glyph.classList.contains('pi-home')).toBe(true);
    expect(glyph.getAttribute('aria-hidden')).toBe('true');
    expect(h1.firstElementChild).toBe(glyph);
    expect(h1.textContent!.trim()).toBe('Dashboard');
  });

  it('moves with the arrow keys, wraps round and Home/End jump', () => {
    const key = (k: string) =>
      tabs()
        .find((t) => t.tabIndex === 0)!
        .dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key('ArrowLeft');
    expect(document.activeElement).toBe(tabs()[4]);
    key('Home');
    expect(document.activeElement).toBe(tabs()[0]);
    key('End');
    expect(document.activeElement).toBe(tabs()[4]);
  });

  it('draws every tab with its icon, decorative, from the shared strip (LC-10)', () => {
    const icons = tabs().map((t) => t.querySelector('i.tab__icon'));
    expect(icons.every((i) => i !== null && i.getAttribute('aria-hidden') === 'true')).toBe(true);
    // The Summary tab has its own icon, so it does not repeat the Dashboard tile (pi-home, D-17, #1133).
    expect(icons.map((i) => i!.className.match(/pi-[a-z-]+/)![0])).toEqual([
      'pi-objects-column',
      'pi-chart-pie',
      'pi-chart-line',
      'pi-table',
      'pi-user',
    ]);
  });
});
