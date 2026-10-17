import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Dismissable } from '../ui/dismissable';
import { ColumnChooser } from './column-chooser';
import { Density } from './column-prefs';
import { SortDirection } from './queue-filters';

/** Sorts whose first click goes newest first. */
const DESC_FIRST: ReadonlySet<string> = new Set(['created', 'completed', 'closed', 'updated']);

const SORT_LABELS: Readonly<Record<string, string>> = {
  priority: 'Priority',
  due: 'Due date',
  created: 'Created',
  number: 'Ref',
  status: 'Status',
  completed: 'Closed',
  closed: 'Closed',
  title: 'Title',
  matter: 'Matter',
  updated: 'Updated',
  age: 'Age',
};

/**
 * The right end of the work toolbar: a short "Sorted by Priority" note with the sort direction, an info button that opens the full
 * default rule (the shared popover rule: Esc, outside click), "Reset sort" while a header sort is active, and the Columns chooser.
 */
@Component({
  selector: 'mf-work-view-controls',
  imports: [ColumnChooser, Dismissable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './work-view-controls.scss',
  template: `
    <div class="vc-sort" data-sort-note>
      @if (grouped()) {
        <span class="vc-label" data-grouped-note
          >Grouped by due <i class="pi pi-sort-amount-up-alt" aria-hidden="true"></i
        ></span>
        <button
          type="button"
          class="mf-btn mf-btn--text"
          data-ungroup
          (click)="groupChange.emit(null)"
        >
          Remove grouping
        </button>
      } @else if (sort(); as s) {
        <span class="vc-label"
          >Sorted by {{ sortLabel() }}
          <i class="pi" [class]="dirIcon()" aria-hidden="true"></i>
          <span class="vc-sr">({{ dir() === 'desc' ? 'descending' : 'ascending' }})</span>
        </span>
        <button type="button" class="mf-btn mf-btn--text" (click)="resetSort.emit()">
          Reset sort
        </button>
      } @else {
        <span class="vc-label"
          >Sorted by {{ defaultLabel() }}
          <i class="pi pi-sort-amount-up-alt" aria-hidden="true"></i>
        </span>
        <button
          #infoBtn
          type="button"
          class="vc-info"
          aria-label="How the default order works"
          aria-controls="vc-rule"
          [attr.aria-expanded]="info()"
          (click)="info.set(!info())"
        >
          <i class="pi pi-info-circle" aria-hidden="true"></i>
        </button>
        @if (info()) {
          <p
            id="vc-rule"
            class="vc-rule"
            role="note"
            data-sort-rule
            [mfDismissable]="infoBtn"
            (dismissed)="info.set(false)"
          >
            {{ defaultOrder() }}. Choosing a column header sorts by it and replaces this order.
          </p>
        }
      }
    </div>
    @if (tabHelp(); as help) {
      <div class="vc-sort vc-tab" data-tab-help>
        <button
          type="button"
          class="vc-info"
          aria-label="About this tab"
          aria-controls="vc-tab-help"
          [attr.aria-expanded]="tabInfo()"
          (click)="tabInfo.set(!tabInfo())"
          (keydown.escape)="tabInfo.set(false)"
        >
          <i class="pi pi-question-circle" aria-hidden="true"></i>
        </button>
        @if (tabInfo()) {
          <p id="vc-tab-help" class="vc-rule" role="note" data-tab-help-text>{{ help }}</p>
        }
      </div>
    }
    <ng-content select="[tab-actions]" />
    <mf-column-chooser
      [columns]="columns()"
      [density]="density()"
      [defaults]="defaultColumns()"
      [groupable]="groupable()"
      [group]="grouped() ? 'due' : null"
      (groupChange)="groupChange.emit($event)"
      (columnsChange)="columnsChange.emit($event)"
      (densityChange)="densityChange.emit($event)"
    />
  `,
})
export class WorkViewControls {
  readonly sort = input<string | null>(null);
  readonly dir = input<SortDirection | null>(null);
  /** The full default rule, for the info popover. */
  readonly defaultOrder = input('Default order: Priority, ASAP first, Due date, Oldest');
  /** The short name of the default sort column ("Priority"). */
  readonly defaultLabel = input('Priority');
  /** The help of the current tab, behind an "About this tab" button (M3: no always-visible paragraph). */
  readonly tabHelp = input<string | null>(null);
  readonly columns = input.required<readonly string[]>();
  readonly density = input<Density>('comfortable');
  /** The current tab's default column set: when given, the Columns panel offers "Reset columns" (needs the per-tab sets of #152). */
  readonly defaultColumns = input<readonly string[] | null>(null);

  /** My Work, Active tab: the Group by choice is offered, and `grouped` says the list is grouped by due. */
  readonly groupable = input(false);
  readonly grouped = input(false);

  readonly resetSort = output<void>();
  readonly groupChange = output<'due' | null>();
  readonly columnsChange = output<string[]>();
  readonly densityChange = output<Density>();

  protected readonly info = signal(false);
  protected readonly tabInfo = signal(false);

  constructor() {
    // A popover belongs to the tab it was opened on.
    effect(() => {
      this.tabHelp();
      untracked(() => this.tabInfo.set(false));
    });
  }
  protected readonly sortLabel = computed(() => SORT_LABELS[this.sort() ?? ''] ?? this.sort());
  protected readonly dirIcon = computed(() => {
    const desc = (this.dir() ?? (DESC_FIRST.has(this.sort() ?? '') ? 'desc' : 'asc')) === 'desc';
    return desc ? 'pi-sort-amount-down' : 'pi-sort-amount-up-alt';
  });
}
