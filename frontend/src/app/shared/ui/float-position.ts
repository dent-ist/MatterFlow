import {
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
} from '@angular/core';

/**
 * Puts a fixed-position panel (a menu or popover opened from `trigger`) next to the trigger: below it, or above it when it does not fit
 * below and there is more room above; right-aligned (`end`) or left-aligned (`start`) with the trigger and kept inside the window.
 * A fixed panel is not clipped by a scrolling box around its trigger (the steps pane of the version page, a table's scroll area).
 * The panel must be rendered (the size is measured) and have `position: fixed`; it is hidden until placed (`visibility`).
 */
export function placeFloating(
  trigger: HTMLElement,
  panel: HTMLElement,
  align: 'start' | 'end' = 'end',
): void {
  const margin = 8;
  const gap = 4;
  const rect = trigger.getBoundingClientRect();
  const box = panel.getBoundingClientRect();
  const roomBelow = window.innerHeight - rect.bottom - gap - margin;
  const roomAbove = rect.top - gap - margin;
  const above = box.height > roomBelow && roomAbove > roomBelow;
  const top = above ? Math.max(margin, rect.top - gap - box.height) : rect.bottom + gap;
  const wanted = align === 'end' ? rect.right - box.width : rect.left;
  const left = Math.max(margin, Math.min(wanted, window.innerWidth - box.width - margin));
  panel.style.position = 'fixed';
  panel.style.top = `${Math.round(top)}px`;
  panel.style.left = `${Math.round(left)}px`;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  panel.style.visibility = 'visible';
}

/** True when `event` is a scroll or resize that should close a floating panel (a scroll inside the panel itself does not). */
export function movesAway(event: Event, panel: HTMLElement | null | undefined): boolean {
  const target = event.target;
  return !(target instanceof Node && panel?.contains(target));
}

/**
 * A popover panel that floats next to its trigger (see `placeFloating`) and asks to be closed when the page scrolls or the window
 * resizes (the trigger would move away from it). Put it on the panel, which is rendered only while open:
 *
 *   @if (open()) { <div [mfFloatPanel]="button" (floatClose)="open.set(false)" class="pop">...</div> }
 */
@Directive({
  selector: '[mfFloatPanel]',
  host: { style: 'position: fixed; visibility: hidden; top: 0; left: 0;' },
})
export class FloatPanel {
  readonly trigger = input<HTMLElement | null>(null, { alias: 'mfFloatPanel' });
  readonly mfFloatAlign = input<'start' | 'end'>('end');
  readonly floatClose = output<void>();
  /** The panel is in place and visible (focus can move into it now). */
  readonly placed = output<void>();

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    const close = (event: Event): void => {
      if (movesAway(event, el)) this.floatClose.emit();
    };
    afterNextRender(() => {
      const trigger = this.trigger();
      if (trigger) placeFloating(trigger, el, this.mfFloatAlign());
      this.placed.emit();
      window.addEventListener('scroll', close, true);
      window.addEventListener('resize', close);
    });
    destroyRef.onDestroy(() => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    });
  }
}
