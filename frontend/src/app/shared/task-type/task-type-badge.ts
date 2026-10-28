import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TaskTypeIcon } from '../icons/task-type-icon';
import { taskTypeChipColours } from './task-type-colours';

let nextId = 0;

/**
 * The one way a task type shows in a list (`mf-task-type-badge`, PM v2 #854): the type's icon in a chip tinted with its palette colour
 * (`TaskType.ColourKey`, ten named colours, neutral when none). Colour is never the only signal: the icon is always drawn and the name is available
 * three ways.
 *   - compact (default): a 24 px chip with `role="img"` and `aria-label="Task type: Production (Outgoing)"`, and the name as the mouse tooltip (`title`).
 *     A tooltip on a chip nobody can focus is invisible to the keyboard, so the badge also renders the same sentence as visually hidden text with an id
 *     (`descriptionId`); the focusable owner of the row (its link) points at it with `aria-describedby`, so a keyboard or screen reader user hears it.
 *   - wide: the chip plus the visible name; the chip is then decorative (`aria-hidden`) because the name sits next to it.
 * Under forced colours the tint falls away and the icon and a border use the system colours.
 */
@Component({
  selector: 'mf-task-type-badge',
  imports: [TaskTypeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-variant]': 'variant()',
    '[attr.data-colour]': 'colourKey() || null',
    '[class.tt--large]': 'large()',
  },
  template: `
    @if (variant() === 'wide' || decorative()) {
      <span
        class="tt-chip"
        [style.background]="colours().bg"
        [style.color]="colours().fg"
        aria-hidden="true"
      >
        <mf-task-type-icon [iconKey]="iconKey()" [size]="large() ? 'md' : 'sm'" />
      </span>
      @if (variant() === 'wide') {
        <span class="name" data-type-name>{{ name() }}</span>
      }
    } @else {
      <span
        class="tt-chip"
        role="img"
        [attr.aria-label]="sentence()"
        [attr.title]="name() || null"
        [style.background]="colours().bg"
        [style.color]="colours().fg"
        data-type-badge
      >
        <mf-task-type-icon [iconKey]="iconKey()" [size]="large() ? 'md' : 'sm'" />
      </span>
      <span class="mf-sr-only" [id]="descriptionId" data-type-description>{{ sentence() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      min-width: 0;
      max-width: 100%;
      align-items: center;
      gap: var(--mf-s2);
      vertical-align: middle;
    }
    :host([data-variant='wide']) {
      flex: 0 1 auto;
    }
    .tt-chip {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 1.5rem;
      height: 1.5rem;
      border-radius: var(--mf-radius);
      border: 1px solid transparent;
    }
    /* A list row that leans on the icon and its colour (the My Matters rows, issue #897): a 28 px chip with the 20 px icon, so the colour reads. */
    :host(.tt--large) .tt-chip {
      width: 1.75rem;
      height: 1.75rem;
    }
    .name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @media (forced-colors: active) {
      .tt-chip {
        border-color: CanvasText;
        background: Canvas !important;
        color: CanvasText !important;
      }
    }
  `,
})
export class TaskTypeBadge {
  /** The type's icon key; missing or unknown shows the default icon. */
  readonly iconKey = input<string | null | undefined>(undefined);
  /** The type's palette colour name; missing is the neutral default. */
  readonly colourKey = input<string | null | undefined>(undefined);
  /** The type's name: the accessible name, the tooltip and (wide) the visible text. */
  readonly name = input<string>('');
  readonly variant = input<'compact' | 'wide'>('compact');
  /** True where the name sits right next to the badge (an admin list): the chip is then decorative, with no label, tooltip or description. */
  readonly decorative = input(false);
  /** A 28 px chip with a 20 px icon instead of 24 px with 16 px, for a row where the icon is the type's main signal. */
  readonly large = input(false);

  /** The id of the visually hidden sentence; give it to the owner's `aria-describedby` (`#tt` then `[attr.aria-describedby]="tt.descriptionId"`). */
  readonly descriptionId = `mf-tt-${++nextId}`;

  protected readonly colours = computed(() => taskTypeChipColours(this.colourKey()));
  protected readonly sentence = computed(() =>
    this.name() ? `Task type: ${this.name()}` : 'Task type',
  );
}
