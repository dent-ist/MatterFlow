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
import { Observable, firstValueFrom } from 'rxjs';
import {
  MatterSummaryResponse,
  MattersClient,
  ProjectSummaryResponse,
  ProjectsClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { dateDaysAgo } from './queue-filters';
import { recordStripItems } from './record-strip';
import { ownTabItems } from './scoped-view';
import { WorkStrip } from './work-strip';
import { DUE_SOON_DAYS } from './work-vocabulary';

/**
 * The task summary strip of a Matter or a Project (#263, #264): Open, Overdue, Due soon, ASAP and On hold from `GET .../summary`.
 * `interactive` is the toggle mode above the Tasks grid (a pick is reported; the page decides what it does); otherwise it is the link mode of
 * the Overview, whose items go to the record's own Tasks tab at `path`. Nothing is drawn, and nothing is asked for, without `Task.View`.
 * While the numbers load (or after a failed load, which the HTTP layer already reports) the items show `--`; the numbers of an earlier load
 * stay on screen while a new one runs. A new `reload` value asks again (after an inline edit in the grid).
 */
@Component({
  selector: 'mf-summary-strip',
  imports: [WorkStrip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ss' },
  styles: `
    :host {
      display: block;
    }
  `,
  template: `
    @if (items().length > 0) {
      <mf-work-strip
        [label]="kind() === 'matter' ? 'Matter tasks' : 'Project tasks'"
        [items]="items()"
        [interactive]="interactive()"
        [active]="active()"
        (pick)="pick.emit($event)"
      />
    }
  `,
})
export class SummaryStrip {
  readonly kind = input.required<'matter' | 'project'>();
  readonly id = input.required<number>();
  readonly interactive = input(false);
  /** Toggle mode: the pressed item's key. */
  readonly active = input<string | null>(null);
  /** Link mode: the page the own-tab links go to (`/matters/5`). */
  readonly path = input<string>('');
  /** Changes whenever the numbers should be asked for again. */
  readonly reload = input(0);
  readonly pick = output<string>();
  /** The record's open-task count each time the numbers arrive. */
  readonly opened = output<number>();

  private readonly matters = inject(MattersClient);
  private readonly projects = inject(ProjectsClient);
  private readonly auth = inject(AuthStore);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  private readonly summary = signal<MatterSummaryResponse | ProjectSummaryResponse | null>(null);
  private requestId = 0;

  protected readonly items = computed(() => {
    if (!this.auth.has('Task.View')) return [];
    const base = recordStripItems(
      this.summary(),
      { kind: this.kind(), id: this.id() },
      { dueSoonTo: dateDaysAgo(this.clock.now(), -DUE_SOON_DAYS, this.zone) },
    );
    return this.interactive() ? base : ownTabItems(base, this.path());
  });

  constructor() {
    effect(() => {
      this.kind();
      this.id();
      this.reload();
      untracked(() => void this.load());
    });
  }

  private async load(): Promise<void> {
    if (!this.auth.has('Task.View')) return;
    const request = ++this.requestId;
    const kind = this.kind();
    const id = this.id();
    try {
      const source: Observable<MatterSummaryResponse | ProjectSummaryResponse> =
        kind === 'matter' ? this.matters.getMatterSummary(id) : this.projects.getProjectSummary(id);
      const summary = await firstValueFrom(source);
      if (request !== this.requestId) return;
      this.summary.set(summary);
      if (summary.openTasks != null) this.opened.emit(summary.openTasks);
    } catch {
      // Reported by the HTTP layer; the strip keeps what it has (`--` the first time).
    }
  }
}
