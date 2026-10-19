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
 * Names and focuses a box that scrolls on its own (axe `scrollable-region-focusable`, WCAG 2.1.1; Task Types review BUG-4): while the
 * content is taller than the box it is a focusable `role="region"` with an accessible name, so a keyboard user can reach it and scroll
 * it (PageUp, PageDown, arrows, Home, End). While everything fits it is left as it is, so no empty Tab stop is added.
 *
 *   <div class="body" mfScrollRegion="Changes in this version">...</div>
 *
 * The box itself must bound its height (`max-height` and `overflow: auto`); this directive only adds the semantics.
 */
@Directive({
  selector: '[mfScrollRegion]',
  host: {
    '[attr.role]': 'scrolls() && name() ? "region" : null',
    '[attr.tabindex]': 'scrolls() && name() ? 0 : null',
    '[attr.aria-label]': 'scrolls() && name() ? name() : null',
    '[attr.data-scroll-region]': 'scrolls() && name() ? "" : null',
  },
})
export class ScrollRegion {
  /** The accessible name of the region; empty leaves the box as it is. */
  readonly name = input('', { alias: 'mfScrollRegion' });

  protected readonly scrolls = signal(false);

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const measure = (): void =>
      this.scrolls.set(
        this.el.scrollHeight > this.el.clientHeight + 1 ||
          this.el.scrollWidth > this.el.clientWidth + 1,
      );
    afterNextRender(() => {
      measure();
      // The box changes size with the window and with its content (a diff arrives after the dialog opened).
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
