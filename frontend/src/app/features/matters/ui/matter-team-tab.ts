import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { MatterTeamClient, MatterTeamMemberResponse } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { QuietRequests } from '../../../core/http/interceptors';
import { NotificationService } from '../../../core/notify/notification.service';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ListToolbar } from '../../../shared/filters/list-toolbar';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { LoadState } from '../../../shared/ui/data-table';
import { Pager } from '../../../shared/ui/pager';
import {
  RecordCell,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../../shared/ui/record-grid';
import { SortedLine, sortLabelsOf } from '../../../shared/ui/sorted-line';
import { Tip } from '../../../shared/ui/tip';
import { TeamMemberDialog } from './team-member-dialog';

const PAGE_SIZES: readonly number[] = [25, 50, 100];
const DEFAULT_SORT = 'name';

/**
 * The Team tab of a Matter (epic #1298, UI spec 4): the people on the matter as a record grid (grid id `matter-team`): Name (the button that opens Edit Team Member),
 * Email, Title and one icon-only Remove button. The team has no size limit, so the grid is paged (25 / 50 / 100) and sorted by the API (Name, Email, Title). The control row is
 * the Sorted line and Add Member (with `Matter.Edit` only; without it the names are plain text and there is no Remove). No search, filters or Columns: three fixed columns.
 * Members are typed-in contacts, not accounts, so the team never touches My Matters or permissions.
 */
@Component({
  selector: 'mf-matter-team-tab',
  imports: [
    Button,
    ListToolbar,
    SortedLine,
    RecordGrid,
    RecordCell,
    Pager,
    Tip,
    TeamMemberDialog,
    ConfirmDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    /* Name is the spring: one line with an ellipsis (D-45); the floor is on the heading (the column definition). */
    td.mt-name {
      width: 100%;
      max-width: 0;
    }
    td.mt-name .mf-btn--name {
      -webkit-line-clamp: 1;
      line-clamp: 1;
      font-weight: 700;
    }
    td.mt-name .mt-plain {
      font-weight: 700;
    }
    .mt-remove {
      color: var(--mf-text-muted);
    }
    .mt-remove:hover:not(:disabled) {
      color: var(--mf-danger);
    }
  `,
  template: `
    <mf-list-toolbar [filters]="filters">
      <mf-sorted-line
        mfBarEnd
        [sort]="sort()"
        [defaultSort]="defaultSort"
        [labels]="sortLabels"
        (resetSort)="sort.set(defaultSort)"
      />
      @if (canEdit()) {
        <p-button
          mfPrimary
          label="Add Member"
          icon="pi pi-plus"
          data-add-member
          (onClick)="openAdd()"
        />
      }
    </mf-list-toolbar>
    <mf-record-grid
      label="Team list"
      [caption]="'Team members of ' + matterRef()"
      noun="the team"
      [grid]="grid"
      [rows]="rows()"
      [rowKey]="memberKey"
      [loadState]="state()"
      [empty]="rows().length === 0"
      [filtered]="false"
      [emptyText]="canEdit() ? 'No team members yet.' : 'No team members.'"
      [bones]="bones"
      [sort]="sort()"
      [defaultSort]="defaultSort"
      [actions]="canEdit()"
      (sorted)="setSort($event)"
      (retry)="load()"
    >
      @if (canEdit()) {
        <p-button
          mfEmptyAction
          label="Add Member"
          icon="pi pi-plus"
          data-empty-add-member
          (onClick)="openAdd()"
        />
      }
      <ng-template mfCell="name" let-m>
        <td class="mt-name">
          @if (canEdit()) {
            <button
              type="button"
              class="mf-btn mf-btn--text mf-btn--name"
              data-member-name
              [mfTip]="m.name"
              (click)="openEdit(m)"
            >
              {{ m.name }}
            </button>
          } @else {
            <span class="pg-clip mt-plain" data-member-name [mfTip]="m.name">{{ m.name }}</span>
          }
        </td>
      </ng-template>
      <ng-template mfCell="email" let-m>
        <td>
          <span class="pg-clip" data-member-email [mfTip]="m.email">{{ m.email }}</span>
        </td>
      </ng-template>
      <ng-template mfCell="title" let-m>
        <td>
          <span
            class="pg-clip"
            data-member-title
            [mfTip]="m.title.isActive ? m.title.name : 'This title is no longer offered.'"
            >{{ m.title.name }}</span
          >
        </td>
      </ng-template>
      <ng-template mfCell="actions" let-m>
        <td class="mf-col-actions" data-row-actions>
          <button
            type="button"
            class="mf-btn mf-btn--text mf-btn--icon mt-remove"
            data-remove-member
            [attr.aria-label]="'Remove ' + m.name"
            [mfTip]="'Remove ' + m.name"
            (click)="askRemove(m)"
          >
            <i class="pi pi-trash" aria-hidden="true"></i>
          </button>
        </td>
      </ng-template>
      <div mfGridFoot>
        @if (state() === 'ready' && total() > 0) {
          <mf-pager
            [page]="page()"
            [pageSize]="pageSize()"
            [pageSizes]="pageSizes"
            [total]="total()"
            (pageChange)="goTo($event)"
            (pageSizeChange)="setPageSize($event)"
          />
        }
      </div>
    </mf-record-grid>

    @if (dialogUsed()) {
      <mf-team-member-dialog
        [matterId]="matterId()"
        [matterRef]="matterRef()"
        [member]="editing()"
        [takenEmails]="takenEmails()"
        [(visible)]="dialogOpen"
        (saved)="afterSave()"
      />
    }

    <mf-confirm-dialog
      title="Remove Team Member"
      [confirmLabel]="removing() ? 'Removing...' : 'Remove Team Member'"
      [danger]="true"
      [busy]="removing()"
      [visible]="removeTarget() !== null"
      (visibleChange)="!$event && !removing() && removeTarget.set(null)"
      (confirmed)="remove()"
    >
      <p data-remove-body>
        {{ removeTarget()?.name }} will be removed from this matter's team. You can add them again
        later.
      </p>
    </mf-confirm-dialog>
  `,
})
export class MatterTeamTab {
  readonly matterId = input.required<number>();
  /** The CM Number: the grid's caption and the dialog's subtitle. */
  readonly matterRef = input('');
  /** Add, Edit and Remove: the same permission as the matter header's Edit button. */
  readonly canEdit = input(false);
  /** The team changed (added, edited, removed): the page asks for the tab count again. */
  readonly changed = output<void>();

  private readonly team = inject(MatterTeamClient);
  private readonly notify = inject(NotificationService);
  private readonly quiet = inject(QuietRequests);

  protected readonly defaultSort = DEFAULT_SORT;
  protected readonly pageSizes = PAGE_SIZES;
  protected readonly sortLabels = sortLabelsOf([
    { value: 'name', label: 'Name' },
    { value: 'email', label: 'Email' },
    { value: 'title', label: 'Title' },
  ]);
  protected readonly bones = { name: '9rem', email: '10rem', title: '6rem', actions: '1.5rem' };

  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<readonly MatterTeamMemberResponse[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(50);
  protected readonly sort = signal(DEFAULT_SORT);

  /** Three fixed columns (no Columns menu): every one is locked. */
  protected readonly gridDefs = computed((): RecordGridColumn[] => [
    { key: 'name', label: 'Name', locked: true, sort: 'name', minWidth: '200px' },
    {
      key: 'email',
      label: 'Email',
      locked: true,
      sort: 'email',
      width: 'var(--mf-col-email-w)',
      minWidth: 'var(--mf-col-email-w)',
    },
    {
      key: 'title',
      label: 'Title',
      locked: true,
      sort: 'title',
      width: 'var(--mf-col-title-w)',
      minWidth: 'var(--mf-col-title-w)',
    },
  ]);
  protected readonly grid = new RecordGridState('matter-team', this.gridDefs);
  protected readonly memberKey = (m: MatterTeamMemberResponse): number => m.id;
  /** The tab has no filters; the toolbar is only its control row. */
  protected readonly filters = new ListFilters({
    screen: 'matter-team',
    noun: 'team members',
    defs: [],
  });

  protected readonly dialogUsed = signal(false);
  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<MatterTeamMemberResponse | null>(null);
  /** The emails of the rows on screen except the one being edited (the duplicate message of the dialog). */
  protected readonly takenEmails = computed(() => {
    const own = this.editing()?.id;
    return this.rows()
      .filter((m) => m.id !== own)
      .map((m) => m.email);
  });
  protected readonly removeTarget = signal<MatterTeamMemberResponse | null>(null);
  protected readonly removing = signal(false);

  private turn = 0;

  constructor() {
    effect(() => {
      this.matterId();
      this.page();
      this.pageSize();
      this.sort();
      untracked(() => void this.load());
    });
  }

  /** Reads the page of rows. The rows on screen stay while a reload runs; a failure of the first load is the grid's own error block (no toast). */
  protected async load(): Promise<void> {
    const turn = ++this.turn;
    if (this.rows().length === 0) this.state.set('loading');
    try {
      const result = await firstValueFrom(
        this.quiet.runInline(() =>
          this.team.listMatterTeam(this.matterId(), this.page(), this.pageSize(), this.sort()),
        ),
      );
      if (turn !== this.turn) return;
      // A page that no longer exists (the last row of it was removed): back to the last page that does.
      const last = Math.max(1, Math.ceil(result.total / this.pageSize()));
      if (result.items.length === 0 && result.total > 0 && this.page() > last) {
        this.page.set(last);
        return;
      }
      this.rows.set(result.items);
      this.total.set(result.total);
      this.state.set('ready');
    } catch {
      if (turn !== this.turn) return;
      this.state.set('error');
    }
  }

  protected setSort(sort: string): void {
    this.sort.set(sort || DEFAULT_SORT);
    this.page.set(1);
  }

  protected goTo(page: number): void {
    this.page.set(page);
  }

  protected setPageSize(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
  }

  protected openAdd(): void {
    this.editing.set(null);
    this.dialogUsed.set(true);
    this.dialogOpen.set(true);
  }

  protected openEdit(member: MatterTeamMemberResponse): void {
    this.editing.set(member);
    this.dialogUsed.set(true);
    this.dialogOpen.set(true);
  }

  protected afterSave(): void {
    void this.load();
    this.changed.emit();
  }

  protected askRemove(member: MatterTeamMemberResponse): void {
    this.removeTarget.set(member);
  }

  protected async remove(): Promise<void> {
    const member = this.removeTarget();
    if (!member || this.removing()) return;
    this.removing.set(true);
    try {
      // The API answers 204 also when the member is already gone, so "already removed by someone else" reads as success.
      await firstValueFrom(this.team.removeMatterTeamMember(this.matterId(), member.id));
      this.notify.success('Team member removed', `${member.name} is no longer on the team.`);
      this.removeTarget.set(null);
      this.afterSave();
    } catch (err) {
      this.removeTarget.set(null);
      if (err instanceof ApiError && err.status === 404) {
        this.notify.success('Team member removed');
        this.afterSave();
      }
      // Other failures are toasted by the HTTP layer.
    } finally {
      this.removing.set(false);
    }
  }
}
