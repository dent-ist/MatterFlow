import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { settle } from '../testing/org-testing';
import { ActionMenu, MenuAction } from './action-menu';

const run = { a: vi.fn(), b: vi.fn() };

@Component({
  imports: [ActionMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button id="before">before</button><mf-action-menu [items]="items()" />`,
})
class Host {
  readonly items = signal<MenuAction[]>([
    { id: 'a', label: 'Alpha', run: run.a },
    { id: 'b', label: 'Beta', disabled: true, reason: 'Not now.', run: run.b },
    { id: 'c', label: 'Gamma', run: vi.fn() },
  ]);
}

describe('mf-action-menu', () => {
  let fixture: ComponentFixture<Host>;
  const el = (): HTMLElement => fixture.nativeElement;
  const trigger = (): HTMLButtonElement => el().querySelector('[data-overflow]')!;
  const items = (): HTMLButtonElement[] =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('[role=menuitem]'));
  const key = (target: Element, k: string) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  beforeEach(async () => {
    run.a.mockClear();
    run.b.mockClear();
    fixture = TestBed.createComponent(Host);
    await settle(fixture);
  });

  it('is a menu button that opens on click and focuses the first item', async () => {
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    trigger().click();
    await settle(fixture);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(items().map((i) => i.querySelector('.am__text > span')!.textContent)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
    expect(document.activeElement).toBe(items()[0]);
  });

  it('moves with the arrows, Home and End and wraps around', async () => {
    key(trigger(), 'ArrowDown');
    await settle(fixture);
    key(items()[0], 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    key(items()[1], 'End');
    expect(document.activeElement).toBe(items()[2]);
    key(items()[2], 'ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0], 'ArrowUp');
    expect(document.activeElement).toBe(items()[2]);
    key(items()[2], 'Home');
    expect(document.activeElement).toBe(items()[0]);
  });

  it('closes on Esc and returns focus to the button', async () => {
    trigger().click();
    await settle(fixture);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);
    expect(el().querySelector('[role=menu]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('runs an enabled item and closes; a disabled item stays focusable, says why and does nothing', async () => {
    trigger().click();
    await settle(fixture);
    const beta = items()[1];
    expect(beta.getAttribute('aria-disabled')).toBe('true');
    expect(beta.disabled).toBe(false);
    expect(document.getElementById(beta.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Not now.',
    );
    beta.click();
    await settle(fixture);
    expect(run.b).not.toHaveBeenCalled();
    expect(el().querySelector('[role=menu]')).not.toBeNull();
    items()[0].click();
    await settle(fixture);
    expect(run.a).toHaveBeenCalledTimes(1);
    expect(el().querySelector('[role=menu]')).toBeNull();
  });

  it('renders nothing without items', async () => {
    fixture.componentInstance.items.set([]);
    await settle(fixture);
    expect(trigger as unknown).toBeDefined();
    expect(el().querySelector('[data-overflow]')).toBeNull();
  });

  it('shows a danger entry in red and a set-apart entry with a divider above it', async () => {
    fixture.componentInstance.items.set([
      { id: 'a', label: 'Alpha', run: run.a },
      { id: 'x', label: 'Cancel task', danger: true, separated: true, run: vi.fn() },
    ]);
    await settle(fixture);
    trigger().click();
    await settle(fixture);
    expect(items()[0].classList).not.toContain('am__item--danger');
    expect(items()[1].classList).toContain('am__item--danger');
    expect(items()[1].classList).toContain('am__item--sep');
  });
});
