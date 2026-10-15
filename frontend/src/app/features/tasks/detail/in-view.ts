import { DestroyRef, Directive, ElementRef, inject, output } from '@angular/core';

/**
 * Emits `inView` once, when the element is within about one screen of the visible area (or at once where `IntersectionObserver` is
 * not available). Used to load the Comments of a Task only when the person scrolls near them, so the first paint stays fast.
 */
@Directive({ selector: '[mfInView]' })
export class InView {
  readonly inView = output<void>();

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    if (typeof IntersectionObserver === 'undefined') {
      queueMicrotask(() => this.inView.emit());
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          this.inView.emit();
        }
      },
      { rootMargin: '0px 0px 600px 0px' },
    );
    observer.observe(el);
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }
}
