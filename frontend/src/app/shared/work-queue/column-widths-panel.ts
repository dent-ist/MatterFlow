import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { WORK_COLUMNS, ColumnDef, ColumnScope } from './column-prefs';
import { WIDTH_STEP_PX, widthMessage } from './column-menu-items';
import { ASSIGNEE_WITH_LINK_PX, columnWidthRem, pxToRem, remToPx } from './column-widths';
import { WorkWidths } from './work-widths';

/** The step with Shift held (the header menu has the plain 8 px only). */
export const WIDTH_STEP_BIG_PX = 32;

/** The width after a step of `px` (negative narrows), whole px, clamped to the column's limits. */
export function stepWidth(def: ColumnDef, current: number, px: number): number {
  return Math.min(def.maxWidth, Math.max(def.minWidth, Math.round(current) + px));
}

/**
 * "Column widths" section of the Columns panel (#206): the keyboard and single-pointer way to size a column (WCAG 2.1.1, 2.5.7). One row per
 * shown column with a stepper (a number input in px and - / + buttons, 8 px a step, 32 px with Shift), Fit and Reset width. It reads and
 * writes the same `WorkWidths` store as the drag handle and the header menu, so the grid follows at once, and every change is announced
 * through `announced` ("Due column 144 pixels"). Hidden below 640 px, where the grid is cards or scrolls and has no resizing.
 */
@Component({
  selector: 'mf-column-widths-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="cw" data-widths-set>
      <legend>Column widths</legend>
      @for (row of rows(); track row.def.key) {
        @if (row.fill) {
          <div class="cw-row" [attr.data-width-row]="row.def.key">
            <span class="cw-name">{{ row.def.label }}</span>
            <span class="cw-note">Fills the space left</span>
          </div>
        } @else {
          <div class="cw-row" [attr.data-width-row]="row.def.key">
            <span class="cw-name">{{ row.def.label }}</span>
            <span class="cw-step">
              <button
                type="button"
                class="mf-btn cw-btn"
                data-width-minus
                [attr.aria-label]="'Narrow ' + row.def.label"
                [attr.aria-disabled]="row.px <= row.def.minWidth ? 'true' : null"
                (click)="stepBy(row.def, row.px, -1, $event)"
              >
                <i class="pi pi-minus" aria-hidden="true"></i>
              </button>
              <input
                #field
                type="number"
                class="cw-input"
                data-width-input
                inputmode="numeric"
                [attr.aria-label]="row.def.label + ' width in pixels'"
                [min]="row.def.minWidth"
                [max]="row.def.maxWidth"
                [value]="row.px"
                (change)="typed(row.def, row.px, field)"
                (keydown.arrowup)="arrow(row.def, row.px, 1, $event, field)"
                (keydown.arrowdown)="arrow(row.def, row.px, -1, $event, field)"
              />
              <button
                type="button"
                class="mf-btn cw-btn"
                data-width-plus
                [attr.aria-label]="'Widen ' + row.def.label"
                [attr.aria-disabled]="row.px >= row.def.maxWidth ? 'true' : null"
                (click)="stepBy(row.def, row.px, 1, $event)"
              >
                <i class="pi pi-plus" aria-hidden="true"></i>
              </button>
            </span>
            <button
              type="button"
              class="mf-btn mf-btn--text cw-act"
              data-width-fit
              [attr.aria-label]="'Fit ' + row.def.label + ' to content'"
              (click)="fit(row.def)"
            >
              Fit
            </button>
            <button
              type="button"
              class="mf-btn mf-btn--text cw-act"
              data-width-reset
              [attr.aria-label]="'Reset width, ' + row.def.label"
              [attr.aria-disabled]="row.stored ? null : 'true'"
              (click)="reset(row.def, row.stored)"
            >
              Reset width
            </button>
          </div>
        }
      }
    </fieldset>
  `,
  styles: `
    :host {
      display: block;
      flex: 1 0 100%;
    }
    @media (max-width: 639.98px) {
      :host {
        display: none;
      }
    }
    .cw {
      display: grid;
      gap: var(--mf-s1);
      margin: 0;
      padding: var(--mf-s3) 0 0;
      border: 0;
      border-top: 1px solid var(--mf-border);
    }
    .cw legend {
      float: left;
      width: 100%;
      padding: 0;
      font-weight: 600;
    }
    .cw legend + .cw-row {
      clear: both;
    }
    .cw-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-target-min);
    }
    .cw-name {
      flex: 0 0 6.5rem;
    }
    .cw-note {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .cw-step {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
    }
    .cw-btn {
      min-width: var(--mf-target-min);
      min-height: var(--mf-target-min);
      justify-content: center;
    }
    .cw-btn[aria-disabled='true'],
    .cw-act[aria-disabled='true'] {
      opacity: 0.5;
      cursor: default;
    }
    .cw-input {
      box-sizing: border-box;
      width: 4.5rem;
      min-height: var(--mf-target-min);
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      text-align: right;
    }
    .cw-input:focus-visible {
      outline: 2px solid var(--mf-focus, currentColor);
      outline-offset: 1px;
    }
  `,
})
export class ColumnWidthsPanel {
  /** The column keys the grid shows, in table order. */
  readonly columns = input.required<readonly string[]>();
  readonly scope = input.required<ColumnScope>();
  readonly userId = input<number | null>(null);
  /** Pod Work with "Assign to me" beside "Unassigned": the Assignee default is wider there. */
  readonly assignLink = input(false);

  /** A polite message for the panel's live region. */
  readonly announced = output<string>();

  private readonly store = inject(WorkWidths);

  protected readonly rows = computed(() => {
    const stored = this.store.widths(this.scope(), this.userId());
    const effective = this.assignLink()
      ? { assignee: pxToRem(ASSIGNEE_WITH_LINK_PX), ...stored }
      : stored;
    const shown = new Set(this.columns());
    return WORK_COLUMNS.filter((d) => shown.has(d.key)).map((def) => ({
      def,
      fill: !!def.fill || def.resizable === false,
      px: Math.round(remToPx(columnWidthRem(def, effective))),
      stored: def.key in stored,
    }));
  });

  /**
   * The width of a column as it is now. A click handler gets the width the template was last rendered with; a second key press (Enter
   * held down, or two quick presses) can arrive before the next render, and stepping from that stale number loses a step.
   */
  private currentPx(def: ColumnDef, rendered: number): number {
    return this.rows().find((r) => r.def.key === def.key)?.px ?? rendered;
  }

  private defaultRem(def: ColumnDef): number | undefined {
    return this.assignLink() && def.key === 'assignee' ? pxToRem(ASSIGNEE_WITH_LINK_PX) : undefined;
  }

  private defaultPx(def: ColumnDef): number {
    return this.assignLink() && def.key === 'assignee' ? ASSIGNEE_WITH_LINK_PX : def.width;
  }

  private apply(def: ColumnDef, px: number): void {
    this.store.set(this.scope(), this.userId(), def.key, pxToRem(px), this.defaultRem(def));
    this.announced.emit(widthMessage(def, px));
  }

  /** The - and + buttons: 8 px, 32 px with Shift (Shift + Enter or Space on the keyboard counts too). */
  protected stepBy(def: ColumnDef, current: number, direction: 1 | -1, event: MouseEvent): void {
    const step = event.shiftKey ? WIDTH_STEP_BIG_PX : WIDTH_STEP_PX;
    this.apply(def, stepWidth(def, this.currentPx(def, current), direction * step));
  }

  /** Up and Down in the field step from the real width (the browser would snap to the 8 px grid of the minimum). */
  protected arrow(
    def: ColumnDef,
    current: number,
    direction: 1 | -1,
    event: Event,
    field: HTMLInputElement,
  ): void {
    event.preventDefault();
    const step = (event as KeyboardEvent).shiftKey ? WIDTH_STEP_BIG_PX : WIDTH_STEP_PX;
    const next = stepWidth(def, this.currentPx(def, current), direction * step);
    field.value = String(next);
    this.apply(def, next);
  }

  /** A typed number: out of range clamps to the minimum or maximum and the clamped value is shown; no number goes back to the current width. */
  protected typed(def: ColumnDef, current: number, field: HTMLInputElement): void {
    const value = field.valueAsNumber;
    if (!Number.isFinite(value)) {
      field.value = String(current);
      return;
    }
    const px = stepWidth(def, value, 0);
    field.value = String(px);
    if (px !== current) this.apply(def, px);
  }

  protected reset(def: ColumnDef, stored: boolean): void {
    if (!stored) return;
    this.store.reset(this.scope(), this.userId(), def.key);
    this.announced.emit(widthMessage(def, this.defaultPx(def)));
  }

  /** Fit to the rows on the page, measured on the grid behind the panel (`column-fit.ts`, loaded on first use). */
  protected fit(def: ColumnDef): void {
    const table = document.querySelector<HTMLTableElement>('mf-task-table table');
    if (!table) return;
    void import('./column-fit').then(({ fitColumn }) => {
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const px = fitColumn(table, def, root > 0 ? root : remToPx(1));
      if (px !== null) this.apply(def, px);
    });
  }
}
