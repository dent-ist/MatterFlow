import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AuditFacets,
  AuditSearchClient,
  AuditSearchItem,
  UserSummaryDto,
  UsersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { DateInput } from 'form-engine';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { fieldLabel, friendlyText } from '../../../shared/ui/audit-format';
import { AuditGroup, auditObjectRoute, auditObjectText, groupByCorrelation } from './audit-links';
import { ListState } from '../../../shared/ui/data-table';
import { PageHeader } from '../../../shared/ui/page-header';

type LoadState = 'loading' | 'ready' | 'error';

interface Filters {
  objectType: string;
  objectId: string;
  actor: UserSummaryDto | null;
  actorId: string;
  eventType: string;
  from: string;
  to: string;
  q: string;
  correlationId: string;
}

const EMPTY: Filters = {
  objectType: '',
  objectId: '',
  actor: null,
  actorId: '',
  eventType: '',
  from: '',
  to: '',
  q: '',
  correlationId: '',
};

const PAGE_SIZE = 50;
const ACTOR_DEBOUNCE_MS = 250;

/**
 * Admin Audit Log (UX Audit screen, Audit.View): filter bar (object, actor, event type, dates in the viewer's zone, free text), results
 * newest first with a readable sentence per event, expandable old/new values, an optional grouping of the events of one operation
 * (bulk actions), links to the audited object, and cursor paging ("Load more"). Read only: there is no export.
 */
@Component({
  selector: 'mf-audit-page',
  imports: [PageHeader, DateInput, ListState, RouterLink, MfDatePipe, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './audit-page.html',
  styleUrl: './audit-page.scss',
})
export class AuditPage implements OnDestroy {
  private readonly api = inject(AuditSearchClient);
  private readonly users = inject(UsersClient);
  private readonly auth = inject(AuthStore);
  protected readonly zone = inject(USER_TIME_ZONE);
  private actorTimer: ReturnType<typeof setTimeout> | undefined;
  private requestId = 0;

  protected readonly canView = computed(() => this.auth.has('Audit.View'));
  protected readonly canLookUpUsers = computed(() => this.auth.has('User.View'));

  protected readonly draft = signal<Filters>({ ...EMPTY });
  /** The filters the shown results were loaded with. */
  protected readonly applied = signal<Filters>({ ...EMPTY });
  protected readonly facets = signal<AuditFacets>({ objectTypes: [], eventTypes: [] });
  protected readonly items = signal<AuditSearchItem[]>([]);
  protected readonly nextCursor = signal<number | null>(null);
  protected readonly state = signal<LoadState>('loading');
  protected readonly loadingMore = signal(false);
  protected readonly grouped = signal(false);
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());
  protected readonly openGroups = signal<ReadonlySet<string>>(new Set());
  protected readonly dateError = signal('');
  /** A date field holds text that is not a date (its own message is shown); applying is held back. */
  protected readonly badFrom = signal(false);
  protected readonly badTo = signal(false);
  private readonly dateInputs = viewChildren(DateInput);

  protected readonly actorMatches = signal<UserSummaryDto[]>([]);
  protected readonly actorQuery = signal('');

  protected readonly groups = computed<AuditGroup[]>(() => groupByCorrelation(this.items()));
  protected readonly filtered = computed(() => {
    const a = this.applied();
    return Object.entries(a).some(([key, value]) =>
      key === 'actor' ? value !== null : value !== '',
    );
  });
  protected readonly announcement = computed(() => {
    if (this.state() === 'loading') return 'Loading audit events';
    if (this.state() === 'error') return 'Could not load audit events';
    const n = this.items().length;
    return n === 0
      ? 'No audit events'
      : `Showing ${n} audit events${this.nextCursor() !== null ? ', more available' : ''}`;
  });

  constructor() {
    if (!this.canView()) return;
    void this.loadFacets();
    void this.load(true);
  }

  ngOnDestroy(): void {
    clearTimeout(this.actorTimer);
  }

  protected set<K extends keyof Filters>(key: K, value: Filters[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  protected apply(): void {
    if (this.badFrom() || this.badTo()) return;
    const { from, to } = this.draft();
    if (from && to && from > to) {
      this.dateError.set('The start date must not be after the end date.');
      return;
    }
    this.dateError.set('');
    this.applied.set({ ...this.draft() });
    void this.load(true);
  }

  protected reset(): void {
    this.draft.set({ ...EMPTY });
    this.actorQuery.set('');
    this.actorMatches.set([]);
    this.dateError.set('');
    this.dateInputs().forEach((d) => d.clear());
    this.applied.set({ ...EMPTY });
    void this.load(true);
  }

  protected showOperation(item: AuditSearchItem): void {
    this.draft.set({ ...EMPTY, correlationId: item.correlationId });
    this.applied.set({ ...this.draft() });
    void this.load(true);
  }

  protected loadMore(): void {
    void this.load(false);
  }

  protected retry(): void {
    void this.load(true);
  }

  // ---- Actor typeahead

  protected onActorInput(text: string): void {
    this.actorQuery.set(text);
    clearTimeout(this.actorTimer);
    if (this.draft().actor) this.set('actor', null);
    if (text.trim().length < 2) {
      this.actorMatches.set([]);
      return;
    }
    this.actorTimer = setTimeout(() => void this.lookUpActors(text.trim()), ACTOR_DEBOUNCE_MS);
  }

  protected pickActor(user: UserSummaryDto): void {
    this.set('actor', user);
    this.actorQuery.set(user.displayName);
    this.actorMatches.set([]);
  }

  protected clearActor(): void {
    this.set('actor', null);
    this.actorQuery.set('');
    this.actorMatches.set([]);
  }

  private async lookUpActors(text: string): Promise<void> {
    try {
      const page = await firstValueFrom(this.users.listUsers('all', text, 1, 8));
      this.actorMatches.set(page.items);
    } catch {
      this.actorMatches.set([]);
    }
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

  protected isOpen = (item: AuditSearchItem) => this.expanded().has(item.auditEventId);
  protected isGroupOpen = (group: AuditGroup) => this.openGroups().has(group.key);
  protected route = auditObjectRoute;
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

  private async load(reset: boolean): Promise<void> {
    const id = ++this.requestId;
    if (reset) {
      this.state.set('loading');
      this.expanded.set(new Set());
      this.openGroups.set(new Set());
    } else {
      this.loadingMore.set(true);
    }
    const f = this.applied();
    const actor = f.actor?.userId ?? (f.actorId ? Number(f.actorId) : undefined);
    try {
      const page = await firstValueFrom(
        this.api.searchAuditEvents(
          f.objectType || undefined,
          f.objectId.trim() || undefined,
          actor && Number.isFinite(actor) ? actor : undefined,
          f.eventType || undefined,
          f.from || undefined,
          f.to || undefined,
          f.q.trim() || undefined,
          f.correlationId || undefined,
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
