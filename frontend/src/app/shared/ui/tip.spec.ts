import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Tip } from './tip';

@Component({
  imports: [Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button type="button" id="owner" [mfTip]="text()">Owner</button>`,
})
class Host {
  readonly text = signal<string | null>('Collapse to rail');
}

describe('Tip', () => {
  const tip = (): HTMLElement | null => document.querySelector('[role="tooltip"]');

  afterEach(() => document.querySelectorAll('[role="tooltip"]').forEach((e) => e.remove()));

  function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return { fixture, owner: fixture.nativeElement.querySelector('#owner') as HTMLElement };
  }

  it('shows on hover with the text, outside the component, and is aria-hidden so axe finds no stray element outside the landmarks (#1268)', () => {
    const { owner } = setup();
    owner.dispatchEvent(new Event('mouseenter'));
    const el = tip()!;
    expect(el).not.toBeNull();
    expect(el.textContent).toBe('Collapse to rail');
    expect(el.parentElement).toBe(document.body);
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('the owner still points at the tip with aria-describedby while it is shown, and the pointer is removed with it', () => {
    const { owner } = setup();
    expect(owner.hasAttribute('aria-describedby')).toBe(false);
    owner.dispatchEvent(new Event('mouseenter'));
    const el = tip()!;
    expect(owner.getAttribute('aria-describedby')).toBe(el.id);
    owner.dispatchEvent(new Event('mouseleave'));
    expect(tip()).toBeNull();
    expect(owner.hasAttribute('aria-describedby')).toBe(false);
  });

  it('shows on keyboard focus and Esc hides it; an empty text shows nothing', () => {
    const { fixture, owner } = setup();
    owner.dispatchEvent(new Event('focus'));
    expect(tip()).not.toBeNull();
    owner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tip()).toBeNull();
    fixture.componentInstance.text.set('');
    fixture.detectChanges();
    owner.dispatchEvent(new Event('mouseenter'));
    expect(tip()).toBeNull();
  });
});
