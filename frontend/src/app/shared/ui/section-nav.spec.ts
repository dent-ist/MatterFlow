import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { settle } from '../testing/org-testing';
import { SectionNav, SectionNavItem, currentSection } from './section-nav';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionNav],
  template: `
    <mf-section-nav label="Sections" [items]="items()" (navigate)="went.push($event)" />
    <div id="s-a">A</div>
    <div id="s-b">B</div>
  `,
})
class Host {
  readonly went: string[] = [];
  readonly items = signal<SectionNavItem[]>([
    { key: 'a', label: 'Workflow', target: 's-a', count: '2/3', hint: '2 of 3 steps resolved' },
    { key: 'b', label: 'Comments', target: 's-b', count: '48' },
    { key: 'c', label: 'Assets', target: 's-c', count: null },
  ]);
}

describe('currentSection (scroll-spy rule)', () => {
  const tops = [
    { key: 'a', top: -400 },
    { key: 'b', top: 50 },
    { key: 'c', top: 900 },
  ];

  it('is the last section whose top has reached the reading line', () => {
    expect(currentSection(tops, 120, false)).toBe('b');
    expect(currentSection(tops, 20, false)).toBe('a');
    expect(currentSection(tops, 1000, false)).toBe('c');
  });

  it('is the first section before any has reached the line, the last at the end of the page, null without sections', () => {
    expect(currentSection([{ key: 'a', top: 300 }], 100, false)).toBe('a');
    expect(currentSection(tops, 120, true)).toBe('c');
    expect(currentSection([], 100, false)).toBeNull();
  });
});

describe('SectionNav', () => {
  it('is a labelled navigation of real links with counts, the first one current', async () => {
    const f = TestBed.createComponent(Host);
    await settle(f);
    const el = f.nativeElement as HTMLElement;
    const nav = el.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe('Sections');
    const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a'));
    expect(links.map((a) => a.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'Workflow 2/3',
      'Comments 48',
      'Assets',
    ]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#s-a', '#s-b', '#s-c']);
    expect(links[0].title).toBe('2 of 3 steps resolved');
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual(['location', null, null]);
  });

  it('hands a click to the page instead of jumping, marks that section current, and leaves a modified click alone', async () => {
    const f = TestBed.createComponent(Host);
    await settle(f);
    const el = f.nativeElement as HTMLElement;
    const b = el.querySelector<HTMLAnchorElement>('[data-section-link=b]')!;
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    b.dispatchEvent(plain);
    await settle(f);
    expect(plain.defaultPrevented).toBe(true);
    expect(f.componentInstance.went).toEqual(['b']);
    expect(b.getAttribute('aria-current')).toBe('location');
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    el.querySelector('[data-section-link=c]')!.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
    expect(f.componentInstance.went).toEqual(['b']);
  });
});
