import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { Button } from 'primeng/button';
import { AuthStore } from '../../../core/auth/auth.store';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { Badge } from '../../../shared/ui/badge';
import { AdminTabCounts } from '../admin-tabs';
import { AssetLinkRolesPage } from '../asset-link-roles/asset-link-roles-page';
import { MatterListTab } from '../matter-lists/matter-list-tab';
import { NoteTagsPage } from '../note-tags/note-tags-page';
import { OnHoldReasonsPage } from '../on-hold-reasons/on-hold-reasons-page';
import { PrioritiesPage } from '../priorities/priorities-page';
import { StatusLabelsPage } from '../status-labels/status-labels-page';
import { AdminListDef, AdminListKey } from './admin-lists';
import { LIST_BODY } from './list-body';

/** The three lists that share one body (`mf-matter-list-tab`). */
export const MATTER_LIST_KEYS: readonly AdminListKey[] = [
  'matter-types',
  'current-states',
  'team-titles',
];

/**
 * The editor of one list: no card around it (D-10), its header (H2 with the list's plural name, the green "n active" badge, the primary New button last, D-41), the muted "Shown on"
 * sentence, then the grid of the list (the body, today's editor) and the rule line at the foot. What differs per list is the `AdminListDef` config; the bodies
 * load lazily, only the open list is mounted, and its state is not kept when another list is picked. The count in the badge is the one the body reports to `AdminTabCounts`
 * after each load and change, so the catalogue and the header never disagree.
 */
@Component({
  selector: 'mf-list-editor',
  imports: [
    Badge,
    Button,
    PrioritiesPage,
    StatusLabelsPage,
    OnHoldReasonsPage,
    NoteTagsPage,
    AssetLinkRolesPage,
    MatterListTab,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'region', id: 'lists-editor', '[attr.aria-labelledby]': 'headingId' },
  template: `
    <div class="le__head">
      <h2 class="le__title" [id]="headingId">{{ def().label }}</h2>
      @if (count() !== null) {
        @if (def().hasActive) {
          <mf-badge tone="success" icon="pi-check-circle" data-active-count
            >{{ count() }} active</mf-badge
          >
        } @else {
          <!-- Status Labels have no active state: the five fixed statuses are all there is -->
          <mf-badge tone="neutral" icon="pi-list" data-active-count
            >{{ count() }} statuses</mf-badge
          >
        }
      }
      @if (def().newLabel; as newLabel) {
        @if (canManage()) {
          <p-button
            class="le__new"
            [label]="newLabel"
            icon="pi pi-plus"
            [disabled]="count() === null"
            data-new
            (onClick)="openNew()"
          />
        }
      }
    </div>
    <p class="le__shown" data-shown-on>{{ def().shownOn }}</p>
    <div class="mf-fill le__body" data-list-body>
      @switch (family()) {
        @case ('matter') {
          @defer (on immediate) {
            <mf-matter-list-tab [kind]="matterKind()" />
          }
        }
        @case ('priorities') {
          @defer (on immediate) {
            <mf-priorities-page [edit]="edit()" />
          }
        }
        @case ('status-labels') {
          @defer (on immediate) {
            <mf-status-labels-page [edit]="edit()" />
          }
        }
        @case ('on-hold-reasons') {
          @defer (on immediate) {
            <mf-on-hold-reasons-page [edit]="edit()" />
          }
        }
        @case ('note-tags') {
          @defer (on immediate) {
            <mf-note-tags-page />
          }
        }
        @case ('link-roles') {
          @defer (on immediate) {
            <mf-asset-link-roles-page [edit]="edit()" />
          }
        }
      }
    </div>
    <p class="le__rule" data-rule>
      <i class="pi pi-info-circle" aria-hidden="true"></i><span>{{ def().rule }}</span>
    </p>
    <div class="mf-sr-only" role="status" aria-live="polite" data-editor-live>
      {{ count() === null ? 'Loading ' + def().label : '' }}
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-width: 0;
      min-height: 0;
    }
    .le__head {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      min-height: var(--mf-ctl-h);
    }
    .le__title {
      margin: 0;
      color: var(--mf-text);
      font-size: var(--mf-fs-lg);
      font-weight: var(--mf-fw-semibold);
      line-height: 1.3;
    }
    .le__new {
      margin-left: auto;
    }
    .le__shown {
      margin: var(--mf-s1) 0 var(--mf-s3);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .le__body {
      min-height: 0;
    }
    .le__rule {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      flex: none;
      margin: var(--mf-s2) 0 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
})
export class ListEditor implements HasUnsavedChanges {
  private readonly auth = inject(AuthStore);
  private readonly counts = inject(AdminTabCounts, { optional: true });
  private readonly body = viewChild(LIST_BODY);

  /** The list to edit (the page remounts nothing when it changes: the lazy body of the new list replaces the old one). */
  readonly def = input.required<AdminListDef>();
  /** `?edit=<id>` / `?edit=new`: the dialog the open list shows (the lists that open a dialog from the address). */
  readonly edit = input<string | undefined>(undefined);

  protected readonly headingId = 'lists-editor-title';
  protected readonly canManage = computed(() => this.auth.has(this.def().permission));
  protected readonly family = computed(() =>
    MATTER_LIST_KEYS.includes(this.def().key) ? 'matter' : this.def().key,
  );
  protected readonly matterKind = computed(
    () => this.def().key as 'matter-types' | 'current-states' | 'team-titles',
  );
  /** The active items of the open list, once its body has loaded; `null` before that (no badge). */
  protected readonly count = computed<number | null>(() => {
    const n = this.counts?.count(this.def().key)();
    return typeof n === 'number' ? n : null;
  });

  protected openNew(): void {
    this.body()?.openNew?.();
  }

  hasUnsavedChanges(): boolean {
    return this.body()?.hasUnsavedChanges() ?? false;
  }
}
