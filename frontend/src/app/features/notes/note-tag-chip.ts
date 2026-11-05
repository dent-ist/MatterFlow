import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { isTaskTypeColour } from '../../shared/task-type/task-type-colours';

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
    '[attr.data-colour]': 'key()',
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
      --tag-bg: var(--mf-tag-neutral-bg);
      --tag-fg: var(--mf-tag-neutral-fg);
      --tag-dot: var(--mf-tag-neutral-dot);
      background: var(--tag-bg);
      color: var(--tag-fg);
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
    :host([data-colour='slate']) {
      --tag-bg: var(--mf-tag-slate-bg);
      --tag-fg: var(--mf-tag-slate-fg);
      --tag-dot: var(--mf-tag-slate-dot);
    }
    :host([data-colour='blue']) {
      --tag-bg: var(--mf-tag-blue-bg);
      --tag-fg: var(--mf-tag-blue-fg);
      --tag-dot: var(--mf-tag-blue-dot);
    }
    :host([data-colour='teal']) {
      --tag-bg: var(--mf-tag-teal-bg);
      --tag-fg: var(--mf-tag-teal-fg);
      --tag-dot: var(--mf-tag-teal-dot);
    }
    :host([data-colour='green']) {
      --tag-bg: var(--mf-tag-green-bg);
      --tag-fg: var(--mf-tag-green-fg);
      --tag-dot: var(--mf-tag-green-dot);
    }
    :host([data-colour='amber']) {
      --tag-bg: var(--mf-tag-amber-bg);
      --tag-fg: var(--mf-tag-amber-fg);
      --tag-dot: var(--mf-tag-amber-dot);
    }
    :host([data-colour='orange']) {
      --tag-bg: var(--mf-tag-orange-bg);
      --tag-fg: var(--mf-tag-orange-fg);
      --tag-dot: var(--mf-tag-orange-dot);
    }
    :host([data-colour='red']) {
      --tag-bg: var(--mf-tag-red-bg);
      --tag-fg: var(--mf-tag-red-fg);
      --tag-dot: var(--mf-tag-red-dot);
    }
    :host([data-colour='rose']) {
      --tag-bg: var(--mf-tag-rose-bg);
      --tag-fg: var(--mf-tag-rose-fg);
      --tag-dot: var(--mf-tag-rose-dot);
    }
    :host([data-colour='violet']) {
      --tag-bg: var(--mf-tag-violet-bg);
      --tag-fg: var(--mf-tag-violet-fg);
      --tag-dot: var(--mf-tag-violet-dot);
    }
    :host([data-colour='indigo']) {
      --tag-bg: var(--mf-tag-indigo-bg);
      --tag-fg: var(--mf-tag-indigo-fg);
      --tag-dot: var(--mf-tag-indigo-dot);
    }
    :host(.ntag--here) {
      box-shadow: inset 0 0 0 1.5px currentcolor;
    }
    .ntag__dot {
      flex: none;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--tag-dot);
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
      background: color-mix(in srgb, currentcolor 15%, transparent);
    }
    .ntag__x .pi {
      font-size: var(--mf-icon-xs);
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
  protected readonly key = computed(() =>
    isTaskTypeColour(this.colourKey()) ? this.colourKey() : 'neutral',
  );
}
