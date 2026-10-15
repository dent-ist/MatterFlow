import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

let nextId = 0;

/**
 * The panel of a multi-select, user, date or number filter (docs/ux/column-filters-review.md 4.8). It is `position: fixed` and placed
 * from the trigger (so the grid's scroll area never clips it), flips upward near the bottom edge, closes when the grid scrolls, on a
 * click outside and on Esc (the trigger gets focus back). Content is projected. Use it with `@if (open())` next to the trigger:
 *
 *   <button #btn (click)="open.set(true)">...</button>
 *   @if (open()) { <mf-filter-popover [anchor]="btn" label="Filter by Status" (closed)="open.set(false)">...</mf-filter-popover> }
 */
@Component({
  selector: 'mf-filter-popover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'dialog',
    '[attr.aria-label]': 'label()',
    '[id]': 'panelId',
    '[style.top.px]': 'top()',
    '[style.left.px]': 'left()',
    '[style.max-height.px]': 'maxHeight()',
    '(keydown.escape)': 'escape($event)',
    '(click)': '$event.stopPropagation()',
  },
  template: `<ng-content />`,
  styles: `
    :host {
      position: fixed;
      z-index: 1100;
      box-sizing: border-box;
      min-width: 14rem;
      max-width: min(22rem, calc(100vw - 16px));
      overflow-y: auto;
      padding: var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      box-shadow: var(--mf-shadow-1);
      font-weight: 400;
      text-align: left;
    }
  `,
})
export class FilterPopover {
  /** The trigger button: the panel is placed under it and it gets focus back on close. */
  readonly anchor = input.required<HTMLElement>();
  /** Accessible name: "Filter by Status". */
  readonly label = input.required<string>();
  /** Asks the owner to close (Esc, outside click, scroll). */
  readonly closed = output<void>();

  protected readonly panelId = `mf-fp-${nextId++}`;
  protected readonly top = signal(0);
  protected readonly left = signal(0);
  protected readonly maxHeight = signal(320);

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      this.place();
      // Focus moves into the panel (first field), as a dialog should.
      const first = this.el.nativeElement.querySelector<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), select:not([disabled])',
      );
      first?.focus({ preventScroll: true });
    });
    const outside = (e: Event) => {
      const t = e.target as Node | null;
      if (t && !this.el.nativeElement.contains(t) && !this.anchor().contains(t)) this.closed.emit();
    };
    // Scrolling the grid closes the panel (it would drift away from its cell); scrolling inside the panel does not.
    const scrolled = (e: Event) => {
      const t = e.target as Node | null;
      if (t && this.el.nativeElement.contains(t)) return;
      this.closed.emit();
    };
    const resized = () => this.closed.emit();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', resized);
    destroy.onDestroy(() => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', resized);
    });
  }

  protected place(): void {
    const rect = this.anchor().getBoundingClientRect();
    const panel = this.el.nativeElement;
    const gap = 4;
    const margin = 8;
    const wanted = Math.min(panel.scrollHeight + 2, 420);
    const below = window.innerHeight - rect.bottom - gap - margin;
    const above = rect.top - gap - margin;
    const flip = below < wanted && above > below;
    const room = flip ? above : below;
    const height = Math.max(120, Math.min(wanted, room));
    this.maxHeight.set(height);
    this.top.set(flip ? rect.top - gap - height : rect.bottom + gap);
    const width = panel.offsetWidth || 256;
    this.left.set(Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)));
  }

  protected escape(event: Event): void {
    event.stopPropagation();
    this.closed.emit();
    this.anchor().focus();
  }
}

/** Shared look of the trigger buttons of the multi-select, user, date and number filters: a 32 px control with a chevron. */
export const FILTER_TRIGGER_STYLES = `
  :host { display: block; min-width: 0; }
  .ft-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--mf-s1);
    width: 100%;
    min-width: 0;
    font-weight: 400;
    text-align: left;
    cursor: pointer;
  }
  .ft-btn[data-active] { border-color: var(--mf-primary); }
  .ft-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ft-text[data-empty] { color: var(--mf-text-muted); }
  .ft-btn .pi { flex: none; color: var(--mf-text-muted); font-size: 0.75rem; }
  .ft-field { display: grid; gap: var(--mf-s1); margin-bottom: var(--mf-s2); }
  .ft-field label, .ft-legend { font-size: var(--mf-fs-sm); font-weight: 600; }
  .ft-foot { display: flex; justify-content: space-between; gap: var(--mf-s2); margin-top: var(--mf-s2); }
  .ft-error { margin: 0 0 var(--mf-s2); color: var(--mf-danger); font-size: var(--mf-fs-sm); }
  :host(.ft--inline) .ft-btn { display: none; }
`;
