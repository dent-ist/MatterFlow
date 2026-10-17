import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  output,
} from '@angular/core';
import { RowGroup } from './due-groups';

/**
 * The header row of a due group (M12.1): a non-interactive `<tr>` whose `th scope="colgroup"` spans the table and holds the one button that
 * collapses the group. The button names the group and its whole count ("Overdue (9 tasks)", "Overdue (9 tasks), continued" at the top of the
 * next page) and says whether the rows are shown (`aria-expanded`). It sticks under the column headers (global styles, `_fixed-page.scss`).
 */
@Component({
  // An attribute selector on the native <tr>, so the table keeps its semantics.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'tr[mfGroupHeader]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: 'wt-group', '[attr.data-group]': 'group().key' },
  template: `
    <th scope="colgroup" [attr.colspan]="columns()">
      <button
        type="button"
        class="wt-group__btn"
        [attr.aria-expanded]="collapsed() ? 'false' : 'true'"
        (click)="toggled.emit()"
      >
        <i
          class="pi"
          [class.pi-chevron-down]="!collapsed()"
          [class.pi-chevron-right]="collapsed()"
          aria-hidden="true"
        ></i>
        <span class="wt-group__text"
          ><span class="wt-group__name">{{ group().label }}</span
          >{{ ' '
          }}<span class="wt-group__count"
            >({{ group().count
            }}<span class="mf-sr-only"> {{ group().count === 1 ? 'task' : 'tasks' }}</span
            >)</span
          >
          @if (group().continued) {
            <span class="wt-group__more">, continued</span>
          }
        </span>
      </button>
    </th>
  `,
})
export class GroupHeader {
  readonly group = input.required<RowGroup>();
  readonly columns = input.required<number>();
  readonly collapsed = input(false);
  readonly toggled = output<void>();
}
