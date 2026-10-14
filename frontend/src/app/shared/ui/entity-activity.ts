import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuditEventDto, AuditEventsClient, UsersClient } from '../../api/generated/api-client';
import { LocalTimePipe } from '../pipes/local-time.pipe';
import { describeAuditEvent, isNoise } from './audit-format';

/** Change history of one object (UX `mf-activity-feed`), read from the audit trail. Needs `Audit.View`; hide the host tab otherwise. */
@Component({
  selector: 'mf-entity-activity',
  imports: [LocalTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state()) {
      @case ('loading') {
        <p class="mf-activity__muted" role="status" aria-busy="true">Loading activity...</p>
      }
      @case ('error') {
        <p class="mf-activity__muted" role="alert">We couldn't load the activity.</p>
      }
      @default {
        @if (events().length === 0) {
          <p class="mf-activity__muted">No activity recorded yet.</p>
        } @else {
          <ol class="mf-activity" aria-label="Activity">
            @for (e of events(); track e.auditEventId) {
              <li>
                <time [attr.datetime]="e.occurredAtUtc">{{ e.occurredAtUtc | localTime }}</time>
                <span class="mf-activity__what">{{ describe(e) }}</span>
                <span class="mf-activity__who">{{ actor(e) }}</span>
              </li>
            }
          </ol>
          @if (hasMore()) {
            <button type="button" class="mf-activity__more" (click)="more()">Show more</button>
          }
        }
      }
    }
  `,
  styles: `
    .mf-activity {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: var(--mf-s2);
    }
    .mf-activity li {
      display: grid;
      grid-template-columns: 14rem 1fr auto;
      gap: var(--mf-s3);
      padding: var(--mf-s2) 0;
      border-bottom: 1px solid var(--mf-border);
    }
    .mf-activity__who {
      color: var(--mf-text-muted);
    }
    .mf-activity__muted {
      color: var(--mf-text-muted);
    }
    .mf-activity__more {
      margin-top: var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s4);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      font: inherit;
      cursor: pointer;
    }
  `,
})
export class EntityActivity {
  /** Audit `ObjectType`, for example `Client`. */
  readonly objectType = input.required<string>();
  readonly objectId = input.required<number | string>();

  private readonly api = inject(AuditEventsClient);
  private readonly users = inject(UsersClient);
  private readonly actors = signal<ReadonlyMap<number, string>>(new Map());

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly events = signal<AuditEventDto[]>([]);
  protected readonly hasMore = signal(false);
  private nextAfter: number | undefined;

  constructor() {
    effect(() => {
      this.objectType();
      this.objectId();
      untracked(() => {
        this.events.set([]);
        this.nextAfter = undefined;
        void this.fetch();
      });
    });
  }

  protected more(): void {
    void this.fetch();
  }

  protected actor(e: AuditEventDto): string {
    return this.actorName(e);
  }

  protected describe(e: AuditEventDto): string {
    return describeAuditEvent(e, this.actorName(e));
  }

  private actorName(e: AuditEventDto): string {
    if (e.actorUserId === undefined || e.actorUserId === null) return 'System';
    return this.actors().get(e.actorUserId) ?? `User ${e.actorUserId}`;
  }

  /** Names for the actors of the loaded events; an actor the viewer may not look up stays "User <id>". */
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

  private async fetch(): Promise<void> {
    try {
      const page = await firstValueFrom(
        this.api.listAuditEvents(this.objectType(), String(this.objectId()), this.nextAfter, 50),
      );
      await this.resolveActors(page.items);
      // The API pages oldest first; the feed shows the newest event on top.
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
}
