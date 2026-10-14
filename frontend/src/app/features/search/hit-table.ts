import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
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
  imports: [ActiveBadge, SensitiveBadge, RouterLink, MatterRef, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../shared/ui/page.scss',
  styles: `
    mark {
      background: transparent;
      color: inherit;
      font-weight: 700;
      text-decoration: underline;
    }
    .hit-matter {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      flex-wrap: wrap;
    }
  `,
  template: `
    <table class="pg-table" data-hit-table>
      <caption class="pg-sr">
        {{
          caption()
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">Reference</th>
          <th scope="col">Name</th>
          <th scope="col">Details</th>
          <th scope="col">Matter</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        @for (hit of hits(); track hit.type + hit.id) {
          <tr data-hit-row>
            <td class="pg-mono">{{ hit.reference }}</td>
            <td>
              <a class="pg-link" [routerLink]="hit.path">
                @for (part of parts(hit.label); track $index) {
                  @if (part.match) {
                    <mark>{{ part.text }}</mark>
                  } @else {
                    <span>{{ part.text }}</span>
                  }
                }
              </a>
            </td>
            <td>{{ detail(hit) }}</td>
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
  `,
})
export class HitTable {
  readonly hits = input.required<SearchHit[]>();
  /** The text to highlight in names. */
  readonly query = input('');
  /** Accessible table caption. */
  readonly caption = input('Search results');

  protected parts(text: string) {
    return highlightParts(text, this.query());
  }

  /** The details column: a Matter's client, an Asset's type, a Task's requestor, a Project's Matter. */
  protected detail(hit: SearchHit): string {
    if (hit.type === 'project') return hit.matterName ?? '';
    return hit.secondary ?? '';
  }
}
