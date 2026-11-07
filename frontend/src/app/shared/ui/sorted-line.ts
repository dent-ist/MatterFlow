import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { SortKind, directionWords } from '../work-queue/sort-sentences';
import { Dismissable } from './dismissable';
import { parseSortExpression } from './record-sort';

/** The words of a list's sortable columns (its `sortOptions`) as the labels of the line. */
export function sortLabelsOf(
  options: readonly { value: string; label: string }[],
): Record<string, string> {
  return Object.fromEntries(options.map((o) => [o.value, o.label]));
}

/**
 * "Sorted by Name, A to Z": the sentence of one sort (the words of the field come from the page's own column names). A list whose columns are not the
 * known work-list fields (a report's columns) says what kind each one is in `kinds`, so a number reads "lowest first", not "A to Z" (#1289).
 */
export function sortSentence(
  field: string,
  dir: 'asc' | 'desc',
  labels: Readonly<Record<string, string>>,
  kinds?: Readonly<Record<string, SortKind>>,
): string {
  return `Sorted by ${labels[field] ?? field}, ${directionWords(field, dir, kinds?.[field])}`;
}

/**
 * The "Sorted by X" line with "Reset sort" (LC-01, decision AR 3; #1126): row 2 of every list toolbar, right before Columns. The line is short ("Sorted by Name"); the full sentence with the direction ("Sorted by Name, A to Z") is its tooltip. It always says how the
 * list is sorted, the default order included ("Sorted by Name, A to Z"); "Reset sort" shows only while the person has chosen a sort of their own,
 * and returns the list to its default. A list sorts by its column headers (Enter or Space on the header button): the line adds no control for it
 * and no shortcut (#420).
 *
 * Two ways to say the sort: `sort` as the address carries it (`-openTasks`, record lists) with `defaultSort`, or `field` and `dir` (work lists).
 *
 *   <mf-sorted-line mfBarEnd [sort]="sort()" defaultSort="clientNumber" [labels]="sortLabels" (resetSort)="pickSort(null)" />
 */
@Component({
  selector: 'mf-sorted-line',
  imports: [Dismissable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.sl--default]': '!custom() && !grouped()' },
  template: `
    <span class="sl" data-sorted-line data-sort-note>
      @if (grouped()) {
        <span class="sl__text" data-grouped-note>Grouped by due</span>
        <button
          type="button"
          class="mf-btn mf-btn--text"
          data-ungroup
          (click)="groupChange.emit(null)"
        >
          Remove Grouping
        </button>
      } @else {
        <span class="sl__text" data-sorted-text [attr.title]="sentence()">{{
          shortSentence()
        }}</span>
      }
      @if (grouped()) {
        <!-- The grouping is the order: nothing to reset. -->
      } @else if (custom()) {
        <button
          type="button"
          class="mf-btn mf-btn--text"
          data-reset-sort
          (click)="resetSort.emit()"
        >
          Reset Sort
        </button>
      } @else if (rule()) {
        <button
          #infoBtn
          type="button"
          class="sl__info"
          aria-label="How the default order works"
          aria-controls="sl-rule"
          [attr.aria-expanded]="info()"
          (click)="info.set(!info())"
        >
          <i class="pi pi-info-circle" aria-hidden="true"></i>
        </button>
        @if (info()) {
          <p
            id="sl-rule"
            class="sl__rule"
            role="note"
            data-sort-rule
            [mfDismissable]="infoBtn"
            (dismissed)="info.set(false)"
          >
            {{ rule() }}. Choosing a column header sorts by it and replaces this order.
          </p>
        }
      }
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      min-width: 0;
    }
    .sl {
      position: relative;
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-start;
      min-width: 0;
      gap: 0 var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    /* In the toolbar row the sentence stays on one line and ends in an ellipsis when the row is short; the title has the whole sentence. */
    :host-context(.lt:not(.lt--row3)) .sl {
      flex-wrap: nowrap;
    }
    :host-context(.lt:not(.lt--row3)) .sl__text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sl__info {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--mf-target-min);
      height: var(--mf-target-min);
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--mf-text-muted);
      cursor: pointer;
    }
    .sl__rule {
      position: absolute;
      z-index: 20;
      top: calc(100% + var(--mf-s1));
      right: 0;
      width: max-content;
      max-width: min(24rem, 90vw);
      margin: 0;
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      box-shadow: var(--mf-shadow-pop);
    }
    /* A phone has no column headers to sort by: the Sort by select of its Filters sheet names the order. The line shows only for a chosen sort (with Reset sort). */
    @media (width < 640px) {
      :host(.sl--default) {
        display: none;
      }
    }
    @media print {
      :host {
        display: none;
      }
    }
  `,
})
export class SortedLine {
  /** The `sort` of the address (`name`, `-openTasks`); empty or null is the default order. */
  readonly sort = input<string | null | undefined>(null);
  /** The sort field the list opens with (ascending unless `defaultDir` says otherwise). */
  readonly defaultSort = input('');
  readonly defaultDir = input<'asc' | 'desc'>('asc');
  /** Work lists: the chosen field and direction, already parsed (null: the default order). */
  readonly field = input<string | null>(null);
  readonly dir = input<'asc' | 'desc' | null>(null);
  /** Field to the words of the column ("number": "Ref"). */
  readonly labels = input<Readonly<Record<string, string>>>({});
  /** Field to the kind of its values (the words of the direction); a field that is not here is read by its name as in the work lists. */
  readonly kinds = input<Readonly<Record<string, SortKind>>>({});
  /** A default order that is not one column (the Task Queue's urgency order): its whole sentence, "Priority, most urgent first". */
  readonly defaultText = input('');
  /** The full rule of such a default order, behind an info button. */
  readonly rule = input('');
  /** My Work, Active tab, grouped by due: the line says so (and offers to remove the grouping) instead of naming a sort. */
  readonly grouped = input(false);
  readonly resetSort = output<void>();
  readonly groupChange = output<null>();

  protected readonly info = signal(false);
  private readonly chosen = computed(() => {
    const own = this.field();
    if (own) return { field: own, dir: this.dir() ?? ('asc' as const) };
    return parseSortExpression(this.sort());
  });
  /** The person has chosen a sort of their own (so there is something to reset). */
  protected readonly custom = computed(() => !!this.chosen());
  /** What the line shows: "Sorted by Load"; the full sentence with the direction is its tooltip (#1126). */
  protected readonly shortSentence = computed(() => {
    const own = this.chosen();
    if (own) return `Sorted by ${this.labels()[own.field] ?? own.field}`;
    if (this.defaultText()) return `Sorted by ${this.defaultText().split(',')[0]}`;
    return `Sorted by ${this.labels()[this.defaultSort()] ?? this.defaultSort()}`;
  });
  protected readonly sentence = computed(() => {
    const own = this.chosen();
    if (own) return sortSentence(own.field, own.dir, this.labels(), this.kinds());
    if (this.defaultText()) return `Sorted by ${this.defaultText()} (default order)`;
    return sortSentence(this.defaultSort(), this.defaultDir(), this.labels(), this.kinds());
  });
}
