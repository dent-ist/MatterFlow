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
import { MatterSummaryResponse, MattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { OPEN_STATUSES, dateDaysAgo } from '../../../shared/work-queue/queue-filters';
import { recordStripItems } from '../../../shared/work-queue/record-strip';
import { DUE_SOON_DAYS, VIEW_TIPS } from '../../../shared/work-queue/work-vocabulary';
import { WorkStrip, WorkStripItem } from '../../../shared/work-queue/work-strip';

/**
 * The one count strip of a matter record, under its header and on every tab (epic #667; issue #816 merged the Overview's own strip into it, so
 * no number is shown twice): Open, Overdue, Due soon, ASAP, Unassigned and On hold of this matter, each a link to the Task Queue scoped to
 * the matter, so every number equals the total of the grid it opens. Nothing is drawn, and nothing is asked for,
 * without `Task.View`. It is not a dashboard and it never judges: no colour for a matter that has no manager or no tasks.
 */
@Component({
  selector: 'mf-matter-health-strip',
  imports: [WorkStrip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
  `,
  template: `
    @if (items().length > 0) {
      <mf-work-strip
        label="This matter's tasks"
        [items]="items()"
        [threeUp]="true"
        data-matter-health
      />
    }
  `,
})
export class MatterHealthStrip {
  readonly matterId = input.required<number>();
  /** Changes whenever the numbers should be asked for again. */
  readonly reload = input(0);

  private readonly api = inject(MattersClient);
  private readonly auth = inject(AuthStore);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly summary = signal<MatterSummaryResponse | null>(null);
  private requestId = 0;

  protected readonly items = computed<WorkStripItem[]>(() => {
    if (!this.auth.has('Task.View')) return [];
    const s = this.summary();
    const base = recordStripItems(
      s,
      { kind: 'matter', id: this.matterId() },
      { dueSoonTo: dateDaysAgo(this.clock.now(), -DUE_SOON_DAYS, this.zone) },
    );
    const unassigned: WorkStripItem = {
      key: 'unassigned',
      label: 'Unassigned',
      hint: VIEW_TIPS.unassigned,
      count: s?.unassigned ?? null,
      link: {
        path: '/tasks',
        queryParams: {
          matter: String(this.matterId()),
          status: [...OPEN_STATUSES],
          unassigned: 'true',
        },
      },
    };
    // Open, Overdue, Due soon, ASAP, then the two that are not a deadline: Unassigned and On hold.
    const byKey = (key: string) => base.find((i) => i.key === key);
    return [
      byKey('open'),
      byKey('overdue'),
      byKey('dueSoon'),
      byKey('asap'),
      unassigned,
      byKey('onHold'),
    ].filter((i): i is WorkStripItem => !!i);
  });

  constructor() {
    effect(() => {
      this.matterId();
      this.reload();
      untracked(() => void this.load());
    });
  }

  private async load(): Promise<void> {
    if (!this.auth.has('Task.View')) return;
    const request = ++this.requestId;
    try {
      const summary = await firstValueFrom(this.api.getMatterSummary(this.matterId()));
      if (request === this.requestId) this.summary.set(summary);
    } catch {
      // Reported by the HTTP layer; the strip keeps what it has (`--` the first time).
    }
  }
}
