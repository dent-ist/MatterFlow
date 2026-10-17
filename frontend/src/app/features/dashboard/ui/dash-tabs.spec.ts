import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DashTab, DashTabs, revealInList } from './dash-tabs';

function rect(left: number, right: number): DOMRect {
  return {
    left,
    right,
    top: 0,
    bottom: 0,
    width: right - left,
    height: 0,
    x: left,
    y: 0,
  } as DOMRect;
}

/** A tab list 100 px wide (from x = 10) holding one tab at the given place; scrollLeft starts at 50. */
function setup(tabLeft: number, tabRight: number) {
  const list = document.createElement('div');
  const tab = document.createElement('button');
  list.appendChild(tab);
  list.scrollLeft = 50;
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(rect(10, 110));
  vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue(rect(tabLeft, tabRight));
  return { list, tab };
}

describe('revealInList (the tab list scrolls inside itself, never the page)', () => {
  it('moves right by exactly what hangs over the right edge', () => {
    const { list, tab } = setup(90, 150);
    const scrollIntoView = vi.fn();
    tab.scrollIntoView = scrollIntoView;
    revealInList(tab);
    expect(list.scrollLeft).toBe(90);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('moves left by what hangs over the left edge', () => {
    const { list, tab } = setup(-5, 55);
    revealInList(tab);
    expect(list.scrollLeft).toBe(35);
  });

  it('does nothing for a tab that is fully inside, or for no tab', () => {
    const { list, tab } = setup(20, 80);
    revealInList(tab);
    expect(list.scrollLeft).toBe(50);
    expect(() => revealInList(null)).not.toThrow();
    expect(() => revealInList(document.createElement('button'))).not.toThrow();
  });
});

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
  const strip = () => el.querySelector<HTMLElement>('.strip')!;

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

  it('marks the edge that has more tabs out of view and clears it at the other end', () => {
    const list = el.querySelector<HTMLElement>('.tabs')!;
    const scrollTo = (client: number, scroll: number, left: number) => {
      Object.defineProperty(list, 'clientWidth', { value: client, configurable: true });
      Object.defineProperty(list, 'scrollWidth', { value: scroll, configurable: true });
      Object.defineProperty(list, 'scrollLeft', { value: left, configurable: true });
      list.dispatchEvent(new Event('scroll'));
      fixture.detectChanges();
    };
    scrollTo(271, 520, 0);
    expect(strip().getAttribute('data-more-start')).toBe('false');
    expect(strip().getAttribute('data-more-end')).toBe('true');
    scrollTo(271, 520, 120);
    expect(strip().getAttribute('data-more-start')).toBe('true');
    expect(strip().getAttribute('data-more-end')).toBe('true');
    scrollTo(271, 520, 249);
    expect(strip().getAttribute('data-more-start')).toBe('true');
    expect(strip().getAttribute('data-more-end')).toBe('false');
    scrollTo(600, 520, 0);
    expect(strip().getAttribute('data-more-start')).toBe('false');
    expect(strip().getAttribute('data-more-end')).toBe('false');
  });
});
