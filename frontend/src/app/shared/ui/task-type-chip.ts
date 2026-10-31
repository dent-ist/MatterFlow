import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TaskTypeIcon } from '../icons/task-type-icon';
import { TASK_TYPE_COLOURS, isTaskTypeColour } from '../task-type/task-type-colours';

/**
 * The task type chip of My Matters (`mf-task-type-chip`, epic #953 UI-20): a 32 px rounded chip filled with the TASK TYPE's colour and a white glyph, so a type is known by colour at a glance.
 * The icon and the colour are the type's own (Task Types admin page: icon and colour picker; `TaskType.ColourKey`, ten named colours); the fills are the `--mf-tt-<colour>` tokens, white glyph
 * 3:1 or better on each (checked in `check-theme-contrast.mjs`). A type with no colour takes one of the ten by its id, always the same one. The type's name is the accessible name
 * (`role="img"`, `aria-label`) and the tooltip (`title`); `decorative` hides it where the name sits next to the chip.
 */
@Component({
  selector: 'mf-task-type-chip',
  imports: [TaskTypeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-colour]': 'colour()' },
  template: `
    <span
      class="chip"
      [style.background]="'var(--mf-tt-' + colour() + ')'"
      [attr.role]="decorative() ? null : 'img'"
      [attr.aria-label]="decorative() ? null : 'Task type: ' + name()"
      [attr.aria-hidden]="decorative() ? true : null"
      [attr.title]="decorative() || !name() ? null : name()"
    >
      <mf-task-type-icon [iconKey]="iconKey()" size="md" />
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--mf-radius-lg);
      color: var(--mf-white);
    }
    @media (forced-colors: active) {
      .chip {
        border: 1px solid CanvasText;
        background: Canvas !important;
        color: CanvasText;
      }
    }
  `,
})
export class TaskTypeChip {
  readonly iconKey = input<string | null | undefined>(undefined);
  readonly colourKey = input<string | null | undefined>(undefined);
  /** The type's id: picks the stable default colour when no colour is set. */
  readonly typeId = input<number | null | undefined>(undefined);
  readonly name = input('');
  readonly decorative = input(false);

  protected readonly colour = computed(() => {
    const k = this.colourKey();
    if (isTaskTypeColour(k)) return k;
    const id = Math.abs(this.typeId() ?? 0);
    return TASK_TYPE_COLOURS[id % TASK_TYPE_COLOURS.length].key;
  });
}
