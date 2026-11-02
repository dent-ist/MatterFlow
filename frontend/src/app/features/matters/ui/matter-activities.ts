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
import { firstValueFrom } from 'rxjs';
import { AuditEventDto, AuditEventsClient, UsersClient } from '../../../api/generated/api-client';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { describeAuditEvent, isNoise } from '../../../shared/ui/audit-format';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { GridFrame } from '../../../shared/ui/grid-frame';

/** The words of the Kind dropdown for the audit event codes of a matter; a code that is not listed is shown in plain sentence case. */
const KIND_LABELS: Readonly<Record<string, string>> = {
  FIELD_CHANGED: 'Changes',
  MATTER_CREATED: 'Created',
  MATTER_SENSITIVITY_CHANGED: 'Sensitivity',
  MATTER_MANAGER_CHANGED: 'Managers',
  MATTER_ACTIVATED: 'Status',
  MATTER_DEACTIVATED: 'Status',
  MATTER_NUMBER_CHANGED: 'Number',
};

const ALL = '';
const seenKey = (matterId: number) => `mf.matter-activity-seen.${matterId}`;

function kindOf(e: AuditEventDto): string {
  const known = KIND_LABELS[e.eventType];
  if (known) return known;
  const words = e.eventType.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The Activities tab of a Matter (MD-07, #1008; owner decision AQ.7): the matter's history in the My Matters grid style: When, Who and one What cell, newest first, a Kind dropdown
 * and a banner "N new since your last visit" (the last visit is remembered in this browser only). It lists the events the audit trail holds for the matter; the Production and Note kinds
 * arrive with their modules. Needs `Audit.View` (the tab is not offered without it).
 */
@Component({
  selector: 'mf-matter-activities',
  imports: [GridFrame, Dropdown, MfDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styles: `
    .ma__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
      padding: var(--mf-s3);
    }
    .ma__title {
      margin: 0;
      font-size: var(--mf-fs-lg);
      font-weight: 700;
    }
    .ma__banner {
      margin: 0 var(--mf-s3) var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      border-radius: var(--mf-radius-md);
      background: var(--mf-sem-info-bg);
      color: var(--mf-sem-info-fg);
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      padding: var(--mf-s2) var(--mf-s3);
      border-bottom: 1px solid var(--mf-border-soft);
      text-align: left;
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--mf-surface);
      color: var(--mf-text-muted);
      font-weight: 600;
    }
    td.ma__when {
      white-space: nowrap;
      color: var(--mf-text-muted);
    }
    .ma__new {
      margin-left: var(--mf-s1);
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius-pill);
      background: var(--mf-sem-info-bg);
      color: var(--mf-sem-info-fg);
      font-size: var(--mf-fs-xs);
    }
    .ma__muted {
      margin: 0;
      padding: var(--mf-s3);
      color: var(--mf-text-muted);
    }
  `,
  template: `
    <mf-grid-frame scrollLabel="Matter activities">
      <div frameHead class="ma__head">
        <h2 class="ma__title">Activities</h2>
        <mf-dropdown
          buttonId="ma-kind"
          label="Kind"
          prefix="Kind:"
          size="sm"
          [items]="kindItems()"
          [value]="kind()"
          (valueChange)="kind.set($event)"
          neutralValue=""
        />
      </div>
      <div frameStatus>
        @if (newCount() > 0) {
          <p class="ma__banner" role="status" data-new-banner>
            {{ newCount() }} new since your last visit
          </p>
        }
      </div>
      @switch (state()) {
        @case ('loading') {
          <p class="ma__muted" role="status" aria-busy="true">Loading activities...</p>
        }
        @case ('error') {
          <p class="ma__muted" role="alert" data-error>We couldn't load the activities.</p>
        }
        @default {
          @if (shown().length === 0) {
            <p class="ma__muted" data-empty>No activity recorded yet.</p>
          } @else {
            <table data-activities>
              <caption class="mf-sr-only">
                Activities of this matter, newest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What</th>
                  <th scope="col">Who</th>
                </tr>
              </thead>
              <tbody>
                @for (e of shown(); track e.auditEventId) {
                  <tr data-activity-row>
                    <td class="ma__when">
                      <time [attr.datetime]="e.occurredAtUtc">{{ e.occurredAtUtc | mfDate }}</time>
                    </td>
                    <td>
                      {{ describe(e) }}
                      @if (isNew(e)) {
                        <span class="ma__new" data-new>New</span>
                      }
                    </td>
                    <td>{{ actor(e) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        }
      }
      <div frameFoot>
        @if (hasMore()) {
          <button type="button" class="mf-btn" data-show-more (click)="fetch()">Show more</button>
        }
      </div>
    </mf-grid-frame>
  `,
})
export class MatterActivities {
  readonly matterId = input.required<number>();

  private readonly api = inject(AuditEventsClient);
  private readonly users = inject(UsersClient);
  private readonly actors = signal<ReadonlyMap<number, string>>(new Map());
  private nextAfter: number | undefined;
  /** The highest event id the person had seen when this visit began (0 when there was no earlier visit). */
  private seenBefore = 0;

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly events = signal<AuditEventDto[]>([]);
  protected readonly hasMore = signal(false);
  protected readonly kind = signal(ALL);
  protected readonly shown = computed(() =>
    this.kind() === ALL ? this.events() : this.events().filter((e) => kindOf(e) === this.kind()),
  );
  protected readonly kindItems = computed<DropdownItem[]>(() => {
    const counts = new Map<string, number>();
    for (const e of this.events()) counts.set(kindOf(e), (counts.get(kindOf(e)) ?? 0) + 1);
    return [
      { value: ALL, label: 'All kinds', count: this.events().length },
      ...[...counts].sort().map(([label, count]) => ({ value: label, label, count })),
    ];
  });
  protected readonly newCount = computed(() => this.events().filter((e) => this.isNew(e)).length);

  constructor() {
    effect(() => {
      const id = this.matterId();
      untracked(() => {
        this.events.set([]);
        this.nextAfter = undefined;
        this.seenBefore = this.readSeen(id);
        void this.fetch().then(() => this.rememberVisit(id));
      });
    });
  }

  protected isNew(e: AuditEventDto): boolean {
    return this.seenBefore > 0 && e.auditEventId > this.seenBefore;
  }

  protected describe(e: AuditEventDto): string {
    return describeAuditEvent(e, this.actor(e));
  }

  protected actor(e: AuditEventDto): string {
    if (e.actorUserId === undefined || e.actorUserId === null) return 'System';
    return this.actors().get(e.actorUserId) ?? `User ${e.actorUserId}`;
  }

  private readSeen(id: number): number {
    try {
      return Number(localStorage.getItem(seenKey(id))) || 0;
    } catch {
      return 0;
    }
  }

  private rememberVisit(id: number): void {
    const newest = Math.max(0, ...this.events().map((e) => e.auditEventId));
    if (newest === 0) return;
    try {
      localStorage.setItem(seenKey(id), String(newest));
    } catch {
      // Private window or blocked storage: the banner simply never appears.
    }
  }

  protected async fetch(): Promise<void> {
    try {
      const page = await firstValueFrom(
        this.api.listAuditEvents('Matter', String(this.matterId()), this.nextAfter, 50),
      );
      await this.resolveActors(page.items);
      // The API pages oldest first; the grid shows the newest event on top.
      this.events.update((list) =>
        [...list, ...page.items.filter((e) => !isNoise(e))].sort(
          (a, b) => b.auditEventId - a.auditEventId,
        ),
      );
      this.nextAfter = page.nextAfterId ?? undefined;
      this.hasMore.set(page.nextAfterId !== undefined && page.nextAfterId !== null);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  private async resolveActors(events: AuditEventDto[]): Promise<void> {
    const known = this.actors();
    const missing = [
      ...new Set(events.map((e) => e.actorUserId).filter((id): id is number => id != null)),
    ].filter((id) => !known.has(id));
    if (missing.length === 0) return;
    const found = await Promise.all(
      missing.map(async (id) => {
        try {
          const user = await firstValueFrom(this.users.getUser(id));
          return [id, user.windowsAccount || user.displayName] as const;
        } catch {
          return null;
        }
      }),
    );
    this.actors.update((m) => new Map([...m, ...found.filter((f) => f !== null)]));
  }
}
