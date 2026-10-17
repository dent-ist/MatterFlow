import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Button } from 'primeng/button';
import { CopyParts, CopyPart } from './copy-parts';
import { LoadState } from './data-table';
import { ErrorReference } from './error-reference';

/**
 * The body of a filtered grid: the rows (projected) while the list is ready, and a single full-width row for loading, error and empty,
 * so the column headers and the filter row stay on screen in every state (`mf-list-state` replaces the whole table).
 *
 *   <tbody mfGridBody noun="clients" [state]="state()" [empty]="rows().length === 0" [filtered]="filters.activeCount() > 0"
 *          [columns]="4" (retry)="load()" (clear)="clear()">
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
  template: `
    @switch (state()) {
      @case ('loading') {
        <tr class="gb-state">
          <td [attr.colspan]="columns()" role="status" aria-busy="true" data-loading>
            Loading {{ noun() }}...
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
            <p-button label="Retry" severity="secondary" (onClick)="retry.emit()" />
          </td>
        </tr>
      }
      @default {
        @if (empty()) {
          <tr class="gb-state">
            <td [attr.colspan]="columns()" [attr.data-empty]="filtered() ? 'filtered' : 'none'">
              @if (filtered()) {
                <p>No {{ noun() }} match these filters</p>
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
    .gb-alert {
      margin-bottom: var(--mf-s2);
      color: var(--mf-danger);
    }
  `,
})
export class GridBody {
  readonly state = input.required<LoadState>();
  /** True when the loaded list has no rows. */
  readonly empty = input(false);
  /** True while a filter is active: the empty text then offers Clear filters. */
  readonly filtered = input(false);
  /** Plural, lowercase: "clients". */
  readonly noun = input.required<string>();
  /** First-run text; defaults to "No {noun} yet.". */
  readonly emptyText = input('');
  /** First-run text with links in it; replaces `emptyText` when set. */
  readonly emptyParts = input<readonly CopyPart[] | null>(null);
  /** Number of columns of the grid (the state row spans them). */
  readonly columns = input.required<number>();

  readonly retry = output<void>();
  readonly clear = output<void>();
}
