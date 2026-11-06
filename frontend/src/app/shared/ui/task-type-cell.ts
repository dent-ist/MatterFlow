import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TaskTypeChip } from './task-type-chip';

/**
 * The Type cell of every grid that lists tasks (`mf-task-type-cell`, #1232): the shared coloured task type chip and the task type's NAME beside it, one line, regular 14 px, cut
 * with an ellipsis when the column is narrow; the full name is the tooltip. In a column narrower than about 100 px the name is hidden visually (it stays in the page for assistive
 * tools) and only the tile shows. One component for Task Queue, My Work, Pod Work, Matter and Project Tasks, the Dashboard Summary grid and the Search task hits: no per-page variant.
 *
 *   <mf-task-type-cell [name]="row.taskTypeName" [iconKey]="row.taskTypeIconKey" [colourKey]="row.taskTypeColourKey" [typeId]="row.taskTypeId" />
 */
@Component({
  selector: 'mf-task-type-cell',
  imports: [TaskTypeChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="ttc" [attr.title]="name() || null">
      <mf-task-type-chip
        data-type-chip
        [size]="size()"
        [iconKey]="iconKey()"
        [colourKey]="colourKey()"
        [typeId]="typeId()"
        [decorative]="true"
      />
      <span class="ttc__name" data-type-name>{{ name() }}</span>
    </span>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      container: ttc / inline-size;
    }
    .ttc {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .ttc__name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--mf-fs-md);
      font-weight: 400;
    }
    /* A very narrow column (below about 100 px of cell): the tile alone, the name stays for assistive tools and in the tooltip. */
    @container ttc (max-width: 99px) {
      .ttc__name {
        position: absolute;
        width: 1px;
        height: 1px;
        clip-path: inset(50%);
      }
    }
  `,
})
export class TaskTypeCell {
  readonly name = input('');
  readonly iconKey = input<string | null | undefined>(undefined);
  readonly colourKey = input<string | null | undefined>(undefined);
  readonly typeId = input<number | null | undefined>(undefined);
  /** 32 px tile (default) or the 24 px tile of a compact row. */
  readonly size = input<'md' | 'sm'>('md');
}
