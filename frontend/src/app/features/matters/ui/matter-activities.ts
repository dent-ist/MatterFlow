import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuditSearchClient, AuditSearchItem } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ListToolbar } from '../../../shared/filters/list-toolbar';
import {
  RecordCell,
  RecordColumns,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../../shared/ui/record-grid';
import { friendlyText } from '../../../shared/ui/audit-format';
import { auditObjectLink, auditObjectText } from '../../admin/audit/audit-links';
import { numericInstant, readableInstant } from '../../../shared/ui/numeric-date';
import { IntPipe } from '../../../shared/ui/number-format';
import { shortAccountName } from '../../../shared/ui/person-name';

/**
 * The Kind dropdown of the Activities tab: a word for the audit object types that belong together. The choice is sent to the server as the object type filter, so paging
 * stays right. Production, Spec and Note events come from the Productions and Notes modules (object types Production, ProductionSpec and Note).
 */
export const ACTIVITY_KINDS: readonly { value: string; label: string; types: string }[] = [
  { value: '', label: 'All Kinds', types: '' },
  { value: 'matter', label: 'Matter', types: 'Matter' },
  {
    value: 'tasks',
    label: 'Tasks',
    types: 'Task,TaskStepInstance,StepInstance,FormValueSet,TaskAsset',
  },
  { value: 'comments', label: 'Comments', types: 'TaskComment' },
  { value: 'assets', label: 'Assets', types: 'Asset' },
  { value: 'projects', label: 'Projects', types: 'Project' },
  { value: 'productions', label: 'Productions', types: 'Production,ProductionComment' },
  { value: 'specs', label: 'Specs', types: 'ProductionSpec' },
  { value: 'notes', label: 'Notes', types: 'Note,NoteTemplate' },
];

const seenKey = (matterId: number) => `mf.matter-activity-seen.${matterId}`;

/**
 * The Activities tab of a Matter (MD-07, #1008; owner decision AQ.7): everything the audit trail holds for the matter (the matter itself, its tasks, comments, assets,
 * projects, productions, specs and notes) in the My Matters grid style: When, Who and one What cell that ends with the object as a link when it has a page, newest first,
 * a Kind dropdown and a banner "N new since your last visit" (the last visit is remembered in this browser only). A record the viewer may not see keeps the server's
 * label "Restricted record". Needs `Audit.View` (the tab is not offered without it).
 */
@Component({
  selector: 'mf-matter-activities',
  imports: [IntPipe, ListToolbar, RecordGrid, RecordCell, RecordColumns, Dropdown, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    .ma__banner {
      margin: 0 0 var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-sem-info-bg);
      color: var(--mf-sem-info-fg);
    }
    td.ma__when {
      white-space: nowrap;
      color: var(--mf-text-muted);
    }
    /* What is the spring: the text stops at two lines (the full text is the tooltip). */
    td.ma__what {
      width: 100%;
      max-width: 0;
    }
    .ma__obj {
      margin-left: var(--mf-s1);
    }
    .ma__new {
      margin-left: var(--mf-s1);
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius-pill);
      background: var(--mf-sem-info-bg);
      color: var(--mf-sem-info-fg);
      font-size: var(--mf-fs-xs);
    }
  `,
  template: `
    <!-- The tab's control row, like every Matter tab (LC-08, theme guide 11.2): the Kind dropdown, then Columns. -->
    <h2 class="mf-sr-only">Activities</h2>
    <mf-list-toolbar [filters]="filters">
      <mf-dropdown
        mfView
        buttonId="ma-kind"
        label="Kind"
        prefix="Kind:"
        [items]="kindItems"
        [value]="kind()"
        (valueChange)="setKind($event)"
        neutralValue=""
      />
      <mf-record-columns mfColumns [grid]="grid" />
    </mf-list-toolbar>
    @if (newCount() > 0) {
      <p class="ma__banner" role="status" data-new-banner>
        {{ newCount() | mfInt }} new since your last visit
      </p>
    }
    <mf-record-grid
      label="Matter activities"
      caption="Activities of this matter, newest first"
      noun="activities"
      emptyText="No activity yet."
      [grid]="grid"
      [rows]="items()"
      [rowKey]="eventKey"
      [loadState]="state()"
      [empty]="items().length === 0"
      [filtered]="kind() !== ''"
      [bones]="bones"
      (retry)="fetch(true)"
      (clear)="setKind('')"
    >
      <ng-template mfCell="when" let-e>
        <td class="ma__when">
          <time [attr.datetime]="e.occurredAtUtc" [attr.title]="stampLong(e)">{{ stamp(e) }}</time>
        </td>
      </ng-template>
      <ng-template mfCell="what" let-e>
        <td class="ma__what" [attr.data-object-type]="e.object.type">
          <div class="pg-name" [attr.title]="what(e) + ' ' + objectText(e)">
            {{ what(e) }}
            @if (link(e); as l) {
              <a
                class="mf-link ma__obj"
                data-object-link
                [routerLink]="l.commands"
                [queryParams]="l.queryParams"
                >{{ objectText(e) }}</a
              >
            } @else {
              <span class="ma__obj" data-object-text>{{ objectText(e) }}</span>
            }
            @if (isNew(e)) {
              <span class="ma__new" data-new>New</span>
            }
          </div>
        </td>
      </ng-template>
      <ng-template mfCell="who" let-e>
        <td>
          <span class="pg-clip-fit" [attr.title]="who(e.actor.displayName)">{{
            who(e.actor.displayName)
          }}</span>
        </td>
      </ng-template>
      <div mfGridFoot>
        @if (nextCursor() !== null) {
          <button type="button" class="mf-btn" data-show-more (click)="fetch(false)">
            Show More
          </button>
        }
      </div>
    </mf-record-grid>
  `,
})
export class MatterActivities {
  /** A person as the grids and details name them: the display name, or the account without its domain (D-62; never `KE\\kekim`). */
  protected who(name: string | null | undefined): string {
    return shortAccountName(name) || (name ?? '');
  }

  readonly matterId = input.required<number>();

  /** The tab has no search or column filters, so the toolbar only carries the Kind dropdown and Columns. */
  protected readonly filters = new ListFilters({
    screen: 'matter-activities',
    noun: 'activities',
    defs: [],
  });
  /** The columns (shared record grid, #1269; grid id `matter-activities`): When 124, What the spring, Who 96. */
  protected readonly gridDefs = signal<RecordGridColumn[]>([
    { key: 'when', label: 'When', width: '124px', minWidth: '124px' },
    { key: 'what', label: 'What', locked: true, minWidth: '200px' },
    { key: 'who', label: 'Who', width: '96px', minWidth: '96px' },
  ]);
  protected readonly grid = new RecordGridState('matter-activities', this.gridDefs);
  protected readonly bones = { when: '5rem', what: '18rem', who: '4rem' };
  protected readonly eventKey = (e: AuditSearchItem): number => e.auditEventId;

  private readonly api = inject(AuditSearchClient);
  private readonly auth = inject(AuthStore);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly clock = inject(Clock);
  /** The highest event id the person had seen when this visit began (0 when there was no earlier visit). */
  private seenBefore = 0;
  private turn = 0;

  protected readonly kindItems: DropdownItem[] = ACTIVITY_KINDS.map((k) => ({
    value: k.value,
    label: k.label,
  }));
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly items = signal<AuditSearchItem[]>([]);
  protected readonly nextCursor = signal<number | null>(null);
  protected readonly kind = signal('');
  protected readonly newCount = computed(() => this.items().filter((e) => this.isNew(e)).length);

  constructor() {
    effect(() => {
      const id = this.matterId();
      untracked(() => {
        this.seenBefore = this.readSeen(id);
        void this.fetch(true).then(() => this.rememberVisit(id));
      });
    });
  }

  protected setKind(value: string): void {
    this.kind.set(value);
    void this.fetch(true);
  }

  protected isNew(e: AuditSearchItem): boolean {
    return this.seenBefore > 0 && e.auditEventId > this.seenBefore;
  }

  /** `MM/DD hh:mm AM/PM` (D-60); the long form is the tooltip. */
  protected stamp(e: AuditSearchItem): string {
    return numericInstant(e.occurredAtUtc, this.clock.now(), this.zone);
  }

  protected stampLong(e: AuditSearchItem): string {
    return readableInstant(e.occurredAtUtc, this.zone);
  }

  /** The event as a sentence, without the object (the link follows it). */
  protected what(e: AuditSearchItem): string {
    return friendlyText(e.summary) || 'Event';
  }

  protected objectText = auditObjectText;

  protected link(e: AuditSearchItem) {
    return auditObjectLink(e, (permission) => this.auth.has(permission));
  }

  private readSeen(id: number): number {
    try {
      return Number(localStorage.getItem(seenKey(id))) || 0;
    } catch {
      return 0;
    }
  }

  private rememberVisit(id: number): void {
    if (this.kind() !== '') return;
    const newest = Math.max(0, ...this.items().map((e) => e.auditEventId));
    if (newest === 0) return;
    try {
      localStorage.setItem(seenKey(id), String(newest));
    } catch {
      // Private window or blocked storage: the banner simply never appears.
    }
  }

  protected async fetch(first: boolean): Promise<void> {
    const mine = ++this.turn;
    if (first) {
      this.state.set('loading');
      this.nextCursor.set(null);
    }
    const types = ACTIVITY_KINDS.find((k) => k.value === this.kind())?.types || undefined;
    try {
      const page = await firstValueFrom(
        this.api.searchAuditEvents(
          types,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          first ? undefined : (this.nextCursor() ?? undefined),
          50,
          this.matterId(),
        ),
      );
      if (mine !== this.turn) return;
      this.items.update((list) => (first ? page.items : [...list, ...page.items]));
      this.nextCursor.set(page.nextCursor ?? null);
      this.state.set('ready');
    } catch {
      if (mine === this.turn) this.state.set('error');
    }
  }
}
