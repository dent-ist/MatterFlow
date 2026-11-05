import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { Dismissable } from '../../../shared/ui/dismissable';
import { IntPipe } from '../../../shared/ui/number-format';

let nextId = 0;

/**
 * The ONE Filters button of the Users views (US-07, #1098; the same look as the shared list toolbar, theme guide 11.1): a button with the filter icon, the word and the number of
 * filters in use, that opens a small anchored panel with the themed controls (projected) and a Clear filters button. The panel is drawn over the page (it never pushes the content
 * down), Esc closes it and returns focus to the button, a click outside closes it (the shared dismiss rule).
 */
@Component({
  selector: 'mf-users-filter-popover',
  imports: [IntPipe, Dismissable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      #btn
      type="button"
      class="mf-btn fbtn"
      data-filters-toggle
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? id : null"
      [attr.aria-label]="count() > 0 ? label() + ', ' + count() + ' in use' : label()"
      [class.fbtn--on]="count() > 0"
      (click)="open.set(!open())"
    >
      <i class="pi" [class]="icon()" aria-hidden="true"></i>
      <span class="w">{{ label() }}</span>
      @if (count() > 0) {
        <span class="n" data-filters-count aria-hidden="true">{{ count() | mfInt }}</span>
      }
    </button>
    @if (open()) {
      <div
        class="panel"
        role="dialog"
        [attr.aria-label]="label()"
        data-filters-panel
        [id]="id"
        [mfDismissable]="btn"
        (dismissed)="open.set(false)"
      >
        <div class="fields"><ng-content /></div>
        @if (count() > 0) {
          <button
            type="button"
            class="mf-btn mf-btn--text"
            data-clear-filters
            (click)="cleared.emit()"
          >
            Clear filters
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-block;
    }
    .fbtn {
      gap: var(--mf-s1);
    }
    .fbtn--on {
      color: var(--mf-primary);
      border-color: var(--mf-primary);
      background: var(--mf-selected-bg);
    }
    .n {
      font-variant-numeric: tabular-nums;
      min-width: 1.25rem;
      padding: 0 var(--mf-s1);
      color: var(--mf-primary-contrast);
      background: var(--mf-primary);
      border-radius: 999px;
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      line-height: 1.25rem;
      text-align: center;
    }
    .panel {
      position: absolute;
      top: calc(100% + var(--mf-s1));
      left: 0;
      z-index: 40;
      display: grid;
      gap: var(--mf-s3);
      min-width: 17rem;
      max-width: min(22rem, 90vw);
      padding: var(--mf-s3);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      box-shadow: var(--mf-shadow-pop);
    }
    .fields {
      display: grid;
      gap: var(--mf-s3);
    }
    .fields ::ng-deep label,
    .fields ::ng-deep .fl {
      display: grid;
      gap: var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    @media (max-width: 767.98px) {
      .w {
        display: none;
      }
      .fbtn {
        min-width: 44px;
        min-height: 44px;
      }
    }
  `,
})
export class UsersFilterPopover {
  /** How many filters are in use (the badge, and Clear filters shows only above 0). */
  readonly count = input(0);
  /** The button word and icon: Filters by default; the Coverage view calls its display choices "Display". */
  readonly label = input('Filters');
  readonly icon = input('pi-filter');
  readonly cleared = output<void>();

  protected readonly id = `uf-panel-${nextId++}`;
  protected readonly open = signal(false);
}
