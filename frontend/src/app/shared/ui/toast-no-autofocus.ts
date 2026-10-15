import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/**
 * Put it on `<p-toast mfToastNoAutofocus>`. PrimeNG renders every toast's close button with the HTML `autofocus` attribute, and
 * Chromium focuses such a button when the toast appears, a moment after it was added. A status message ("Details saved") then
 * takes keyboard focus from the control the person was using, or from the control a closing dialog has just returned focus to.
 *
 * Removing the attribute is too late (the browser has already queued the element), so focus that lands inside the toast host
 * without the person asking for it is handed back. The person asks for it by pressing Tab or by clicking inside the toast.
 */
@Directive({ selector: '[mfToastNoAutofocus]' })
export class ToastNoAutofocus {
  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    let requested = false;
    const onKey = (e: KeyboardEvent): void => {
      requested = e.key === 'Tab';
    };
    const onPointer = (e: Event): void => {
      requested = e.target instanceof Node && host.contains(e.target);
    };
    const onFocusIn = (e: FocusEvent): void => {
      if (requested || !(e.target instanceof HTMLElement)) return;
      const back = e.relatedTarget;
      if (back instanceof HTMLElement && back.isConnected && !host.contains(back)) {
        back.focus({ preventScroll: true });
      } else {
        e.target.blur();
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    host.addEventListener('focusin', onFocusIn);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      host.removeEventListener('focusin', onFocusIn);
    });
  }
}
