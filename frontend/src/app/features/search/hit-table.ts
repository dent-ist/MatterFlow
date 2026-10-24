import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RowLink } from '../../shared/ui/row-nav';
import { TaskOriginLinks } from '../../shared/work-queue/task-origin';
import { SearchHit } from '../../api/generated/api-client';
import { highlightParts } from '../../shared/search/search-meta';
import { MatterRef } from '../../shared/ui/matter-ref';
import { StatusBadge } from '../../shared/ui/status-badge';
import { ActiveBadge, SensitiveBadge } from '../../shared/ui/badge';

/**
 * The table of search results shared by the results page and Advanced Search: reference, name (a link, with the typed text highlighted), details,
 * the Matter it belongs to (with a copy button and the sensitive-matter badge, addendum O) and the status.
 */
@Component({
  selector: 'mf-search-hit-table',
  imports: [ActiveBadge, SensitiveBadge, RouterLink, RowLink, MatterRef, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../shared/ui/page.scss',
  styles: `
    mf-sensitive-badge {
      margin-left: var(--mf-s2);
    }
    mark {
      background: transparent;
      color: inherit;
      font-weight: 700;
      text-decoration: underline;
    }
    .hit-other {
      margin-left: var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      white-space: nowrap;
    }
    .hit-matter mf-sensitive-badge {
      margin-left: 0;
    }
    .hit-matter {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      flex-wrap: wrap;
    }
  `,
  template: `
    <div class="mf-scroll">
      <table class="pg-table" data-hit-table>
        <caption class="pg-sr">
          {{
            caption()
          }}
        </caption>
        <thead>
          <tr>
            @if (has('reference')) {
              <th scope="col">Reference</th>
            }
            <th scope="col">{{ nameHeading() }}</th>
            @if (has('details')) {
              <th scope="col">{{ detailsHeading() }}</th>
            }
            @if (has('matter')) {
              <th scope="col">Matter</th>
            }
            @if (has('matterName')) {
              <th scope="col">Matter name</th>
            }
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          @for (hit of hits(); track hit.type + hit.id) {
            <tr data-hit-row>
              @if (has('reference')) {
                <td class="pg-mono">
                  @if (hit.reference) {
                    <!-- The same destination as the name link; kept out of the tab order and the reading order so it is not announced twice. -->
                    <a
                      class="pg-link"
                      [routerLink]="hit.path"
                      [queryParams]="hit.type === 'task' ? origin.params('search') : null"
                      [state]="hit.type === 'task' ? origin.state() : undefined"
                      tabindex="-1"
                      aria-hidden="true"
                      >{{ hit.reference }}</a
                    >
                  }
                </td>
              }
              <td>
                <!-- A task result remembers this view (T9, #324): its Back link and crumb return here and focus this link. -->
                <a
                  class="pg-link"
                  [routerLink]="hit.path"
                  [queryParams]="hit.type === 'task' ? origin.params('search') : null"
                  [state]="hit.type === 'task' ? origin.state() : undefined"
                  [mfRowLink]="hit.type === 'task' ? 'search' : ''"
                  [rowKey]="hit.id"
                >
                  @for (part of parts(hit.label); track $index) {
                    @if (part.match) {
                      <mark>{{ part.text }}</mark>
                    } @else {
                      <span>{{ part.text }}</span>
                    }
                  }
                </a>
                @if (hit.type === 'matter' && hit.isSensitive) {
                  <mf-sensitive-badge />
                }
                @if (hit.inMyMatters === false) {
                  <span class="hit-other" data-other-matter
                    ><span class="mf-sr-only">, </span>Other matter</span
                  >
                }
              </td>
              @if (has('details')) {
                <td>{{ hit.secondary ?? '' }}</td>
              }
              @if (has('matter')) {
                <td>
                  @if (hit.type !== 'client' && hit.matterRef) {
                    <span class="hit-matter">
                      <mf-matter-ref [value]="hit.matterRef" />
                      @if (hit.isSensitive) {
                        <mf-sensitive-badge />
                      }
                    </span>
                  }
                </td>
              }
              @if (has('matterName')) {
                <td>{{ hit.matterName ?? '' }}</td>
              }
              <td>
                @if (hit.status) {
                  <mf-status-badge [code]="hit.status" />
                } @else {
                  <mf-active-badge [active]="hit.isActive" />
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class HitTable {
  protected readonly origin = inject(TaskOriginLinks);
  readonly hits = input.required<SearchHit[]>();
  /** The text to highlight in names. */
  readonly query = input('');
  /** Accessible table caption. */
  readonly caption = input('Search results');

  protected parts(text: string) {
    return highlightParts(text, this.query());
  }

  /** The kind of record in the table; Advanced Search lists one type at a time. Mixed lists get every column. */
  private readonly kind = computed(() => {
    const types = new Set(this.hits().map((h) => h.type));
    return types.size === 1 ? [...types][0] : null;
  });

  protected readonly nameHeading = computed(() => (this.kind() === 'task' ? 'Title' : 'Name'));
  protected readonly detailsHeading = computed(() => {
    switch (this.kind()) {
      case 'matter':
        return 'Client';
      case 'task':
        return 'Requestor';
      case 'asset':
        return 'Type';
      default:
        return 'Details';
    }
  });

  /** Columns per type (UXR-41): no column that would be empty for the whole table. */
  protected has(column: 'reference' | 'details' | 'matter' | 'matterName'): boolean {
    switch (this.kind()) {
      case 'client':
        return column === 'reference';
      case 'matter':
        return column === 'reference' || column === 'details';
      case 'task':
        return column !== 'matterName';
      case 'asset':
        return column !== 'matterName';
      case 'project':
        return column === 'matter' || column === 'matterName';
      default:
        return column !== 'matterName';
    }
  }
}
