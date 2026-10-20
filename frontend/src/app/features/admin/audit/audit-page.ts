import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AuditFacets,
  AuditSearchClient,
  AuditSearchItem,
  UsersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { fieldLabel, friendlyText } from '../../../shared/ui/audit-format';
import {
  AuditGroup,
  auditObjectRoute,
  auditObjectText,
  groupByCorrelation,
  groupHeadline,
  groupObjectItem,
  splitGroup,
} from './audit-links';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { FilterDef, FilterOption } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { LoadState } from '../../../shared/ui/data-table';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { PageHeader } from '../../../shared/ui/page-header';

const PAGE_SIZE = 50;
/** People offered in the Who filter: the first pages of the user list (100 each). */
const ACTOR_PAGES = 5;

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = ['details', 'when', 'who', 'what', 'object'] as const;

/**
 * Admin Audit Log (UX Audit screen, Audit.View): inline column filters (When with presets in the viewer's zone, Who, What happened:
 * event type and summary or field text, Object: type and id) that apply live and live in the address (`from`, `to`, `actor`,
 * `eventType`, `q`, `objectType`, `objectId`, `correlationId`), results newest first with a readable sentence per event, expandable
 * old/new values, an optional grouping of the events of one operation (bulk actions), links to the audited object, and cursor paging
 * ("Load more"). Read only: there is no export.
 */
@Component({
  selector: 'mf-audit-page',
  imports: [
    FixedPage,
    ScrollArea,
    PageHeader,
    RouterLink,
    MfDatePipe,
    NgTemplateOutlet,
    GridBody,
    FiltersBar,
    ColumnFilterRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './audit-page.html',
  styleUrl: './audit-page.scss',
})
export class AuditPage {
  private readonly api = inject(AuditSearchClient);
  private readonly users = inject(UsersClient);
  private readonly auth = inject(AuthStore);
  private readonly injector = inject(Injector);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');
  protected readonly zone = inject(USER_TIME_ZONE);
  private requestId = 0;

  protected readonly canView = computed(() => this.auth.has('Audit.View'));
  protected readonly canLookUpUsers = computed(() => this.auth.has('User.View'));
  protected readonly columns = COLUMNS;

  protected readonly facets = signal<AuditFacets>({ objectTypes: [], eventTypes: [] });
  /** People to choose from in the Who filter (needs User.View); inactive ones stay selectable. */
  private readonly actors = signal<FilterOption[]>([]);
  protected readonly items = signal<AuditSearchItem[]>([]);
  protected readonly nextCursor = signal<number | null>(null);
  protected readonly state = signal<LoadState>('loading');
  protected readonly loadingMore = signal(false);
  /** Events of one operation are grouped by default: one line per operation, field-level changes on request. */
  protected readonly grouped = signal(true);
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());
  protected readonly openGroups = signal<ReadonlySet<string>>(new Set());
  protected readonly openFieldGroups = signal<ReadonlySet<string>>(new Set());

  /**
   * One definition per filter. They apply live (text after a short pause) and are written to the address, so a filtered view can be
   * shared. `correlationId` has no control: "Show only this operation" sets it and a removable chip shows it.
   */
  protected readonly filters: ListFilters = new ListFilters({
    screen: 'audit',
    noun: 'audit events',
    defs: computed((): FilterDef[] => [
      {
        key: 'when',
        label: 'When',
        column: 'when',
        type: 'dateRange',
        fromParam: 'from',
        toParam: 'to',
        presets: ['today', 'last7', 'last30', 'thisMonth'],
      },
      this.canLookUpUsers()
        ? {
            key: 'actor',
            label: 'Who',
            column: 'who',
            type: 'user',
            options: this.actors(),
            emptyLabel: 'Anyone',
            normalize: (v) => (/^[1-9]\d{0,9}$/.test(v) ? v : null),
          }
        : {
            // Without User.View there is no list of people: the user id.
            key: 'actor',
            label: 'Who (user id)',
            column: 'who',
            type: 'text',
            maxLength: 10,
            normalize: (v) => (/^[1-9]\d{0,9}$/.test(v) ? v : null),
          },
      {
        key: 'eventType',
        label: 'Event type',
        column: 'what',
        type: 'select',
        allLabel: 'Any event',
        options: this.facets().eventTypes.map((t) => ({ value: t, label: t })),
      },
      { key: 'q', label: 'Summary or field', column: 'what', type: 'text' },
      {
        key: 'objectType',
        label: 'Object type',
        column: 'object',
        type: 'select',
        allLabel: 'Any object',
        options: this.facets().objectTypes.map((t) => ({ value: t, label: t })),
      },
      {
        key: 'objectId',
        label: 'Object id',
        column: 'object',
        type: 'text',
        maxLength: 40,
        disabledReason: () =>
          this.filters.text('objectType') ? null : 'Choose an object type first',
      },
      {
        key: 'correlationId',
        label: 'Operation',
        type: 'text',
        noControl: true,
        normalize: (v) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null,
        valueLabel: () => 'One operation',
      },
    ]),
  });

  protected readonly groups = computed<AuditGroup[]>(() => groupByCorrelation(this.items()));
  protected readonly filtered = computed(() => this.filters.activeCount() > 0);
  protected readonly operationId = computed(() => this.filters.text('correlationId'));
  protected readonly announcement = computed(() => {
    if (this.state() === 'loading') return 'Loading audit events';
    if (this.state() === 'error') return 'Could not load audit events';
    const n = this.items().length;
    return n === 0
      ? 'No audit events'
      : `Showing ${n} audit events${this.nextCursor() !== null ? ', more available' : ''}`;
  });
  /** The current filters, for resetting the scroll position of the grid. */
  protected readonly resetKey = computed(() => JSON.stringify(this.filters.queryParams()));

  constructor() {
    if (!this.canView()) return;
    void this.loadFacets();
    if (this.canLookUpUsers()) void this.loadActors();
    // Loads the first page, and again whenever a filter changes.
    effect(() => {
      this.resetKey(); // the filters as text: options arriving later do not reload the events
      untracked(() => void this.load(true));
    });
    // The controls move into the sheet while the grid scrolls sideways.
    afterNextRender(() => this.filters.watchOverflow(this.scroll()?.nativeElement), {
      injector: this.injector,
    });
  }

  protected reset(): void {
    this.filters.clear();
  }

  /** Narrows the list to the events of one operation (and drops the other filters, which would hide part of it). */
  protected showOperation(item: AuditSearchItem): void {
    this.filters.applyPreset({ correlationId: item.correlationId });
  }

  protected loadMore(): void {
    void this.load(false);
  }

  protected retry(): void {
    void this.load(true);
  }

  // ---- Rows

  protected toggle(item: AuditSearchItem): void {
    this.expanded.update((s) => {
      const next = new Set(s);
      if (!next.delete(item.auditEventId)) next.add(item.auditEventId);
      return next;
    });
  }

  protected toggleGroup(group: AuditGroup): void {
    this.openGroups.update((s) => {
      const next = new Set(s);
      if (!next.delete(group.key)) next.add(group.key);
      return next;
    });
  }

  protected toggleFields(group: AuditGroup): void {
    this.openFieldGroups.update((s) => {
      const next = new Set(s);
      if (!next.delete(group.key)) next.add(group.key);
      return next;
    });
  }

  protected isFieldsOpen = (group: AuditGroup) => this.openFieldGroups().has(group.key);
  protected headline = groupHeadline;
  protected objectItem = groupObjectItem;
  protected split = splitGroup;
  protected isOpen = (item: AuditSearchItem) => this.expanded().has(item.auditEventId);
  protected isGroupOpen = (group: AuditGroup) => this.openGroups().has(group.key);
  protected route = (item: AuditSearchItem) =>
    auditObjectRoute(item, (permission) => this.auth.has(permission));
  protected objectText = auditObjectText;
  protected friendly = friendlyText;
  protected fieldName = fieldLabel;

  protected valueText(value: string | undefined, truncated: boolean): string {
    if (value === undefined || value === null || value === '') return '(empty)';
    return truncated ? `${value} ... (shortened)` : value;
  }

  // ---- Loading

  private async loadFacets(): Promise<void> {
    try {
      this.facets.set(await firstValueFrom(this.api.getAuditFacets()));
    } catch {
      // The filter lists stay empty; the events still load.
    }
  }

  private async loadActors(): Promise<void> {
    try {
      const people: FilterOption[] = [];
      const inactive: string[] = [];
      for (let page = 1; page <= ACTOR_PAGES; page++) {
        const result = await firstValueFrom(
          this.users.listUsers(
            'all',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            page,
            100,
          ),
        );
        for (const u of result.items) {
          people.push({ value: String(u.userId), label: u.displayName });
          if (!u.isActive) inactive.push(String(u.userId));
        }
        if (people.length >= result.total) break;
      }
      this.actors.set(
        people
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
          .map((p) => (inactive.includes(p.value) ? { ...p, hint: '(inactive)' } : p)),
      );
    } catch {
      // Without the list the filter offers nobody; an actor in the address still filters and shows as a chip.
    }
  }

  private async load(reset: boolean): Promise<void> {
    const id = ++this.requestId;
    if (reset) {
      this.state.set('loading');
      this.expanded.set(new Set());
      this.openGroups.set(new Set());
      this.openFieldGroups.set(new Set());
    } else {
      this.loadingMore.set(true);
    }
    const f = this.filters;
    const rawActor = f.value('actor');
    const actors = (Array.isArray(rawActor) ? rawActor : rawActor ? [String(rawActor)] : [])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    const range = f.value('when');
    const when = typeof range === 'object' && 'from' in range ? range : { from: '', to: '' };
    try {
      const page = await firstValueFrom(
        this.api.searchAuditEvents(
          f.text('objectType') || undefined,
          f.text('objectId').trim() || undefined,
          actors.length > 0 ? actors : undefined,
          f.text('eventType') || undefined,
          when.from || undefined,
          when.to || undefined,
          f.text('q').trim() || undefined,
          f.text('correlationId') || undefined,
          reset ? undefined : (this.nextCursor() ?? undefined),
          PAGE_SIZE,
        ),
      );
      if (id !== this.requestId) return;
      this.items.update((list) => (reset ? page.items : [...list, ...page.items]));
      this.nextCursor.set(page.nextCursor ?? null);
      this.state.set('ready');
    } catch {
      if (id === this.requestId) this.state.set('error');
    } finally {
      if (id === this.requestId) this.loadingMore.set(false);
    }
  }
}
