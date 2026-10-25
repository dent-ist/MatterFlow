import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LONG_PRESS_MS, NavTip, TOUCH_HIDE_MS } from './nav-tip';

@Component({
  imports: [NavTip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<nav mfNavTip>
    <a href="#a" id="a" data-tip="Clients">c</a>
    <a href="#b" id="b" data-tip="Matters">m</a>
  </nav>`,
})
class Host {}

describe('NavTip (S7, #623)', () => {
  let rail = true;
  const tip = (): HTMLElement | null => document.querySelector('[data-nav-tip]');

  beforeEach(() => {
    vi.useFakeTimers();
    rail = true;
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: rail && q.includes('max-width: 1099px'),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.querySelectorAll('[data-nav-tip]').forEach((e) => e.remove());
  });

  function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = (id: string): HTMLElement => fixture.nativeElement.querySelector('#' + id);
    return { fixture, a: el('a'), b: el('b') };
  }

  it('shows the name on hover, hides it when the pointer leaves, and is aria-hidden', () => {
    const { a } = setup();
    a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(tip()?.textContent).toBe('Clients');
    expect(tip()?.getAttribute('aria-hidden')).toBe('true');
    a.closest('nav')!.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tip()).toBeNull();
  });

  it('shows the name on keyboard focus only, and Esc dismisses it until another item is entered', () => {
    const { a, b } = setup();
    vi.spyOn(a, 'matches').mockImplementation((s) => s === ':focus-visible');
    a.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(tip()?.textContent).toBe('Clients');
    a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(tip()).toBeNull();
    // Hovering the same item does not bring it back; another item shows its own name.
    a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(tip()).toBeNull();
    b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(tip()?.textContent).toBe('Matters');
  });

  it('ignores mouse-driven focus (not focus-visible)', () => {
    const { a } = setup();
    vi.spyOn(a, 'matches').mockReturnValue(false);
    a.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(tip()).toBeNull();
  });

  it('shows nothing outside the rail (names are drawn, or the menu is a panel)', () => {
    rail = false;
    const { a } = setup();
    a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(tip()).toBeNull();
  });

  it('shows the name on a long press with a finger, keeps the click from following the link, then hides', () => {
    const { a } = setup();
    const down = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(down, 'pointerType', { value: 'touch' });
    a.dispatchEvent(down);
    expect(tip()).toBeNull();
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(tip()?.textContent).toBe('Clients');
    a.dispatchEvent(new Event('pointerup', { bubbles: true }));
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(TOUCH_HIDE_MS + 10);
    expect(tip()).toBeNull();
    // A normal tap afterwards follows the link.
    const tapDown = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(tapDown, 'pointerType', { value: 'touch' });
    a.dispatchEvent(tapDown);
    a.dispatchEvent(new Event('pointerup', { bubbles: true }));
    const tap = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(tap);
    expect(tap.defaultPrevented).toBe(false);
  });
});
