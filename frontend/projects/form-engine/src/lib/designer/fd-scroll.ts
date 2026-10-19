import {
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  inject,
  input,
  signal,
} from '@angular/core';

/**
 * Names and focuses a pane body that scrolls on its own (axe `scrollable-region-focusable`, WCAG 2.1.1): while the content is taller
 * than the box it is a focusable `role="region"` named "<name>, scrollable", so a keyboard user can scroll it. While everything fits
 * it is left alone, so no empty Tab stop is added. The box itself bounds its height (`overflow: auto`).
 *
 * The same rule as the application's `mfScrollRegion`; the library cannot import the application.
 */
@Directive({
  selector: '[mfFdScroll]',
  host: {
    '[attr.role]': 'scrolls() ? "region" : null',
    '[attr.tabindex]': 'scrolls() ? 0 : null',
    '[attr.aria-label]': 'scrolls() ? name() + ", scrollable" : null',
  },
})
export class FdScroll {
  readonly name = input('', { alias: 'mfFdScroll' });

  protected readonly scrolls = signal(false);

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const measure = (): void =>
      this.scrolls.set(
        !!this.name() &&
          (this.el.scrollHeight > this.el.clientHeight + 1 ||
            this.el.scrollWidth > this.el.clientWidth + 1),
      );
    afterNextRender(() => {
      measure();
      const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
      resize?.observe(this.el);
      const content = new MutationObserver(measure);
      content.observe(this.el, { childList: true, subtree: true, characterData: true });
      window.addEventListener('resize', measure);
      destroyRef.onDestroy(() => {
        resize?.disconnect();
        content.disconnect();
        window.removeEventListener('resize', measure);
      });
    });
  }
}
