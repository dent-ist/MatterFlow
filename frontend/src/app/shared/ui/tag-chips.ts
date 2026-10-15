import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Read-only tags as chips (step library list and the workflow designer's step picker). Shows the first `max` tags and "+n more" for the
 * rest; each chip is cut with an ellipsis when it is very long (its full text is the tooltip). Screen readers get every tag: the hidden
 * ones are spelled out after the chips. Nothing is rendered for a step without tags.
 */
@Component({
  selector: 'mf-tag-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tags().length > 0) {
      <ul class="tc" [attr.aria-label]="label()" data-tags>
        @for (tag of shown(); track tag) {
          <li class="tc__chip" [attr.title]="tag" [attr.data-tag]="tag">{{ tag }}</li>
        }
        @if (hidden().length > 0) {
          <li class="tc__chip tc__more" [attr.title]="hidden().join(', ')" data-tags-more>
            <span aria-hidden="true">+{{ hidden().length }} more</span>
            <span class="tc__sr">and {{ hidden().length }} more: {{ hidden().join(', ') }}</span>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .tc {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .tc__chip {
      box-sizing: border-box;
      max-width: 12rem;
      padding: 1px var(--mf-s2);
      overflow: hidden;
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
      background: var(--mf-surface-alt);
      color: var(--mf-text);
      font-size: var(--mf-fs-xs);
      line-height: 1.5;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tc__more {
      background: transparent;
      color: var(--mf-text-muted);
    }
    .tc__sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class TagChips {
  readonly tags = input<readonly string[]>([]);
  /** How many chips to show before "+n more". */
  readonly max = input(3);
  readonly label = input('Tags');

  protected readonly shown = computed(() => this.tags().slice(0, this.max()));
  protected readonly hidden = computed(() => this.tags().slice(this.max()));
}
