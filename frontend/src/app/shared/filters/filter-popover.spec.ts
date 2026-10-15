import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FilterPopover } from './filter-popover';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FilterPopover],
  template: `
    <button #btn type="button" id="trigger" (click)="open.set(true)">Open</button>
    <button type="button" id="elsewhere">Elsewhere</button>
    @if (open()) {
      <mf-filter-popover [anchor]="btn" label="Filter by Status" (closed)="open.set(false)">
        <input id="inside" aria-label="Find" />
        <div id="tall" style="height: 600px">content</div>
      </mf-filter-popover>
    }
  `,
})
class Host {
  readonly open = signal(false);
}

describe('filter popover', () => {
  let fixture: ComponentFixture<Host>;
  const el = (): HTMLElement => fixture.nativeElement;
  const pop = () => el().querySelector<HTMLElement>('mf-filter-popover');

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    document.body.appendChild(el());
    fixture.detectChanges();
    el().querySelector<HTMLButtonElement>('#trigger')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });
  afterEach(() => {
    el().remove();
    TestBed.resetTestingModule();
  });

  it('is a fixed-position dialog with the given name, placed from the trigger', () => {
    expect(pop()!.getAttribute('role')).toBe('dialog');
    expect(pop()!.getAttribute('aria-label')).toBe('Filter by Status');
    expect(getComputedStyle(pop()!).position).toBe('fixed');
    expect(pop()!.style.top).not.toBe('');
    expect(pop()!.style.left).not.toBe('');
  });

  it('moves focus into the panel', () => {
    expect(document.activeElement?.id).toBe('inside');
  });

  it('closes on Esc and gives the trigger focus back', () => {
    pop()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(pop()).toBeNull();
    expect(document.activeElement?.id).toBe('trigger');
  });

  it('closes on a click outside but not on the trigger or inside', () => {
    el()
      .querySelector('#inside')!
      .dispatchEvent(new Event('pointerdown', { bubbles: true }));
    el()
      .querySelector('#trigger')!
      .dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(pop()).not.toBeNull();
    el()
      .querySelector('#elsewhere')!
      .dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(pop()).toBeNull();
  });

  it('closes when the page or the grid scrolls, but not when its own content scrolls', () => {
    pop()!.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(pop()).not.toBeNull();
    document.body.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(pop()).toBeNull();
  });

  it('stops listening when it is gone', () => {
    pop()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    const spy = vi.spyOn(fixture.componentInstance.open, 'set');
    document.body.dispatchEvent(new Event('scroll'));
    expect(spy).not.toHaveBeenCalled();
  });
});
