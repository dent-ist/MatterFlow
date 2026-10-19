import { Injector, afterNextRender } from '@angular/core';

/**
 * After a failed save, moves focus to the first field marked `aria-invalid="true"` inside `root` (the form pages' one validation rule:
 * the summary at the top announces the problems, focus lands on the first field to fix). Waits for the render that shows the errors.
 */
export function focusFirstInvalid(injector: Injector, root: ParentNode = document): void {
  afterNextRender(
    () => root.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus({ preventScroll: false }),
    { injector },
  );
}
