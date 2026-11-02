import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatterResponse } from '../../../api/generated/api-client';
import { ActionMenu, MenuAction } from '../../../shared/ui/action-menu';
import { ActiveBadge, Badge, SensitiveBadge } from '../../../shared/ui/badge';
import { aiChip } from './matter-ai';
import { SENSITIVE_LEAD, SENSITIVE_TEXT } from '../../../shared/ui/record-header';
import { MatterRef } from '../../../shared/ui/matter-ref';

/**
 * The compact header of the Matter page (MD-01, #1002; owner decision AQ.2): the breadcrumb `Matters > {CM number}` with a copy button, the title
 * `{Client} > {Matter name}`, one quiet subtitle line with the CM number and the Active, Sensitive and AI chips, and two menus: **New**
 * (Task, Project, Asset, ...) and **More actions**. No task counts and no status buttons. The page builds both menus from the viewer's permissions.
 */
@Component({
  selector: 'mf-matter-header',
  imports: [RouterLink, ActionMenu, ActiveBadge, SensitiveBadge, Badge, MatterRef],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      position: relative;
      z-index: 8;
      margin-bottom: var(--mf-s2);
    }
    .mh__crumbs ol {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .mh__crumbs li + li::before {
      content: '>';
      margin-right: var(--mf-s2);
    }
    .mh__crumbs a {
      color: var(--mf-link);
    }
    .mh__row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2) var(--mf-s3);
    }
    .mh__title {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      flex: 1 1 18rem;
      min-width: 0;
      margin: 0;
      /* The same size as every record header: 22 px, 18 px on a phone. */
      font-size: var(--mf-fs-h2);
      font-weight: 700;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    @media (max-width: 639.98px) {
      .mh__title {
        font-size: var(--mf-fs-h3);
      }
    }
    .mh__title .pi {
      color: var(--mf-text-muted);
    }
    /* At most two lines; the whole name is in the tooltip and stays in the page text. */
    .mh__name {
      display: -webkit-box;
      overflow: hidden;
      line-clamp: 2;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .mh__sep {
      color: var(--mf-text-muted);
      font-weight: 400;
    }
    .mh__actions {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .mh__note {
      display: flex;
      align-items: baseline;
      gap: var(--mf-s2);
      margin: var(--mf-s1) 0 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .mh__sub {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: var(--mf-s1) 0 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
  template: `
    <header data-matter-header data-record-header data-kind="matter">
      <nav class="mh__crumbs" aria-label="Breadcrumb">
        <ol>
          <li><a routerLink="/matters">Matters</a></li>
          <li aria-current="page" data-crumb-current>
            <mf-matter-ref [value]="matter().matterRef" />
          </li>
        </ol>
      </nav>
      <div class="mh__row">
        <h1 class="mh__title" data-page-title>
          <i class="pi pi-briefcase" aria-hidden="true" data-page-icon></i>
          <span
            class="mh__name"
            data-name
            [attr.title]="matter().clientName + ' > ' + matter().name"
            >{{ matter().clientName }}<span class="mh__sep" aria-hidden="true"> &gt; </span
            ><span class="mf-sr-only">, </span>{{ matter().name }}</span
          >
        </h1>
        <div class="mh__actions" data-page-actions>
          <mf-action-menu label="Create" triggerText="New" [items]="newItems()" />
          <mf-action-menu label="More actions" [items]="moreItems()" />
        </div>
      </div>
      <p class="mh__sub" data-matter-subtitle>
        <mf-matter-ref [value]="matter().matterRef" [copy]="false" />
        <mf-active-badge [active]="matter().isActive" />
        @if (matter().isSensitive) {
          <mf-sensitive-badge [describedBy]="noteId" />
        }
        <mf-badge tone="neutral" icon="pi-sparkles" data-ai-chip>{{ ai() }}</mf-badge>
      </p>
      @if (matter().isSensitive) {
        <p class="mh__note" role="note" [id]="noteId" data-sensitive-banner>
          <i class="pi pi-lock" aria-hidden="true"></i>
          <span
            ><strong>{{ lead }}</strong> {{ text }}</span
          >
        </p>
      }
    </header>
  `,
})
export class MatterHeader {
  protected readonly noteId = 'matter-sensitive-note';
  protected readonly lead = SENSITIVE_LEAD;
  protected readonly text = SENSITIVE_TEXT;
  readonly matter = input.required<MatterResponse>();
  protected readonly ai = computed(() => aiChip(this.matter().aiAllowed));
  readonly newItems = input<readonly MenuAction[]>([]);
  readonly moreItems = input<readonly MenuAction[]>([]);
}
