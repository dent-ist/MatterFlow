import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { Button } from 'primeng/button';
import { CopyParts, CopyPart } from './copy-parts';
import { LoadState } from './data-table';
import { ErrorReference } from './error-reference';
import type { ListFilters } from '../filters/list-filters';

/** Bone widths of a skeleton row when the page gives none; they repeat across the columns. */
const DEFAULT_BONES = ['7rem', '14rem', '5rem', '6rem'] as const;
/** Skeleton rows shown while a list loads (spec 5.2). */
const SKELETON_ROWS = [0, 1, 2, 3, 4] as const;

/**
 * The body of a filtered grid: the rows (projected) while the list is ready, and a full-width row for error, forbidden and empty, so
 * the column headers and the filter row stay on screen in every state (`mf-list-state` replaces the whole table). Loading shows five
 * skeleton rows of the grid's own columns (44 px, `skeleton` gives each column's bone width so the loaded table keeps its shape), with
 * one polite "Loading clients" for assistive technology and `aria-busy` on the body. A Retry that succeeds moves focus to the first row
 * link, or to the scroll region when there is no row. A 403 reads "You don't have access to clients." without Retry.
 *
 *   <tbody mfGridBody noun="clients" [state]="state()" [empty]="rows().length === 0" [filtered]="filters.activeCount() > 0"
 *          [columns]="4" [skeleton]="['6rem', '18rem', '3rem', '5rem']" (retry)="load()" (clear)="clear()">
 *     @for (c of rows(); track c.clientId) { <tr>...</tr> }
 *     <p-button mfEmptyAction label="New client" />     <!-- optional: shown with the first-run text -->
 *   </tbody>
 */
@Component({
  // An attribute selector on the native <tbody>, so the table keeps its semantics.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'tbody[mfGridBody]',
  imports: [Button, ErrorReference, CopyParts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.aria-busy]': "state() === 'loading' ? 'true' : null" },
  template: `
    @switch (state()) {
      @case ('loading') {
        <tr>
          <td
            class="mf-sr-only"
            [attr.colspan]="columns()"
            role="status"
            aria-busy="true"
            data-loading
          >
            Loading {{ noun() }}
          </td>
        </tr>
        @for (n of skeletonRows; track n) {
          <tr class="gb-sk" aria-hidden="true" data-skeleton>
            @for (w of bones(); track $index) {
              <td [class]="skeletonCells()[$index] ?? ''">
                <span class="gb-bone" [style.width]="w"></span>
              </td>
            }
          </tr>
        }
      }
      @case ('forbidden') {
        <tr class="gb-state">
          <td [attr.colspan]="columns()" data-forbidden>
            <div class="gb-alert" role="alert">You don't have access to {{ noun() }}.</div>
          </td>
        </tr>
      }
      @case ('error') {
        <tr class="gb-state">
          <td [attr.colspan]="columns()" data-error>
            <div class="gb-alert" role="alert">
              Couldn't load {{ noun() }}.
              <mf-error-reference />
            </div>
            <p-button label="Retry" severity="secondary" (onClick)="onRetry()" />
          </td>
        </tr>
      }
      @default {
        @if (empty()) {
          <tr class="gb-state">
            <td [attr.colspan]="columns()" [attr.data-empty]="filtered() ? 'filtered' : 'none'">
              @if (filtered()) {
                <p>No {{ noun() }} match these filters</p>
                @if (hidden() > 0) {
                  <p class="gb-hint" data-hidden-hint>
                    {{ hidden() }} {{ hiddenLabel() }} hidden
                    <button
                      type="button"
                      class="mf-btn mf-btn--text"
                      data-show-all
                      (click)="showAll.emit()"
                    >
                      Show all
                    </button>
                  </p>
                }
                <p-button label="Clear filters" severity="secondary" (onClick)="clear.emit()" />
              } @else {
                <p>
                  @if (emptyParts(); as parts) {
                    <mf-copy-parts [parts]="parts" />
                  } @else {
                    {{ emptyText() || 'No ' + noun() + ' yet.' }}
                  }
                </p>
                <ng-content select="[mfEmptyAction]" />
              }
            </td>
          </tr>
        } @else {
          <ng-content />
        }
      }
    }
  `,
  styles: `
    .gb-state td {
      height: auto;
      padding: var(--mf-s5);
      text-align: center;
      background: var(--mf-surface);
    }
    .gb-state p {
      margin: 0 0 var(--mf-s2);
    }
    .gb-hint {
      color: var(--mf-text-muted);
    }
    .gb-alert {
      margin-bottom: var(--mf-s2);
      color: var(--mf-danger);
    }
    .gb-sk td {
      height: var(--mf-grid-row-h, 44px);
      padding-block: 2px;
      background: var(--mf-surface);
      vertical-align: middle;
    }
    .gb-bone {
      display: block;
      max-width: 100%;
      height: 12px;
      border-radius: 3px;
      background: var(--mf-border);
      opacity: 0.55;
    }
    @media (prefers-reduced-motion: no-preference) {
      .gb-bone {
        animation: gb-pulse 1.4s ease-in-out infinite;
      }
    }
    @keyframes gb-pulse {
      50% {
        opacity: 0.25;
      }
    }
  `,
})
export class GridBody {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private focusAfterRetry = false;

  readonly state = input.required<LoadState>();
  /** True when the loaded list has no rows. */
  readonly empty = input(false);
  /** True while a filter is active: the empty text then offers Clear filters. */
  readonly filtered = input(false);
  /**
   * The page's filters, for a list that does not report its own emptiness: while this body shows "No ... match these filters" with its
   * Clear filters button, the bar above the grid shows none (one Clear filters at a time).
   */
  readonly filters = input<ListFilters | null>(null);
  /** Records the default Status hides ("3"): a filtered empty list then says "3 inactive hidden  Show all" (the pager is not there to say it). */
  readonly hidden = input(0);
  readonly hiddenLabel = input('inactive');
  /** Plural, lowercase: "clients". */
  readonly noun = input.required<string>();
  /** First-run text; defaults to "No {noun} yet.". */
  readonly emptyText = input('');
  /** First-run text with links in it; replaces `emptyText` when set. */
  readonly emptyParts = input<readonly CopyPart[] | null>(null);
  /** Number of columns of the grid (the state row spans them). */
  readonly columns = input.required<number>();
  /** Width of the bone in each column of a skeleton row (CSS lengths); repeats when shorter than `columns`. */
  readonly skeleton = input<readonly string[]>(DEFAULT_BONES);
  /** CSS classes of the skeleton cell of each column (the classes the loaded cell has), so a column that is sized by its class keeps its width while loading. */
  readonly skeletonCells = input<readonly string[]>([]);

  protected readonly skeletonRows = SKELETON_ROWS;
  protected readonly bones = computed(() => {
    const widths = this.skeleton().length > 0 ? this.skeleton() : DEFAULT_BONES;
    return Array.from({ length: this.columns() }, (_, i) => widths[i % widths.length]);
  });

  constructor() {
    effect((onCleanup) => {
      const filters = this.filters();
      if (!filters) return;
      filters.emptyClear.set(this.state() === 'ready' && this.empty() && this.filtered());
      onCleanup(() => filters.emptyClear.set(false));
    });
    // A Retry that succeeds puts keyboard focus where the rows are.
    effect(() => {
      if (this.state() !== 'ready' || !this.focusAfterRetry) return;
      this.focusAfterRetry = false;
      afterNextRender(() => this.focusRows(), { injector: this.injector });
    });
  }

  protected onRetry(): void {
    this.focusAfterRetry = true;
    this.retry.emit();
  }

  private focusRows(): void {
    const body = this.host.nativeElement;
    const target =
      body.querySelector<HTMLElement>('tr:not(.gb-state) a[href]') ??
      body.closest<HTMLElement>('.mf-scroll-area');
    target?.focus();
  }

  readonly retry = output<void>();
  readonly clear = output<void>();
  readonly showAll = output<void>();
}
