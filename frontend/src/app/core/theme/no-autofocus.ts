import { AutoFocus } from 'primeng/autofocus';

/**
 * PrimeNG's `p-button` passes `autofocus || buttonProps?.autofocus` to its `pAutoFocus` directive. That is `undefined`, not
 * `false`, when nobody asked for focus, and the directive then writes `autofocus="true"` onto the button, so the browser
 * focuses the first button of a page on load (UXR2-09). Only an explicit truthy `autofocus` may keep the attribute.
 */
export function suppressImplicitAutofocus(): void {
  const proto = AutoFocus.prototype as unknown as {
    onAfterContentChecked(): void;
    autofocus?: boolean;
    host: { nativeElement: HTMLElement };
  };
  if ((proto as { __mfPatched?: boolean }).__mfPatched) return;
  const original = proto.onAfterContentChecked;
  proto.onAfterContentChecked = function (this: typeof proto): void {
    if (!this.autofocus) {
      this.host.nativeElement.removeAttribute('autofocus');
      return;
    }
    original.call(this);
  };
  (proto as { __mfPatched?: boolean }).__mfPatched = true;
}
