import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { settle } from '../../../shared/testing/org-testing';
import { CLAMP_LINES, ClampedRich, overflowsLines } from './clamped-rich';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ClampedRich],
  template: `<mf-clamped-rich [html]="html()" format="HTML" />`,
})
class Host {
  readonly html = signal(
    '<p>One</p><ul><li>Two</li></ul><p><a href="https://example.com">link</a></p>',
  );
}

describe('overflowsLines', () => {
  it('is true only when the content is taller than the lines (a pixel of rounding is allowed)', () => {
    expect(overflowsLines(12 * 20, 20, 12)).toBe(false);
    expect(overflowsLines(12 * 20 + 1, 20, 12)).toBe(false);
    expect(overflowsLines(12 * 20 + 2, 20, 12)).toBe(true);
    expect(overflowsLines(100, 0, 12)).toBe(false);
    expect(CLAMP_LINES).toBe(12);
  });
});

describe('ClampedRich', () => {
  afterEach(() => TestBed.resetTestingModule());

  const mount = async (scrollHeight: number) => {
    // jsdom has no layout: report the content height and a 20 px line.
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
    const realStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const style = realStyle(el);
      return new Proxy(style, {
        get: (t, p) =>
          p === 'lineHeight' ? '20px' : p === 'fontSize' ? '14px' : Reflect.get(t, p),
      });
    });
    const f = TestBed.createComponent(Host);
    await settle(f);
    return { f, el: f.nativeElement as HTMLElement };
  };
  afterEach(() => vi.restoreAllMocks());

  it('shows the whole text and no button when it fits in 12 lines', async () => {
    const { el } = await mount(200);
    expect(el.querySelector('[data-description-more]')).toBeNull();
    expect(el.querySelector('.cl__box--clamped')).toBeNull();
    expect(el.querySelector('[data-description] a')!.getAttribute('href')).toBe(
      'https://example.com',
    );
  });

  it('clamps a long text and expands it in place with Show more / Show less, keeping focus on the button', async () => {
    const { f, el } = await mount(700);
    const more = el.querySelector<HTMLButtonElement>('[data-description-more]')!;
    expect(more.textContent!.trim()).toBe('Show more');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('.cl__box--clamped')).not.toBeNull();
    // The whole text is in the page even when it is cut.
    expect(el.querySelector('[data-description]')!.textContent).toContain('Two');

    more.focus();
    more.click();
    await settle(f);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(more.textContent!.trim()).toBe('Show less');
    expect(el.querySelector('.cl__box--clamped')).toBeNull();
    expect(document.activeElement).toBe(more);
    expect(el.querySelector('[data-description-more]')).toBe(more);

    more.click();
    await settle(f);
    expect(el.querySelector('.cl__box--clamped')).not.toBeNull();
  });
});
