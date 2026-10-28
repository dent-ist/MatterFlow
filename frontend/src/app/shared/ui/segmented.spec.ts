import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Segmented } from './segmented';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Segmented],
  template: `
    <div mfSegmented role="group" aria-label="Weeks shown">
      @for (w of choices; track w) {
        <button
          type="button"
          class="mf-btn"
          [attr.data-w]="w"
          [attr.aria-pressed]="value() === w"
          (click)="value.set(w)"
        >
          {{ w }} weeks
        </button>
      }
    </div>
  `,
})
class Host {
  readonly choices = [8, 12, 26];
  readonly value = signal(12);
}

describe('Segmented (one toggle pattern, #919)', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const btn = (w: number) => el.querySelector<HTMLButtonElement>(`[data-w="${w}"]`)!;
    return { fixture, el, btn, host: fixture.componentInstance };
  }
  const key = (el: HTMLElement, k: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  it('carries the shared look and has one Tab stop: the pressed button', async () => {
    const { el, btn } = await setup();
    expect(el.querySelector('[mfSegmented]')!.classList).toContain('mf-seg');
    expect(btn(12).tabIndex).toBe(0);
    expect(btn(8).tabIndex).toBe(-1);
    expect(btn(26).tabIndex).toBe(-1);
  });

  it('moves the focus with the arrow keys, wraps round, and Home / End jump', async () => {
    const { btn } = await setup();
    btn(12).focus();
    key(btn(12), 'ArrowRight');
    expect(document.activeElement).toBe(btn(26));
    key(btn(26), 'ArrowRight');
    expect(document.activeElement).toBe(btn(8));
    key(btn(8), 'ArrowLeft');
    expect(document.activeElement).toBe(btn(26));
    key(btn(26), 'Home');
    expect(document.activeElement).toBe(btn(8));
    key(btn(8), 'End');
    expect(document.activeElement).toBe(btn(26));
  });

  it('does not press by moving: Space or Enter (a click) presses, and the Tab stop follows the pressed button', async () => {
    const { fixture, btn, host } = await setup();
    btn(12).focus();
    key(btn(12), 'ArrowRight');
    expect(host.value()).toBe(12);
    btn(26).click();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    expect(host.value()).toBe(26);
    expect(btn(26).tabIndex).toBe(0);
    expect(btn(12).tabIndex).toBe(-1);
  });

  it('leaves other keys and modified keys alone', async () => {
    const { btn } = await setup();
    btn(12).focus();
    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    btn(12).dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
    const mod = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    btn(12).dispatchEvent(mod);
    expect(mod.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(btn(12));
  });
});
