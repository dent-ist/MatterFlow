import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatterResponse } from '../../../api/generated/api-client';
import { ActionMenu, MenuAction } from '../../../shared/ui/action-menu';
import { TitleIcon } from '../../../shared/ui/page-header';
import { SENSITIVE_LEAD, SENSITIVE_TEXT } from '../../../shared/ui/record-header';

/**
 * The compact header of the Matter page (MD-01, #1002; simplified in MD-42, #1060): the breadcrumb `Matters > {matter name}`, the title `{Client} > {Matter name}`
 * and the actions: **Edit** (for a person who may edit), the **New** menu (Task, Project, Asset, ...; the primary action) and **More actions**. The CM number, the Active, Sensitive and AI chips are shown in the Summary's Details, not here.
 * Two things that carry access or read-only information stay: the sensitive information bar under the title (the page keeps the inactive-matter and inactive-client
 * banners below the header). No task counts and no status buttons. The page builds both menus from the viewer's permissions.
 */
@Component({
  selector: 'mf-matter-header',
  imports: [RouterLink, ActionMenu, TitleIcon],
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
      gap: 0;
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
    /* The sensitive information bar: one compact amber bar under the title (access information stays on every tab). */
    .mh__note {
      display: flex;
      align-items: baseline;
      gap: var(--mf-s2);
      margin: var(--mf-s2) 0 0;
      padding: var(--mf-s1) var(--mf-s3);
      border: 1px solid var(--mf-sem-risk-line);
      border-radius: var(--mf-radius-md);
      background: var(--mf-sem-risk-bg);
      color: var(--mf-sem-risk-fg);
      font-size: var(--mf-fs-sm);
    }
    .mh__crumb-name {
      display: inline-block;
      max-width: min(40ch, 60vw);
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: bottom;
      white-space: nowrap;
    }
  `,
  template: `
    <header data-matter-header data-record-header data-kind="matter">
      <nav class="mh__crumbs" aria-label="Breadcrumb">
        <ol>
          <li><a routerLink="/matters">Matters</a></li>
          <li aria-current="page" data-crumb-current>
            <span class="mh__crumb-name" [attr.title]="matter().name">{{ matter().name }}</span>
          </li>
        </ol>
      </nav>
      <div class="mh__row">
        <h1 class="mh__title" data-page-title>
          <mf-title-icon icon="pi pi-briefcase" />
          <span
            class="mh__name"
            data-name
            [attr.title]="matter().clientName + ' > ' + matter().name"
            >{{ matter().clientName }}<span class="mh__sep" aria-hidden="true"> &gt; </span
            ><span class="mf-sr-only">, </span>{{ matter().name }}</span
          >
        </h1>
        <div class="mh__actions" data-page-actions>
          @if (canEdit()) {
            <button
              type="button"
              class="mf-btn"
              data-action="edit"
              data-edit-matter
              (click)="edit.emit()"
            >
              Edit
            </button>
          }
          <mf-action-menu label="Create" triggerText="New" [items]="newItems()" />
          <mf-action-menu label="More actions" [items]="moreItems()" />
        </div>
      </div>
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
  readonly newItems = input<readonly MenuAction[]>([]);
  readonly moreItems = input<readonly MenuAction[]>([]);
  /** Edit is a header button (D-21, #1136), first in the row: Edit, the New menu (the primary), the overflow. */
  readonly canEdit = input(false);
  readonly edit = output<void>();
}
