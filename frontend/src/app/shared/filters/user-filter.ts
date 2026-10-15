import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FilterOption } from './filter-def';
import { ColumnMultiselectFilter } from './multiselect-filter';

/**
 * User picker column filter (Assignee, Creator, Actor): the multi-select with "Me" and the special choices ("Unassigned") on top and
 * inactive people marked "(inactive)" but still selectable (they remain valid in historical filters). `users` holds `{ value: userId,
 * label: name }` and `inactive` names the ids to mark.
 */
@Component({
  selector: 'mf-column-user-filter',
  imports: [ColumnMultiselectFilter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-column-multiselect-filter
      [label]="label()"
      [key]="key()"
      [options]="all()"
      [value]="value()"
      [inline]="inline()"
      [disabled]="disabled()"
      [emptyLabel]="emptyLabel()"
      (valueChange)="valueChange.emit($event)"
    />
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
  `,
})
export class ColumnUserFilter {
  readonly label = input.required<string>();
  readonly key = input('');
  readonly users = input.required<readonly FilterOption[]>();
  /** The signed-in user's id as an option value; shown first as "Me". */
  readonly meValue = input<string | null>(null);
  /** Choices such as "Unassigned", before the people. */
  readonly specials = input<readonly FilterOption[]>([]);
  /** Ids (option values) of people who are no longer active. */
  readonly inactive = input<readonly string[]>([]);
  readonly value = input<readonly string[]>([]);
  readonly emptyLabel = input('Any');
  readonly inline = input(false);
  readonly disabled = input(false);
  readonly valueChange = output<string[]>();

  protected readonly all = computed<FilterOption[]>(() => {
    const me = this.meValue();
    const inactive = this.inactive();
    const people = this.users().map((u) =>
      inactive.includes(u.value) ? { ...u, hint: '(inactive)' } : u,
    );
    const mine = me ? people.find((u) => u.value === me) : undefined;
    return [
      ...(me ? [{ value: me, label: 'Me', hint: mine ? `(${mine.label})` : undefined }] : []),
      ...this.specials(),
      ...people.filter((u) => u.value !== me),
    ];
  });
}
