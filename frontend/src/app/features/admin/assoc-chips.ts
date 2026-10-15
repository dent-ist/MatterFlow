import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** One associated record: a workflow on a task type row, a task type on a workflow row. */
export interface AssocItem {
  id: number;
  label: string;
  /** Router link of the record; absent when the person may not open it (plain text). */
  link?: string | readonly unknown[];
  /** Shown with a star and the text "default". */
  isDefault?: boolean;
  /** Deactivated record: muted, with "(inactive)". */
  inactive?: boolean;
}

/**
 * The association chips of the Task Types, Workflows and Workflow Steps lists (task type -> eligible workflows -> steps): the first
 * `max` records as small links (the default one with a star and the text "default"), then "+n more" that opens the filtered list in the
 * other tab (`moreLink` + `moreQuery`). `allLabel` adds a "Workflows (n)" link to the same place. An empty list shows `emptyText`,
 * as a warning when `emptyWarning` is set. The links are plain anchors, so they work with the keyboard and open in a new tab.
 */
@Component({
  selector: 'mf-assoc-chips',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length === 0) {
      <span class="ac__empty" [class.ac__empty--warn]="emptyWarning()" data-assoc-empty>
        @if (emptyWarning()) {
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
        }
        {{ emptyText() }}
      </span>
    } @else {
      <ul class="ac" [attr.aria-label]="label()" data-assoc>
        @for (i of shown(); track i.id) {
          <li class="ac__chip" [class.ac__chip--off]="i.inactive" [attr.data-assoc-chip]="i.label">
            @if (i.isDefault) {
              <i class="pi pi-star-fill ac__star" aria-hidden="true"></i>
            }
            @if (i.link) {
              <a class="ac__link" [routerLink]="i.link" [attr.title]="i.label">{{ i.label }}</a>
            } @else {
              <span class="ac__text" [attr.title]="i.label">{{ i.label }}</span>
            }
            @if (i.isDefault) {
              <span class="ac__tag" data-assoc-default>default</span>
            }
            @if (i.inactive) {
              <span class="ac__tag">(inactive)</span>
            }
          </li>
        }
        @if (hiddenCount() > 0) {
          <li class="ac__more">
            @if (moreLink(); as link) {
              <a
                class="ac__link"
                data-assoc-more
                [routerLink]="link"
                [queryParams]="moreQuery()"
                [attr.aria-label]="
                  'Show all ' + items().length + ' ' + noun() + ' (' + hiddenCount() + ' more)'
                "
                >+{{ hiddenCount() }} more</a
              >
            } @else {
              <span class="ac__tag" data-assoc-more>+{{ hiddenCount() }} more</span>
            }
          </li>
        }
      </ul>
      @if (allLabel() && moreLink()) {
        <a class="ac__all" data-assoc-all [routerLink]="moreLink()" [queryParams]="moreQuery()"
          >{{ allLabel() }} ({{ items().length }})</a
        >
      }
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .ac {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .ac__chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      box-sizing: border-box;
      max-width: 20rem;
      min-height: 24px;
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
      background: var(--mf-surface-alt);
      color: var(--mf-text);
      font-size: var(--mf-fs-xs);
      line-height: 1.5;
    }
    .ac__chip--off {
      color: var(--mf-text-muted);
    }
    .ac__link,
    .ac__text {
      display: block;
      min-width: 0;
      /* Links are 24px tall (WCAG 2.2 target size); a long label is cut with an ellipsis. */
      line-height: 24px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ac__link,
    .ac__all {
      color: var(--mf-link);
    }
    .ac__star {
      color: var(--mf-text);
      font-size: 0.6875rem;
    }
    .ac__tag {
      flex: none;
      color: var(--mf-text-muted);
    }
    .ac__more {
      display: inline-flex;
      align-items: center;
      font-size: var(--mf-fs-xs);
    }
    .ac__all {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      font-size: var(--mf-fs-xs);
    }
    .ac__empty {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .ac__empty--warn {
      color: var(--mf-warning);
    }
  `,
})
export class AssocChips {
  readonly items = input<readonly AssocItem[]>([]);
  /** Chips shown before "+n more". */
  readonly max = input(3);
  /** Accessible name of the list ("Workflows of Data Processing"). */
  readonly label = input('Associated records');
  /** Plural noun for the "+n more" link's name ("workflows"). */
  readonly noun = input('records');
  /** Where "+n more" and the "(n)" link go, and with which query (the filter that limits the other tab to this record); null = plain text. */
  readonly moreLink = input<string | readonly unknown[] | null>('/');
  readonly moreQuery = input<Record<string, string | number>>({});
  /** "Workflows": adds a "Workflows (n)" link after the chips. */
  readonly allLabel = input('');
  readonly emptyText = input('None');
  readonly emptyWarning = input(false);

  protected readonly shown = computed(() => this.items().slice(0, this.max()));
  protected readonly hiddenCount = computed(() => Math.max(0, this.items().length - this.max()));
}
