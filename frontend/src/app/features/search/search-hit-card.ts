import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { SearchHit } from '../../api/generated/api-client';
import { SuggestionLines, suggestionLines } from '../../shared/search/search-meta';
import { ActiveBadge, SensitiveBadge } from '../../shared/ui/badge';
import { RecordCard } from '../../shared/ui/record-card-list';
import { StatusBadge } from '../../shared/ui/status-badge';
import { TaskOriginLinks } from '../../shared/work-queue/task-origin';

/**
 * What a hit card says on its meta line: the reference (monospace, none for a project or an asset) and the muted context. It is the field map of
 * the suggestion panel (`suggestionLines`: matter and client first, an asset's URL never as text) with the status taken out, because the card shows
 * the status as a badge. The grid columns of the results page (#468) read the same map, so a new searchable type adds one entry in one place.
 */
export function hitCardLines(hit: SearchHit): SuggestionLines {
  return suggestionLines({ ...hit, status: null });
}

/**
 * One search hit as a card (Search review S3, #472): the name is the one link (two lines at most, the full text as tooltip), the Active or Inactive
 * badge or the task status and the Sensitive marker (the Sensitive badge on a matter, a lock named "Sensitive matter" on the other types, as in the
 * suggestion panel) at the top right, and one meta line with the reference and the muted context (client, or matter number and name). The same
 * card serves all five types. It sits in the `<ng-template [mfRecordCard]>` of `mf-record-card-list`:
 *
 *   <mf-record-card-list noun="results" label="Matters" ...>
 *     <ng-template [mfRecordCard]="hits()" let-hit><mf-search-hit-card [hit]="hit" /></ng-template>
 *   </mf-record-card-list>
 *
 * A task link remembers the results page as its origin (Back returns to the row), like the table. The card is at least 64 px high and the whole card
 * is the target of the name link, so the touch target is well over 44 px.
 */
@Component({
  selector: 'mf-search-hit-card',
  imports: [RecordCard, ActiveBadge, SensitiveBadge, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The record card is the grid item of the list's `<li>`; this wrapper adds no box.
  host: { style: 'display: contents' },
  styles: `
    .hc-lock {
      flex: none;
      align-self: center;
      font-size: var(--mf-fs-xs);
    }
    .hc-context {
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `,
  template: `
    <mf-record-card
      [name]="hit().label"
      [link]="hit().path"
      [queryParams]="task() ? origin.params('search') : undefined"
      [state]="task() ? origin.state() : undefined"
      [list]="task() ? 'search' : ''"
      [rowKey]="hit().id"
    >
      @if (hit().type === 'matter' && hit().isSensitive) {
        <mf-sensitive-badge mfCardBadges />
      }
      @if (hit().status; as status) {
        <mf-status-badge mfCardBadges [code]="status" />
      }
      @if (!hit().status) {
        <mf-active-badge mfCardBadges [active]="hit().isActive" />
      }
      @if (lines().reference || lines().context.length > 0 || lines().lock) {
        <p mfCardMeta class="rc-line" data-card-meta [attr.title]="lines().tooltip">
          @if (lines().lock) {
            <i
              class="pi pi-lock hc-lock"
              role="img"
              aria-label="Sensitive matter"
              data-sensitive-marker
            ></i>
          }
          @if (lines().reference; as reference) {
            <span class="rc-ref" data-card-reference>{{ reference }}</span>
          }
          @if (lines().reference && lines().context.length > 0) {
            <span class="rc-sep" aria-hidden="true">-</span><span class="mf-sr-only">, </span>
          }
          @if (lines().context.length > 0) {
            <span class="rc-text hc-context" data-card-context>{{
              lines().context.join(' · ')
            }}</span>
          }
        </p>
      }
    </mf-record-card>
  `,
})
export class SearchHitCard {
  protected readonly origin = inject(TaskOriginLinks);

  readonly hit = input.required<SearchHit>();

  protected readonly lines = computed(() => hitCardLines(this.hit()));
  protected readonly task = computed(() => this.hit().type === 'task');
}
