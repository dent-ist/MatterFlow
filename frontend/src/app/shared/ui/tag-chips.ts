import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TagChip } from './tag-chip';

/**
 * Read-only tags as chips (step library list and the workflow designer's step picker). Shows the first `max` tags and "+n more" for the
 * rest; each chip is cut with an ellipsis when it is very long (its full text is the tooltip). Screen readers get every tag: the hidden
 * ones are spelled out after the chips. Nothing is rendered for a step without tags.
 */
@Component({
  selector: 'mf-tag-chips',
  imports: [TagChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tags().length > 0) {
      <ul class="tc" [attr.aria-label]="label()" data-tags>
        @for (tag of shown(); track tag) {
          <li class="tc__item" [attr.title]="tag" [attr.data-tag]="tag">
            <mf-tag-chip>{{ tag }}</mf-tag-chip>
          </li>
        }
        @if (hidden().length > 0) {
          <li class="tc__item" [attr.title]="hidden().join(', ')" data-tags-more>
            <mf-tag-chip [muted]="true">
              <span aria-hidden="true">+{{ hidden().length }} more</span>
              <span class="tc__sr">and {{ hidden().length }} more: {{ hidden().join(', ') }}</span>
            </mf-tag-chip>
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
    .tc__item {
      display: flex;
      min-width: 0;
      max-width: 12rem;
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
