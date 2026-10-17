import { Directive, signal } from '@angular/core';

/**
 * A scrolling region is focusable so the keyboard can scroll it, but its focus ring is for keyboard focus only: after a mouse or touch
 * press inside it the ring stays off until the next key press (the global rule in `styles/_fixed-page.scss` reads `data-pointer-focus`).
 */
@Directive({
  selector: '[mfPointerFocus]',
  host: {
    '(pointerdown)': 'set(true)',
    '(keydown)': 'set(false)',
    '(focusout)': 'set(false)',
    '[attr.data-pointer-focus]': 'pointer() ? "" : null',
  },
})
export class PointerFocus {
  protected readonly pointer = signal(false);

  protected set(value: boolean): void {
    this.pointer.set(value);
  }
}
