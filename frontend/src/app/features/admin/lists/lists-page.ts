import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { AdminListShell } from '../../../shared/ui/admin-list-shell';
import { CatalogueGroup, ListCatalogue } from '../../../shared/ui/list-catalogue';
import { pageIcon } from '../../../shared/ui/tab-icons';
import { SearchBox } from '../../../shared/ui/search-box';
import { AdminTabCounts, resolveAdminTab } from '../admin-tabs';
import {
  ADMIN_LISTS,
  ADMIN_LIST_GROUPS,
  ADMIN_LIST_TABS,
  AdminListDef,
  adminListByKey,
  movedNotice,
} from './admin-lists';
import { ListEditor } from './list-editor';
import { listCountLoaders } from './lists-counts';
import { MOVED_PARAM } from './lists-routing';

/** The search box appears only when the person may manage more lists than this (UI spec 3.3). */
export const SEARCH_ABOVE = 4;

/** Whether a list matches the "Find a list" text: any part of the label, the group, the hint or the "Shown on" sentence, ignoring case. */
export function listMatches(def: AdminListDef, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [def.label, def.group, def.hint, def.shownOn].some((t) => t.toLowerCase().includes(q));
}

/**
 * Administration > Lists (epic #1314, UI spec `docs/ux/admin-lists/ui-spec.md`): one page for every list of choices. A catalogue card (320 px, `mf-list-catalogue`) at the left names the lists the
 * person may manage, in four groups, with the number of active items; the editor of the open list (`mf-list-editor`) fills the rest. `/admin/lists/:list` is the address of a list (one route
 * with a matcher, so the page stays alive when the list changes; `listsGuard` sends an unknown or forbidden key to the first permitted one). A person who manages one list gets no catalogue; two to
 * four lists, a catalogue without the search box. The counts are the lists' own GETs, started once and quietly (`AdminTabCounts`); the open list reports its own. Custom Fields is a different job
 * and its own page: a pointer at the foot of the catalogue (or the editor, in the one-list view) leads there.
 */
@Component({
  selector: 'mf-lists-page',
  imports: [AdminListShell, ListCatalogue, ListEditor, SearchBox, RouterLink],
  providers: [AdminTabCounts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-admin-list-shell
      heading="Lists"
      [icon]="icon"
      description="The choices people pick from in forms and filters."
      tableId="lists-editor"
    >
      @if (movedFrom(); as m) {
        <p class="pg-banner pg-banner--info lp__moved" role="status" data-moved-banner>
          <i class="pi pi-info-circle" aria-hidden="true"></i>
          <span>{{ notice(m) }}</span>
          <button
            type="button"
            class="mf-btn mf-btn--text"
            data-dismiss
            (click)="movedFrom.set(null)"
          >
            Dismiss
          </button>
        </p>
      }
      @if (current(); as def) {
        <div class="lp" [class.lp--single]="!showCatalogue()">
          @if (showCatalogue()) {
            <mf-list-catalogue
              label="Lists"
              [groups]="groups()"
              [selected]="def.key"
              (pick)="open($event)"
            >
              @if (showSearch()) {
                <mf-search-box
                  mfCatalogueSearch
                  inputId="lists-find"
                  label="Find a list"
                  placeholder="Find a list"
                  [hideLabel]="true"
                  [leadingIcon]="true"
                  [hideHint]="true"
                  (searchChange)="query.set($event)"
                />
              }
              <div mfCatalogueEmpty>
                <p class="lp__none" data-no-match-text>No list matches "{{ query() }}".</p>
                @if (canCustomFields()) {
                  <p class="lp__none-more">
                    Looking for a new field on a client, matter or project? That is Custom Fields.
                  </p>
                  <a class="mf-btn mf-btn--text" routerLink="/admin/custom-fields"
                    >Open Custom Fields</a
                  >
                } @else {
                  <p class="lp__none-more">
                    Try the name of the dropdown or where it shows, such as "matter form".
                  </p>
                }
              </div>
              @if (canCustomFields()) {
                <div mfCataloguePointer class="lp__point" data-fields-pointer>
                  <p class="lp__point-title">Need a new field instead?</p>
                  <a
                    class="mf-btn mf-btn--text"
                    routerLink="/admin/custom-fields"
                    data-open-custom-fields
                    >Open Custom Fields <i class="pi pi-arrow-right" aria-hidden="true"></i
                  ></a>
                </div>
              }
            </mf-list-catalogue>
          }
          <div class="lp__pane">
            <mf-list-editor [def]="def" [edit]="edit()" />
            @if (!showCatalogue() && canCustomFields()) {
              <p class="lp__single-point" data-fields-pointer>
                Need a new field instead?
                <a
                  class="mf-btn mf-btn--text"
                  routerLink="/admin/custom-fields"
                  data-open-custom-fields
                  >Open Custom Fields <i class="pi pi-arrow-right" aria-hidden="true"></i
                ></a>
              </p>
            }
          </div>
        </div>
      }
    </mf-admin-list-shell>
  `,
  styles: `
    .lp {
      display: grid;
      grid-template-columns: var(--mf-catalogue-w) minmax(0, 1fr);
      gap: var(--mf-s4);
      flex: 1 1 0;
      min-height: 0;
    }
    .lp--single {
      grid-template-columns: minmax(0, 1fr);
    }
    .lp__pane {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }
    .lp__moved {
      flex: none;
    }
    .lp__none {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text);
    }
    .lp__none-more {
      margin: 0 0 var(--mf-s2);
    }
    .lp__point {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      min-height: 44px;
      padding: var(--mf-s2) var(--mf-s3);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface-alt);
    }
    .lp__point-title {
      margin: 0;
      font-size: var(--mf-fs-md);
      font-weight: var(--mf-fw-semibold);
    }
    .lp__single-point {
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
export class ListsPage implements HasUnsavedChanges {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly counts = inject(AdminTabCounts);
  private readonly loaders = listCountLoaders();
  private readonly editor = viewChild(ListEditor);

  /** The `:list` path segment. */
  readonly list = input<string>();
  /** `?edit=<id>` / `?edit=new`: the dialog the open list shows. */
  readonly edit = input<string | undefined>(undefined);
  /** `?moved=<old key>`: the one-time marker of an old address (UI spec 6.3). */
  readonly moved = input<string | undefined>(undefined);

  protected readonly icon = pageIcon('lists');
  protected readonly query = signal('');
  /** The list whose old address the person came from; shown once, then the marker leaves the address. */
  protected readonly movedFrom = signal<AdminListDef | null>(null);

  private readonly can = (permission: string) => this.auth.has(permission);
  /** The lists the person may manage, in catalogue order. */
  protected readonly permitted = computed(() =>
    ADMIN_LISTS.filter((l) => this.auth.has(l.permission)),
  );
  protected readonly current = computed<AdminListDef | null>(() => {
    const key = resolveAdminTab(ADMIN_LIST_TABS, this.list(), this.can)?.id;
    return adminListByKey(key) ?? null;
  });
  protected readonly showCatalogue = computed(() => this.permitted().length > 1);
  protected readonly showSearch = computed(() => this.permitted().length > SEARCH_ABOVE);
  protected readonly canCustomFields = computed(() => this.auth.has('CustomField.Manage'));

  protected readonly groups = computed<CatalogueGroup[]>(() => {
    const query = this.showSearch() ? this.query() : '';
    const counts = this.counts.snapshot();
    return ADMIN_LIST_GROUPS.map((g) => ({
      name: g.name,
      icon: g.icon,
      items: this.permitted()
        .filter((l) => l.group === g.name && listMatches(l, query))
        .map((l) => ({
          key: l.key,
          label: l.label,
          hint: l.hint,
          count: counts[l.key] ?? null,
        })),
    })).filter((g) => g.items.length > 0);
  });

  constructor() {
    // The counts of the other lists, once, quietly (the open list reports its own after it loads).
    afterNextRender(() => {
      const open = this.current()?.key;
      const tabs = ADMIN_LIST_TABS.filter((t) => t.id !== open);
      void this.counts.start(tabs, this.loaders, this.can);
    });
    // An old address brings `moved=<key>`: say so once and take the marker out of the address (Back must not show it again).
    effect(() => {
      const key = this.moved();
      if (!key) return;
      untracked(() => {
        const def = adminListByKey(key);
        if (def && this.permitted().some((l) => l.key === def.key)) this.movedFrom.set(def);
        void this.router.navigate([], {
          queryParams: { [MOVED_PARAM]: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      });
    });
  }

  protected notice(def: AdminListDef): string {
    return movedNotice(def);
  }

  protected open(key: string): void {
    if (key === this.current()?.key) return;
    void this.router.navigate(['/admin/lists', key]);
  }

  /** The open editor owns the dialogs; the page has no other unsaved work. */
  hasUnsavedChanges(): boolean {
    return this.editor()?.hasUnsavedChanges() ?? false;
  }
}
