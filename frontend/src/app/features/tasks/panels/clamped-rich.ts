import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

/** The description shows this many lines before "Show more" (#314). */
export const CLAMP_LINES = 12;

/** True when content of `contentHeight` px does not fit in `lines` lines of `lineHeight` px (a pixel of rounding is allowed). */
export function overflowsLines(contentHeight: number, lineHeight: number, lines: number): boolean {
  return lineHeight > 0 && contentHeight > lineHeight * lines + 1;
}

/**
 * Sanitized rich text (the Task description) cut to about 12 lines with "Show more / Show less" (#314). Nothing is removed: the whole
 * text is in the page and one click away; links, lists and tables inside keep working. The button exists only when the text really
 * overflows, and it is measured after the render and before the first paint, so nothing moves on load. The caller passes HTML that is
 * already sanitized.
 */
@Component({
  selector: 'mf-clamped-rich',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #box
      class="mf-rich cl__box"
      data-description
      [class.cl__box--clamped]="clamped()"
      [attr.data-format]="format() || null"
      [style.--cl-lines]="lines()"
      [innerHTML]="html()"
    ></div>
    @if (overflowing()) {
      <button
        type="button"
        class="cl__more"
        data-description-more
        [attr.aria-expanded]="expanded()"
        (click)="expanded.set(!expanded())"
      >
        {{ expanded() ? 'Show less' : 'Show more' }}
      </button>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    /* An explicit line height, so "12 lines" is the same number of pixels for the cut and for the measure. */
    .cl__box {
      line-height: 1.4;
    }
    .cl__box--clamped {
      position: relative;
      max-height: calc(var(--cl-lines) * 1lh);
      overflow: hidden;
    }
    /* The cue that more follows: a fade over the last line while the text is cut. */
    .cl__box--clamped::after {
      content: '';
      position: absolute;
      inset: auto 0 0;
      height: 2lh;
      background: linear-gradient(to bottom, transparent, var(--mf-surface));
      pointer-events: none;
    }
    .cl__more {
      min-height: var(--mf-target-min);
      margin-top: var(--mf-s1);
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      font-size: var(--mf-fs-sm);
      text-decoration: underline;
      cursor: pointer;
    }
    .cl__more:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
  `,
})
export class ClampedRich {
  /** Already sanitized HTML. */
  readonly html = input.required<string>();
  readonly format = input('');
  readonly lines = input(CLAMP_LINES);

  protected readonly expanded = signal(false);
  protected readonly overflowing = signal(false);
  protected readonly clamped = () => this.overflowing() && !this.expanded();

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  constructor() {
    const destroyRef = inject(DestroyRef);
    // Measured after every render that changes the text and once the box is in the page; scrollHeight is the full content height
    // whether or not the box is cut, so the answer does not depend on the current state.
    afterRenderEffect(() => {
      this.html();
      this.lines();
      this.measure();
    });
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      // The Details panel can be closed (display: none) when the text arrives, and the width changes with the window or the splitter.
      const observer = new ResizeObserver(() => this.measure());
      observer.observe(this.box().nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  private measure(): void {
    const el = this.box().nativeElement;
    const style = getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize) || 16;
    const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.4;
    this.overflowing.set(overflowsLines(el.scrollHeight, lineHeight, this.lines()));
  }
}
