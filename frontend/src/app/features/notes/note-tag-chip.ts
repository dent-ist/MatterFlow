import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { taskTypeChipColours } from '../../shared/task-type/task-type-colours';

/**
 * A note tag as the mockup draws it (`.tag`): a rounded chip, 24 px high, a dot and the name, in the tag's palette colour (the ten task type colours, so the
 * contrast is already proven). `here` rings it (the group the row is shown in), `removable` adds the small x of the editor, `inactive` marks a tag an administrator
 * has switched off. Colour is never the only signal: the name is always written.
 */
@Component({
  selector: 'mf-note-tag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ntag',
    '[class.ntag--here]': 'here()',
    '[style.background]': 'colours().bg',
    '[style.color]': 'colours().fg',
  },
  template: `
    <i class="ntag__dot" aria-hidden="true"></i>
    <span class="ntag__name">{{ name() }}</span>
    @if (inactive()) {
      <span class="ntag__off">(inactive)</span>
    }
    @if (removable()) {
      <button
        type="button"
        class="ntag__x"
        [attr.aria-label]="'Remove tag ' + name()"
        (click)="removed.emit()"
      >
        <i class="pi pi-times" aria-hidden="true"></i>
      </button>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      max-width: 100%;
      height: 24px;
      padding: 0 10px 0 8px;
      border-radius: var(--mf-radius-pill);
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      white-space: nowrap;
    }
    :host(.ntag--here) {
      box-shadow: inset 0 0 0 1.5px currentcolor;
    }
    .ntag__dot {
      flex: none;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentcolor;
    }
    .ntag__name {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ntag__off {
      font-weight: 500;
    }
    .ntag__x {
      display: grid;
      place-items: center;
      width: 18px;
      height: 18px;
      margin: 0 -6px 0 0;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: none;
      color: inherit;
      cursor: pointer;
    }
    .ntag__x:hover {
      background: rgb(0 0 0 / 12%);
    }
    .ntag__x .pi {
      font-size: 0.65rem;
    }
  `,
})
export class NoteTagChip {
  readonly name = input.required<string>();
  readonly colourKey = input<string | null | undefined>(null);
  readonly here = input(false);
  readonly removable = input(false);
  readonly inactive = input(false);
  readonly removed = output<void>();
  protected readonly colours = computed(() => taskTypeChipColours(this.colourKey()));
}
