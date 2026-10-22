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
import { OPEN_STATUSES } from '../../../shared/work-queue/queue-filters';
import { VIEW_TIPS } from '../../../shared/work-queue/work-vocabulary';
import { WorkStrip, WorkStripItem } from '../../../shared/work-queue/work-strip';

/**
 * The small health strip under a matter's header (epic #667): Open, Overdue, Unassigned and On hold of this matter, each a link to the
 * Task Queue scoped to the matter, so every number equals the total of the grid it opens. Nothing is drawn, and nothing is asked for,
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
      <mf-work-strip label="This matter's tasks" [items]="items()" data-matter-health />
    }
  `,
})
export class MatterHealthStrip {
  readonly matterId = input.required<number>();
  /** Changes whenever the numbers should be asked for again. */
  readonly reload = input(0);

  private readonly api = inject(MattersClient);
  private readonly auth = inject(AuthStore);
  private readonly summary = signal<MatterSummaryResponse | null>(null);
  private requestId = 0;

  protected readonly items = computed<WorkStripItem[]>(() => {
    if (!this.auth.has('Task.View')) return [];
    const s = this.summary();
    const scope = { matter: String(this.matterId()) };
    const open = [...OPEN_STATUSES];
    const item = (
      key: string,
      label: string,
      hint: string,
      count: number | null | undefined,
      queryParams: Record<string, string | string[]>,
      alert = false,
    ): WorkStripItem => ({
      key,
      label,
      hint,
      count: count ?? null,
      ...(alert ? { alert: true } : {}),
      link: { path: '/tasks', queryParams: { ...scope, ...queryParams } },
    });
    return [
      item('open', 'Open', VIEW_TIPS.allOpen, s?.openTasks, { status: open }),
      item(
        'overdue',
        'Overdue',
        VIEW_TIPS.overdue,
        s?.overdue,
        { status: open, overdue: 'true' },
        true,
      ),
      item('unassigned', 'Unassigned', VIEW_TIPS.unassigned, s?.unassigned, {
        status: open,
        unassigned: 'true',
      }),
      item('onHold', 'On hold', VIEW_TIPS.onHold, s?.onHold, { status: ['ON_HOLD'] }),
    ];
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
