import { TestBed } from '@angular/core/testing';
import { SKIP_PANELS, SkipLinks } from './skip-links';

describe('SkipLinks (#820)', () => {
  afterEach(() => (document.body.innerHTML = ''));

  function create(): HTMLElement {
    const fixture = TestBed.createComponent(SkipLinks);
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    return fixture.nativeElement as HTMLElement;
  }

  it('offers the three panels in page order as links to their headings', () => {
    const el = create();
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[data-skip-to]'));
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'Needs my attention',
      'Next 7 days',
      'Matters',
    ]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(
      SKIP_PANELS.map((p) => `#mm-${p.key}-h`),
    );
    expect(el.querySelector('nav')?.getAttribute('aria-label')).toBe('Skip to a panel');
  });

  it('moves the focus to the heading and does not navigate away', () => {
    const el = create();
    const heading = document.createElement('h2');
    heading.id = 'mm-deadlines-h';
    heading.tabIndex = -1;
    heading.scrollIntoView = vi.fn();
    document.body.appendChild(heading);
    const link = el.querySelector<HTMLAnchorElement>('a[data-skip-to=deadlines]')!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(heading);
  });

  it('does nothing when the panel is not on the page', () => {
    const el = create();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    el.querySelector<HTMLAnchorElement>('a[data-skip-to=health]')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });
});
