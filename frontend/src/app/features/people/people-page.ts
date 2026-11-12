import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { PeopleClient, PersonDto } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { NotificationService } from '../../core/notify/notification.service';
import { UndoService } from '../../core/notify/undo.service';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { ColumnFilterRow } from '../../shared/filters/column-filter-row';
import { ACTIVE_STATUS_OPTIONS, statusDef } from '../../shared/filters/common-defs';
import { FilterDef } from '../../shared/filters/filter-def';
import { ListFilters } from '../../shared/filters/list-filters';
import { ListToolbar } from '../../shared/filters/list-toolbar';
import { ActiveBadge } from '../../shared/ui/badge';
import { FixedPage } from '../../shared/ui/fixed-page';
import { MenuAction, ActionMenu } from '../../shared/ui/action-menu';
import { isActiveParam, parseStatus } from '../../shared/ui/list-helpers';
import { ServerListPage } from '../../shared/ui/list-query';
import { PageHeader } from '../../shared/ui/page-header';
import { Pager } from '../../shared/ui/pager';
import { PersonTypeBadge } from '../../shared/ui/person-type';
import {
  RecordCell,
  RecordColumns,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../shared/ui/record-grid';
import { SortedLine, sortLabelsOf } from '../../shared/ui/sorted-line';
import { shortAccountName } from '../../shared/ui/person-name';
import { Tip } from '../../shared/ui/tip';
import { PersonDialog } from './person-dialog';

/** Bone widths of a skeleton row, per column key. */
const BONES: Record<string, string> = {
  name: '14rem',
  type: '5rem',
  title: '8rem',
  company: '9rem',
  status: '5rem',
};

/** The Type filter: the API's `type` values; the empty value is "All Types". */
export const PERSON_TYPE_OPTIONS = [
  { value: 'INTERNAL', label: 'Internal' },
  { value: 'EXTERNAL', label: 'External' },
] as const;

/** The sort fields the API accepts (`GET /api/v1/people?sort=`). */
const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'type', label: 'Type' },
  { value: 'title', label: 'Title or Role' },
  { value: 'company', label: 'Company' },
];

/**
 * People (epic #1373, issue #1375; mockup `docs/design/mockups/vendor-management`, screen `people`): the shared address book for matter teams and vendor contacts. A grid of Name (the
 * button that opens the person, email under it), Type (System User, Internal or External), Title or Role, Company and Status, with Search (name, email, company or title), the Type and
 * Status filters, sorting and paging (25, 50, 100) on the server. `People.View` reads (the name opens a read-only view); `People.Manage` adds New Person, Edit and the "..." menu with
 * Deactivate Person (a person is never deleted; a system user's person cannot be deactivated here). State lives in the address (`q`, `type`, `status`, `page`, `size`, `sort`).
 */
@Component({
  selector: 'mf-people-page',
  imports: [
    FixedPage,
    PageHeader,
    Button,
    HasPermissionDirective,
    ListToolbar,
    SortedLine,
    ColumnFilterRow,
    RecordGrid,
    RecordCell,
    RecordColumns,
    Pager,
    ActiveBadge,
    ActionMenu,
    PersonTypeBadge,
    PersonDialog,
    Tip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../shared/ui/page.scss',
  styles: `
    /* Name is the spring: one clipped line for the name button and for the email under it (D-45, D-44m). */
    td.pe-name {
      width: 100%;
      max-width: 0;
    }
    td.pe-name .mf-btn--name {
      -webkit-line-clamp: 1;
      line-clamp: 1;
      font-weight: 700;
    }
    td.pe-name .pe-plain {
      display: block;
      font-weight: 700;
    }
    .pe-sub {
      display: block;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      line-height: 1.2;
    }
    td.pe-clip {
      max-width: 0;
    }
    .pe-none {
      color: var(--mf-text-muted);
    }
  `,
  template: `
    <mf-fixed-page>
      <mf-page-header
        heading="People"
        description="The shared address book for matter teams and vendor contacts. Type a person once, pick them everywhere. System users appear here automatically."
        [count]="state() === 'ready' ? total() : null"
        [countPending]="state() !== 'ready'"
      >
        <p-button
          mfActions
          *mfHasPermission="'People.Manage'"
          label="New Person"
          icon="pi pi-plus"
          data-new-person
          (onClick)="openNew()"
        />
      </mf-page-header>

      <mf-list-toolbar
        [filters]="filters"
        controls="people-filter-row"
        searchLabel="Search people"
        [clearAlso]="['q']"
      >
        <mf-record-columns mfColumns [grid]="grid" />
        <mf-sorted-line
          mfBarEnd
          [sort]="sort()"
          [defaultSort]="defaultSort"
          [labels]="sortLabels"
          (resetSort)="pickSort(null)"
        />
      </mf-list-toolbar>

      <div class="mf-fill">
        <mf-record-grid
          label="People list"
          caption="People"
          noun="people"
          [grid]="grid"
          [rows]="rows()"
          [rowKey]="personKey"
          [loadState]="state()"
          [empty]="rows().length === 0"
          [filtered]="filters.activeCount() > 0"
          [hidden]="hiddenCount()"
          hiddenLabel="inactive"
          [bones]="bones"
          [sort]="sort()"
          [defaultSort]="defaultSort"
          [actions]="canManage()"
          (sorted)="setSort($event)"
          (retry)="load()"
          (clear)="clear()"
          (showAll)="showAll()"
        >
          @if (filters.rowVisible()) {
            <tr
              mfGridFilterRow
              mfColumnFilterRow
              id="people-filter-row"
              [filters]="filters"
              [columns]="columns()"
            ></tr>
          }
          <p-button
            mfEmptyAction
            *mfHasPermission="'People.Manage'"
            label="New Person"
            icon="pi pi-plus"
            data-empty-new-person
            (onClick)="openNew()"
          />
          <ng-template mfCell="name" let-p>
            <td class="pe-name">
              <button
                type="button"
                class="mf-btn mf-btn--text mf-btn--name"
                data-person-name
                [mfTip]="shown(p)"
                (click)="open(p)"
              >
                {{ shown(p) }}
              </button>
              @if (p.email) {
                <span class="pe-sub pg-clip" data-person-email [mfTip]="p.email">{{
                  p.email
                }}</span>
              }
            </td>
          </ng-template>
          <ng-template mfCell="type" let-p>
            <td data-person-type><mf-person-type-badge [person]="p" /></td>
          </ng-template>
          <ng-template mfCell="title" let-p>
            <td class="pe-clip">
              @if (p.title) {
                <span class="pg-clip" data-person-title [mfTip]="p.title">{{ p.title }}</span>
              } @else {
                <span class="pe-none" data-person-title>None</span>
              }
            </td>
          </ng-template>
          <ng-template mfCell="company" let-p>
            <td class="pe-clip">
              @if (p.companyName) {
                <span class="pg-clip" data-person-company [mfTip]="p.companyName">{{
                  p.companyName
                }}</span>
              } @else {
                <span class="pe-none" data-person-company>{{
                  p.personType === 'EXTERNAL' ? 'None' : 'Law firm'
                }}</span>
              }
            </td>
          </ng-template>
          <ng-template mfCell="status" let-p>
            <td><mf-active-badge [active]="p.isActive" /></td>
          </ng-template>
          <ng-template mfCell="actions" let-p>
            <td class="mf-col-actions" data-row-actions>
              <mf-action-menu
                [floating]="true"
                [label]="'Actions for ' + shown(p)"
                [items]="menu(p)"
              />
            </td>
          </ng-template>
          <div mfGridFoot>
            @if (state() === 'ready' && total() > 0) {
              <mf-pager
                [page]="pageNumber()"
                [pageSize]="pageSize()"
                [pageSizes]="pageSizes"
                [total]="total()"
                [hidden]="hiddenCount()"
                hiddenLabel="inactive"
                (showAll)="showAll()"
                (pageChange)="goToPage($event)"
                (pageSizeChange)="setPageSize($event)"
              />
            }
          </div>
        </mf-record-grid>
      </div>
    </mf-fixed-page>

    @if (dialogUsed()) {
      <mf-person-dialog [person]="editing()" [(visible)]="dialogOpen" (saved)="load()" />
    }
  `,
})
export class PeoplePage extends ServerListPage<PersonDto> {
  protected override readonly emptyOffersClear = true;
  private readonly api = inject(PeopleClient);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);
  private readonly undo = inject(UndoService);

  protected readonly defaultSort = 'name';
  protected readonly sortLabels = sortLabelsOf(SORT_OPTIONS);
  protected readonly canManage = computed(() => this.auth.has('People.Manage'));
  protected readonly bones = BONES;
  protected readonly personKey = (p: PersonDto): number => p.personId;

  protected readonly gridDefs = computed((): RecordGridColumn[] => [
    // The spring: no width, so it takes the free room in every state (#1245).
    { key: 'name', label: 'Name', locked: true, sort: 'name', minWidth: '200px' },
    {
      key: 'type',
      label: 'Type',
      sort: 'type',
      width: '140px',
      minWidth: '140px',
    },
    { key: 'title', label: 'Title or Role', sort: 'title', width: '180px', minWidth: '180px' },
    { key: 'company', label: 'Company', sort: 'company', width: '200px', minWidth: '200px' },
    {
      key: 'status',
      label: 'Status',
      width: 'var(--mf-col-status-w)',
      minWidth: 'var(--mf-col-status-w)',
    },
  ]);
  /** The grid state (shared record grid, #1241): order, visibility and stored widths per person under the id "people". */
  protected readonly grid = new RecordGridState('people', this.gridDefs);
  protected readonly columns = computed(() => [
    ...this.grid.shown(),
    ...(this.canManage() ? ['actions'] : []),
  ]);

  private readonly defs = computed((): FilterDef[] => [
    { key: 'q', label: 'Name', column: 'name', type: 'text', search: true },
    {
      key: 'type',
      label: 'Type',
      column: 'type',
      type: 'select',
      options: PERSON_TYPE_OPTIONS,
      allLabel: 'All Types',
    },
    statusDef(ACTIVE_STATUS_OPTIONS),
  ]);

  protected readonly filters: ListFilters = new ListFilters({
    screen: 'people',
    noun: 'people',
    defs: this.defs,
    openByDefault: true,
  });

  protected readonly dialogOpen = signal(false);
  protected readonly dialogUsed = signal(false);
  protected readonly editing = signal<PersonDto | null>(null);

  protected override listFilters() {
    return this.filters;
  }

  protected override fetch() {
    return this.list(
      isActiveParam(parseStatus(this.filters.text('status'))),
      this.pageNumber(),
      this.pageSize(),
    );
  }

  /** The inactive people the default Active hides, under the same search and type (#271). */
  protected override fetchHidden() {
    return parseStatus(this.filters.text('status')) === 'active' ? this.list(false, 1, 1) : null;
  }

  private list(active: boolean | undefined, page: number, size: number) {
    return firstValueFrom(
      this.api.listPeople(
        this.filters.text('q') || undefined,
        this.filters.text('type') || undefined,
        active,
        page,
        size,
        this.sort() || undefined,
      ),
    );
  }

  /** D-62: a bare Windows account is shown without its domain. */
  protected shown(p: PersonDto): string {
    return shortAccountName(p.displayName);
  }

  protected openNew(): void {
    this.editing.set(null);
    this.dialogUsed.set(true);
    this.dialogOpen.set(true);
  }

  protected open(person: PersonDto): void {
    this.editing.set(person);
    this.dialogUsed.set(true);
    this.dialogOpen.set(true);
  }

  /** The "..." menu of a row (`People.Manage`): Edit Person, and Deactivate or Reactivate Person (never for a system user: the user is deactivated instead). */
  protected menu(p: PersonDto): MenuAction[] {
    const items: MenuAction[] = [
      { id: 'edit', label: 'Edit Person', icon: 'pi-pencil', run: () => this.open(p) },
    ];
    if (!p.isSystemUser) {
      items.push(
        p.isActive
          ? {
              id: 'deactivate',
              label: 'Deactivate Person',
              icon: 'pi-ban',
              run: () => void this.setActive(p, false),
            }
          : {
              id: 'reactivate',
              label: 'Reactivate Person',
              icon: 'pi-replay',
              run: () => void this.setActive(p, true),
            },
      );
    }
    return items;
  }

  /** A person is never deleted: deactivating hides them from pickers and is undone from the toast (D-34, reversible). */
  private async setActive(p: PersonDto, active: boolean): Promise<void> {
    try {
      const saved = await firstValueFrom(this.api.updatePerson(p.personId, this.body(p, active)));
      if (active) {
        this.notify.success(
          'Person reactivated',
          `${saved.displayName} is offered in pickers again.`,
        );
      } else {
        this.undo.offer(
          `${saved.displayName} deactivated.`,
          async () => {
            try {
              await firstValueFrom(this.api.updatePerson(p.personId, this.body(saved, true)));
              this.notify.success('Person reactivated', `${saved.displayName}.`);
            } catch {
              this.notify.error(
                `Not undone: couldn't reactivate ${saved.displayName}.`,
                'Reactivate the person from the list.',
              );
            }
            await this.load();
          },
          {
            hint: 'A deactivated person is not offered in pickers. Reactivate them from the list.',
          },
        );
      }
      await this.load();
    } catch (err) {
      this.notify.error(
        `Couldn't ${active ? 'reactivate' : 'deactivate'} the person.`,
        (err as Error)?.message,
      );
    }
  }

  private body(p: PersonDto, isActive: boolean) {
    return {
      firstName: p.firstName,
      lastName: p.lastName,
      personType: p.personType,
      title: p.title,
      email: p.email,
      comments: p.comments,
      companyName: p.companyName,
      isActive,
      rowVersion: p.rowVersion,
    };
  }
}
