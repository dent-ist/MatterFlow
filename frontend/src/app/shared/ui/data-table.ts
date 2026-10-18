import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Button } from 'primeng/button';
import { ErrorReference } from './error-reference';
import { FixedPage } from './fixed-page';
import { StatusFilter as StatusFilterValue, ariaSort, nextSort } from './list-helpers';

/** `forbidden` is a 403 on the list's own request: the text names the missing access and offers no Retry. */
export type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

/**
 * Column header cell that sorts (UXR-12, spec 5.2): `<th mfSort="name" [sort]="sort()" defaultSort="name" (sorted)="setSort($event)">Name</th>`.
 * Renders a real button inside the `th`, sets `aria-sort` on the cell and emits the next `sort` expression (ascending, then descending).
 */
@Component({
  // An attribute selector on the native <th>, so the cell keeps its table semantics.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'th[mfSort]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { scope: 'col', '[attr.aria-sort]': 'ariaValue()' },
  template: `
    <button type="button" class="mf-sort" (click)="sorted.emit(next())">
      <ng-content />
      <i class="pi" [class]="icon()" aria-hidden="true"></i>
    </button>
  `,
  styles: `
    .mf-sort {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: 600;
      /* A header never changes height when the columns re-balance (skeleton rows to loaded rows: no layout shift). */
      white-space: nowrap;
      cursor: pointer;
    }
    .mf-sort .pi {
      font-size: 0.75rem;
      color: var(--mf-text-muted);
    }
    :host([aria-sort='ascending']) .pi,
    :host([aria-sort='descending']) .pi {
      color: var(--mf-text);
    }
  `,
})
export class SortHeader {
  /** The API sort field of this column. */
  readonly mfSort = input.required<string>();
  /** The current `sort` expression (as in the URL); empty means the default order. */
  readonly sort = input<string | null | undefined>(undefined);
  /** The field the list is sorted by when `sort` is empty. */
  readonly defaultSort = input.required<string>();
  readonly sorted = output<string>();

  protected readonly ariaValue = computed(() =>
    ariaSort(this.sort(), this.mfSort(), this.defaultSort()),
  );
  protected readonly icon = computed(() => {
    const a = this.ariaValue();
    return a === 'ascending'
      ? 'pi-sort-amount-up-alt'
      : a === 'descending'
        ? 'pi-sort-amount-down'
        : 'pi-sort-alt';
  });
  protected next(): string {
    return nextSort(this.sort() || this.defaultSort(), this.mfSort());
  }
}

/** Status select with the product-owner default "Active" (inactive and archived records are hidden until asked for). */
@Component({
  selector: 'mf-status-filter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.sf--pinned]': 'pinned' },
  template: `
    <div class="sf">
      <label class="sf__label" [for]="inputId()">Status</label>
      <select
        class="mf-control sf__select"
        [id]="inputId()"
        [value]="value()"
        (change)="valueChange.emit($any($event.target).value)"
      >
        <option value="active">Active</option>
        <option value="inactive">{{ inactiveLabel() }}</option>
        <option value="all">All</option>
      </select>
    </div>
  `,
  styles: `
    .sf {
      display: grid;
      gap: var(--mf-s1);
    }
    .sf__label {
      font-weight: 600;
      font-size: var(--mf-fs-sm);
      line-height: 1.25rem;
    }
    .sf__select {
      min-width: 160px;
    }
    /* Pinned toolbar of a fixed-header page: the label sits left of the select, so the toolbar is one row. */
    @media (min-width: 768px) and (min-height: 561px) {
      :host(.sf--pinned) .sf {
        grid-auto-flow: column;
        align-items: center;
        gap: var(--mf-s2);
      }
    }
  `,
})
export class StatusFilter {
  protected readonly pinned = inject(FixedPage, { optional: true }) !== null;

  readonly value = input<StatusFilterValue>('active');
  readonly inputId = input.required<string>();
  /** Wording of the middle option ("Inactive", or "Archived" for projects). */
  readonly inactiveLabel = input('Inactive');
  readonly valueChange = output<string>();
}

const SKELETON_ROWS = [0, 1, 2, 3, 4];

/**
 * Loading, error and empty states for every list (UXR-19, UXR-20). While `state` is `loading` it shows five skeleton rows; on `error` an
 * inline alert with the error reference and Retry; when `empty` a dashed card whose text depends on `filtered` ("No clients match these
 * filters." with Clear filters, or "No clients yet." with the page's own action in the `mfEmptyAction` slot). Otherwise the table is
 * projected. `noun` is the plural, lowercase.
 */
@Component({
  selector: 'mf-list-state',
  imports: [Button, ErrorReference],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `mf-fill`: inside a fixed-header page the state fills what is left, so the projected grid scrolls and the pager stays pinned.
  host: { class: 'mf-fill' },
  template: `
    @switch (state()) {
      @case ('loading') {
        <div class="ls__skeleton" role="status" aria-busy="true" data-loading>
          <span class="ls__sr">Loading {{ noun() }}...</span>
          @for (n of rows; track n) {
            <div class="ls__row" aria-hidden="true">
              @for (c of cols(); track c) {
                <span class="ls__bone"></span>
              }
            </div>
          }
        </div>
      }
      @case ('error') {
        <div class="pg-alert" role="alert" data-error>
          Couldn't load {{ noun() }}.
          <mf-error-reference />
          <p-button label="Retry" severity="secondary" (onClick)="retry.emit()" />
        </div>
      }
      @case ('forbidden') {
        <div class="pg-alert" role="alert" data-forbidden>
          You don't have access to {{ noun() }}.
        </div>
      }
      @case ('ready') {
        @if (empty()) {
          @if (filtered()) {
            <div class="pg-state" data-empty="filtered">
              <p>No {{ noun() }} match these filters.</p>
              <p-button label="Clear filters" severity="secondary" (onClick)="clear.emit()" />
            </div>
          } @else {
            <div class="pg-state" data-empty="none">
              <p>{{ emptyText() || 'No ' + noun() + ' yet.' }}</p>
              <ng-content select="[mfEmptyAction]" />
            </div>
          }
        } @else {
          <ng-content />
        }
      }
    }
  `,
  styles: `
    .ls__skeleton {
      display: grid;
      gap: 1px;
      background: var(--mf-border);
      border: 1px solid var(--mf-border);
    }
    .ls__row {
      display: flex;
      gap: var(--mf-s4);
      align-items: center;
      height: var(--mf-row-h);
      padding: 0 var(--mf-s3);
      background: var(--mf-surface);
    }
    .ls__bone {
      flex: 1;
      height: 12px;
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
    }
    .ls__sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .pg-alert,
    .pg-state {
      margin: 0 0 var(--mf-s3);
      padding: var(--mf-s4);
      border-radius: var(--mf-radius);
    }
    .pg-alert {
      border: 1px solid var(--mf-danger);
      background: var(--mf-danger-bg);
      color: var(--mf-danger);
    }
    .pg-state {
      background: var(--mf-surface);
      border: 1px dashed var(--mf-border-strong);
      text-align: center;
    }
  `,
})
export class ListState {
  readonly state = input.required<LoadState>();
  /** True when the loaded list has no rows. */
  readonly empty = input(false);
  /** True when a search or filter is applied (changes the empty text and offers Clear filters). */
  readonly filtered = input(false);
  /** Plural, lowercase: "clients". */
  readonly noun = input.required<string>();
  /** First-run text; defaults to "No {noun} yet.". */
  readonly emptyText = input('');
  /** Number of skeleton cells per row. */
  readonly columns = input(4);

  readonly retry = output<void>();
  readonly clear = output<void>();

  protected readonly rows = SKELETON_ROWS;
  protected readonly cols = computed(() => Array.from({ length: this.columns() }, (_, i) => i));
}
