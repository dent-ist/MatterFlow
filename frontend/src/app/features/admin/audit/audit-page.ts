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
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { presetRange, todayInZone } from '../../../shared/filters/date-presets';
import { FilterDef, FilterOption, RangeValue } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { AdminListShell } from '../../../shared/ui/admin-list-shell';
import {
  eventTypeLabel,
  fieldLabel,
  friendlyText,
  objectTypeLabel,
} from '../../../shared/ui/audit-format';
import { LoadState } from '../../../shared/ui/data-table';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { RecordCardDef, RecordCardList, phoneCards } from '../../../shared/ui/record-card-list';
import { RowActionsMenu, rowActions } from '../../../shared/ui/row-actions';
import { viewportAtLeast } from '../../../shared/ui/viewport';
import {
  ACCESS_OBJECT_TYPES,
  AuditGroup,
  CONFIGURATION_OBJECT_TYPES,
  auditObjectLink,
  auditObjectText,
  groupByCorrelation,
  groupHeadline,
  groupObjectItem,
  splitGroup,
} from './audit-links';
import {
  AuditBlock,
  clockText,
  eventPhrase,
  isLongValue,
  stampText,
  withDayDividers,
} from './audit-rows';

const PAGE_SIZE = 50;
/** People offered in the Who filter: the first pages of the user list (100 each). */
const ACTOR_PAGES = 5;

/** The Who column is its own column from this window width; below it the person joins the When cell (#647). */
const WHO_ROOM = 1100;

/** From this many loaded events the counter suggests narrowing the dates (#653). */
export const MANY_EVENTS = 1000;

/** A quick view (#654): filters, not counts. `config` and `access` set the Object type to a group of types. */
export type QuickView = 'today' | 'last7' | 'config' | 'access';

export const QUICK_VIEWS: readonly { key: QuickView; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'config', label: 'Configuration changes' },
  { key: 'access', label: 'Access changes' },
];

const CONFIG_VALUE = CONFIGURATION_OBJECT_TYPES.join(',');
const ACCESS_VALUE = ACCESS_OBJECT_TYPES.join(',');

/**
 * Admin Audit Log (UX Audit screen, Audit.View) on the admin list shell (#646): crumb, Filters with its count and the one Clear in the header,
 * the filter row open from 640 px. Inline column filters (When with presets in the viewer's zone, Who, What happened: event type and summary
 * or field text, Object: type and id) apply live and live in the address (`from`, `to`, `actor`, `eventType`, `q`, `objectType`, `objectId`,
 * `correlationId`). Results newest first on the grid contract (#647): a day divider ("Today", "Oct 19") and the time alone in the When column
 * (#655), Who joining the When cell below 1100 px, phone cards below 640 px; one readable sentence per event, an optional grouping of the
 * events of one operation, details with the Old -> New pair and the technical facts on request (#652), links to the audited object only
 * where the viewer may open it (#648), four quick views (#654), the count of what is loaded (#653) and cursor paging ("Load more").
 * Read only: there is no export.
 */
@Component({
  selector: 'mf-audit-page',
  imports: [
    ActionMenu,
    AdminListShell,
    ColumnFilterRow,
    FiltersBar,
    GridBody,
    NgTemplateOutlet,
    RecordCardDef,
    RecordCardList,
    RouterLink,
    ScrollArea,
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
  private readonly clock = inject(Clock);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');
  protected readonly zone = inject(USER_TIME_ZONE);
  protected readonly phone = phoneCards();
  private readonly whoRoom = viewportAtLeast(WHO_ROOM);
  private requestId = 0;
  /** Set by "Show only this operation": focus moves to the filter chip that now names it (BUG-6). */
  private focusChipPending = false;

  protected readonly canView = computed(() => this.auth.has('Audit.View'));
  protected readonly canLookUpUsers = computed(() => this.auth.has('User.View'));
  protected readonly whoShown = computed(() => this.whoRoom());
  /** The columns on screen, in order (the keys the filter definitions point at). */
  protected readonly columns = computed<readonly string[]>(() => [
    'details',
    'when',
    ...(this.whoShown() ? ['who'] : []),
    'what',
    'object',
    'actions',
  ]);
  protected readonly colCount = computed(() => this.columns().length);
  protected readonly whenHint = computed(
    () => `Times are shown in your time zone (${this.zone}); the date filters use it too.`,
  );
  protected readonly views = QUICK_VIEWS;

  protected readonly facets = signal<AuditFacets>({ objectTypes: [], eventTypes: [] });
  /** People to choose from in the Who filter (needs User.View); inactive ones stay selectable. */
  private readonly actors = signal<FilterOption[]>([]);
  /** Without User.View: the people who appear in the events loaded so far (name by id), the type-ahead list of the Who filter (#656). */
  private readonly seenActors = signal<ReadonlyMap<number, string>>(new Map());
  protected readonly items = signal<AuditSearchItem[]>([]);
  protected readonly nextCursor = signal<number | null>(null);
  protected readonly state = signal<LoadState>('loading');
  protected readonly loadingMore = signal(false);
  /** Events of one operation are grouped by default: one line per operation, field-level changes on request. */
  protected readonly grouped = signal(true);
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());
  protected readonly openGroups = signal<ReadonlySet<string>>(new Set());
  protected readonly openFieldGroups = signal<ReadonlySet<string>>(new Set());
  /** Events whose technical details are open, and the long values shown whole ("<id>:old" / "<id>:new"). */
  protected readonly techOpen = signal<ReadonlySet<number>>(new Set());
  protected readonly fullValues = signal<ReadonlySet<string>>(new Set());

  /**
   * One definition per filter. They apply live (text after a short pause) and are written to the address, so a filtered view can be
   * shared. `correlationId` has no control: "Show only this operation" sets it and a removable chip shows it.
   */
  protected readonly filters: ListFilters = new ListFilters({
    screen: 'audit',
    noun: 'audit events',
    openByDefault: true,
    sheetBelow: 640,
    visibleColumns: computed(() => (this.phone() ? null : this.columns())),
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
      {
        key: 'actor',
        label: 'Who',
        column: 'who',
        type: 'user',
        // With User.View the whole directory; without it the names present in the events loaded so far (the value is the id either way).
        options: this.canLookUpUsers() ? this.actors() : this.seenActorOptions(),
        emptyLabel: 'Anyone',
        normalize: (v) => (/^[1-9]\d{0,9}$/.test(v) ? v : null),
      },
      {
        key: 'eventType',
        label: 'Event type',
        column: 'what',
        type: 'select',
        allLabel: 'Any event',
        options: this.facets()
          .eventTypes.map((t) => ({ value: t, label: eventTypeLabel(t) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      },
      { key: 'q', label: 'Summary or field', column: 'what', type: 'text' },
      {
        key: 'objectType',
        label: 'Object type',
        column: 'object',
        type: 'select',
        allLabel: 'Any object',
        options: [
          { value: CONFIG_VALUE, label: 'Configuration changes' },
          { value: ACCESS_VALUE, label: 'Access changes' },
          ...this.facets()
            .objectTypes.map((t) => ({ value: t, label: objectTypeLabel(t) }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        ],
        normalize: (v) => (v.length <= 200 ? v : null),
      },
      {
        key: 'objectId',
        label: 'Object id',
        column: 'object',
        type: 'text',
        maxLength: 40,
        disabledReason: () => {
          const type = this.filters.text('objectType');
          if (!type) return 'Choose an object type first';
          return type.includes(',') ? 'Choose one object type first' : null;
        },
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

  private seenActorOptions(): FilterOption[] {
    return [...this.seenActors()]
      .map(([id, name]) => ({ value: String(id), label: name }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  }

  protected readonly groups = computed<AuditGroup[]>(() =>
    this.grouped()
      ? groupByCorrelation(this.items())
      : this.items().map((item) => ({
          key: `${item.correlationId}:${item.auditEventId}`,
          items: [item],
        })),
  );
  /** The top-level rows with the day dividers (#655). */
  protected readonly blocks = computed<AuditBlock[]>(() =>
    withDayDividers(this.groups(), this.zone, this.clock.now()),
  );
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
  /** "150 events loaded" (#653), spoken politely when it changes. */
  protected readonly loadedText = computed(() => {
    const n = this.items().length;
    return `${n.toLocaleString('en-US')} ${n === 1 ? 'event' : 'events'} loaded`;
  });
  protected readonly manyLoaded = computed(() => this.items().length >= MANY_EVENTS);
  /** The current filters, for resetting the scroll position of the grid. */
  protected readonly resetKey = computed(() => JSON.stringify(this.filters.queryParams()));

  /** The quick view the address stands for, or null (#654): its own filters set and no others. */
  protected readonly activeView = computed<QuickView | null>(() => {
    const count = this.filters.activeCount();
    if (count !== 1) return null;
    const type = this.filters.text('objectType');
    if (type === CONFIG_VALUE) return 'config';
    if (type === ACCESS_VALUE) return 'access';
    const range = this.filters.value('when') as RangeValue;
    const today = todayInZone(this.clock.now(), this.zone);
    for (const key of ['today', 'last7'] as const) {
      const r = presetRange(key, today);
      if (r && r.from === range.from && r.to === range.to) return key;
    }
    return null;
  });

  /** The overflow menu of each row: details, and the one operation (#651). Keyed `e<id>` and `g<key>`. */
  protected readonly menus = computed(() => {
    const out = new Map<string, RowActionsMenu>();
    const can = (p: string) => this.auth.has(p);
    const expanded = this.expanded();
    const openGroups = this.openGroups();
    for (const g of this.groups()) {
      const operation = (item: AuditSearchItem) => ({
        id: 'operation',
        label: 'Show only this operation',
        icon: 'pi-filter',
        run: () => this.showOperation(item),
      });
      if (g.items.length > 1) {
        const first = g.items[0];
        out.set(
          'g' + g.key,
          rowActions(
            groupHeadline(g),
            [
              {
                id: 'events',
                label: `${openGroups.has(g.key) ? 'Hide' : 'Show'} the ${g.items.length} events`,
                icon: 'pi-list',
                run: () => this.toggleGroup(g),
              },
              operation(first),
            ],
            { can },
          ),
        );
      }
      for (const item of g.items) {
        out.set(
          'e' + item.auditEventId,
          rowActions(
            eventPhrase(item),
            [
              {
                id: 'details',
                label: expanded.has(item.auditEventId) ? 'Hide details' : 'Show details',
                icon: 'pi-info-circle',
                run: () => this.toggle(item),
              },
              ...(item.correlationEventCount > 1 && g.items.length === 1 ? [operation(item)] : []),
            ],
            { can },
          ),
        );
      }
    }
    return out;
  });

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
    // "Show only this operation" ends on the chip that names the operation, not on a row that has just left the list.
    effect(() => {
      if (!this.operationId() || !this.focusChipPending) return;
      this.focusChipPending = false;
      afterNextRender(
        () =>
          document.querySelector<HTMLElement>('[data-chip="correlationId"] button.fch__x')?.focus(),
        { injector: this.injector },
      );
    });
  }

  protected reset(): void {
    this.filters.clear();
  }

  /** Narrows the list to the events of one operation (and drops the other filters, which would hide part of it). */
  protected showOperation(item: AuditSearchItem): void {
    this.focusChipPending = true;
    this.filters.applyPreset({ correlationId: item.correlationId });
  }

  protected loadMore(): void {
    void this.load(false);
  }

  protected retry(): void {
    void this.load(true);
  }

  // ---- Quick views

  protected pickView(key: QuickView): void {
    if (this.activeView() === key) {
      this.filters.clear();
      return;
    }
    const today = todayInZone(this.clock.now(), this.zone);
    switch (key) {
      case 'today':
      case 'last7':
        this.filters.applyPreset({ when: presetRange(key, today) ?? { from: '', to: '' } });
        break;
      case 'config':
        this.filters.applyPreset({ objectType: CONFIG_VALUE });
        break;
      case 'access':
        this.filters.applyPreset({ objectType: ACCESS_VALUE });
        break;
    }
  }

  /** The hint after 1,000 events: opens the date filter (the row, or the sheet on a phone) and focuses When. */
  protected narrowDates(): void {
    this.filters.reveal();
    afterNextRender(
      () =>
        document
          .querySelector<HTMLElement>(
            '[data-filter-row] [data-filter="when"], [role="dialog"] [data-filter="when"]',
          )
          ?.focus(),
      { injector: this.injector },
    );
  }

  // ---- Rows

  private flip<T>(
    signalOf: { update: (fn: (s: ReadonlySet<T>) => ReadonlySet<T>) => void },
    key: T,
  ) {
    signalOf.update((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  protected toggle(item: AuditSearchItem): void {
    this.flip(this.expanded, item.auditEventId);
  }

  protected toggleGroup(group: AuditGroup): void {
    this.flip(this.openGroups, group.key);
  }

  protected toggleFields(group: AuditGroup): void {
    this.flip(this.openFieldGroups, group.key);
  }

  protected toggleTech(item: AuditSearchItem): void {
    this.flip(this.techOpen, item.auditEventId);
  }

  protected toggleFull(item: AuditSearchItem, which: 'old' | 'new'): void {
    this.flip(this.fullValues, `${item.auditEventId}:${which}`);
  }

  protected isFieldsOpen = (group: AuditGroup) => this.openFieldGroups().has(group.key);
  protected headline = groupHeadline;
  protected objectItem = groupObjectItem;
  protected split = splitGroup;
  protected isOpen = (item: AuditSearchItem) => this.expanded().has(item.auditEventId);
  protected isTechOpen = (item: AuditSearchItem) => this.techOpen().has(item.auditEventId);
  protected isFull = (item: AuditSearchItem, which: 'old' | 'new') =>
    this.fullValues().has(`${item.auditEventId}:${which}`);
  protected isGroupOpen = (group: AuditGroup) => this.openGroups().has(group.key);
  protected link = (item: AuditSearchItem) =>
    auditObjectLink(item, (permission) => this.auth.has(permission));
  protected objectText = auditObjectText;
  protected friendly = friendlyText;
  protected fieldName = fieldLabel;
  protected phrase = eventPhrase;
  protected isLong = isLongValue;
  protected objectLabel = objectTypeLabel;
  protected eventLabel = eventTypeLabel;
  protected clock12 = (item: AuditSearchItem) => clockText(item, this.zone);
  protected stamp = (item: AuditSearchItem) => stampText(item, this.zone);
  protected menuOf = (key: string) => this.menus().get(key) ?? null;

  /** The sentence that opens the details: what happened, who did it and when. */
  protected sentence(item: AuditSearchItem): string {
    return `${eventPhrase(item)}, ${stampText(item, this.zone)}.`;
  }

  /** True when the event changed a value (or has one to show): the details then lead with the Old -> New pair. */
  protected hasPair(item: AuditSearchItem): boolean {
    return !!item.fieldKey || item.oldValue != null || item.newValue != null;
  }

  protected valueText(value: string | undefined | null): string {
    return value === undefined || value === null || value === '' ? '(empty)' : value;
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

  private rememberActors(page: readonly AuditSearchItem[]): void {
    const known = this.seenActors();
    let next: Map<number, string> | null = null;
    for (const item of page) {
      const id = item.actor.userId;
      if (id != null && known.get(id) !== item.actor.displayName) {
        next ??= new Map(known);
        next.set(id, item.actor.displayName);
      }
    }
    if (next) this.seenActors.set(next);
  }

  private async load(reset: boolean): Promise<void> {
    const id = ++this.requestId;
    if (reset) {
      this.state.set('loading');
      this.expanded.set(new Set());
      this.openGroups.set(new Set());
      this.openFieldGroups.set(new Set());
      this.techOpen.set(new Set());
      this.fullValues.set(new Set());
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
      this.rememberActors(page.items);
      this.nextCursor.set(page.nextCursor ?? null);
      this.state.set('ready');
    } catch {
      if (id === this.requestId) this.state.set('error');
    } finally {
      if (id === this.requestId) this.loadingMore.set(false);
    }
  }
}
