import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * Chip kind 4 of the four (D-12, #1129): the tag / scope chip. A word the user chose or a scope that applies: 26 px high, pill, `--mf-surface` with a `--mf-border-mid` outline, 13 px
 * text that never wraps. With `removable` it ends in a 16 px remove button (`pi-times` at `--mf-icon-xs`) whose accessible name is "Remove <name>" (`removeLabel` replaces
 * the whole name when the page needs other words). The text is the content; `muted` is the quiet "+3 more" look.
 *
 *   <mf-tag-chip name="Privileged" removable (remove)="drop('Privileged')">Privileged</mf-tag-chip>
 */
@Component({
  selector: 'mf-tag-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="tg" [class.tg--muted]="muted()" [class.tg--removable]="removable()">
      <span class="tg__text"><ng-content /></span>
      @if (removable()) {
        <button
          type="button"
          class="tg__x"
          [attr.aria-label]="removeName()"
          [attr.title]="removeName()"
          [attr.data-remove]="removeKey()"
          (click)="remove.emit(); $event.stopPropagation()"
        >
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      }
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      min-width: 0;
      max-width: 100%;
    }
    .tg {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      box-sizing: border-box;
      min-width: 0;
      max-width: 100%;
      height: var(--mf-chip-h);
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-mid);
      border-radius: var(--mf-radius-pill);
      background: var(--mf-surface);
      color: var(--mf-text);
      font-size: var(--mf-fs-sm);
      line-height: 1;
      white-space: nowrap;
    }
    .tg--removable {
      padding-right: var(--mf-s1);
    }
    .tg--muted {
      background: transparent;
      color: var(--mf-text-muted);
    }
    .tg__text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tg__x {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: 16px;
      height: 16px;
      padding: 0;
      border: 0;
      border-radius: var(--mf-radius-pill);
      background: transparent;
      color: var(--mf-text-muted);
      cursor: pointer;
    }
    .tg__x:hover {
      background: var(--mf-surface-alt);
      color: var(--mf-text);
    }
    .tg__x .pi {
      font-size: var(--mf-icon-xs);
    }
  `,
})
export class TagChip {
  /** The tag's text for the accessible name of the remove button. */
  readonly name = input('');
  /** Draws the 16 px remove button; `remove` fires when it is pressed. */
  readonly removable = input(false);
  /** Replaces "Remove <name>" as the remove button's accessible name. */
  readonly removeLabel = input<string | null>(null);
  /** Names this chip for tests and focus return: the remove button carries it as `data-remove`. */
  readonly removeKey = input<string | number | null>(null);
  /** The quiet look (no fill, muted text) for "+3 more". */
  readonly muted = input(false);
  readonly remove = output<void>();

  protected readonly removeName = computed(() => this.removeLabel() ?? `Remove ${this.name()}`);
}
