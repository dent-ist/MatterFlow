import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, OnDestroy, afterNextRender, inject } from '@angular/core';

/**
 * Marks the bar at the bottom of a work page (the pager) and publishes its height as `--mf-page-footer-h` on the root element, with
 * `data-page-footer` set. Toasts and the Undo toast read both: on such a page they sit bottom left of the main column, above the bar,
 * so they never cover "Showing 1-50 of 76" or Previous/Next (A10). Pages without the bar keep the default corner.
 */
@Directive({ selector: '[mfPageFooter]' })
export class PageFooter implements OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly root = inject(DOCUMENT).documentElement;
  private observer: ResizeObserver | undefined;

  constructor() {
    afterNextRender(() => {
      const publish = () => {
        this.root.style.setProperty('--mf-page-footer-h', `${this.el.offsetHeight}px`);
        this.root.setAttribute('data-page-footer', '');
      };
      publish();
      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(publish);
        this.observer.observe(this.el);
      }
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.root.style.removeProperty('--mf-page-footer-h');
    this.root.removeAttribute('data-page-footer');
  }
}
