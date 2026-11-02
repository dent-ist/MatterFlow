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
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatterEventResponse, MatterEventsClient } from '../../../api/generated/api-client';
import { EventIcon } from '../../../shared/ui/event-type';

/**
 * "Next events" panel of the Matter Summary (MD-08, #1009; owner decision AQ.1). The next calendar items of the matter, an Add event button and the link
 * "Open in My Matters calendar". The page shows it only to people who hold `Matter.BeManager` (project managers who can open My Matters): for anyone else
 * the panel, the button and the link are absent, so no dead link is shown (issue #976). Add event is offered only to a manager of this matter or a holder of `Matter.Edit`.
 */
@Component({
  selector: 'mf-matter-next-events',
  imports: [RouterLink, EventIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .ne {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-card);
    }
    .ne__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
      padding: var(--mf-s3) var(--mf-s3) var(--mf-s2);
    }
    .ne__title {
      margin: 0;
      font-size: var(--mf-fs-lg);
      font-weight: 700;
    }
    .ne__scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 0 var(--mf-s3) var(--mf-s2);
    }
    .ne__list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .ne__list li {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      padding: var(--mf-s2) 0;
      border-top: 1px solid var(--mf-border-soft);
    }
    .ne__list li:first-child {
      border-top: 0;
    }
    .ne__date {
      flex: none;
      min-width: 5.5rem;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .ne__empty {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .ne__foot {
      padding: var(--mf-s2) var(--mf-s3) var(--mf-s3);
    }
    @media (max-width: 767.98px), (max-height: 560.98px) {
      .ne__scroll {
        overflow: visible;
      }
    }
  `,
  template: `
    <section class="ne" aria-labelledby="ne-h" data-next-events>
      <div class="ne__head">
        <h2 class="ne__title" id="ne-h">Next events</h2>
        @if (canAdd()) {
          <button type="button" class="mf-btn" data-add-event (click)="addEvent.emit()">
            <i class="pi pi-plus" aria-hidden="true"></i> Add event
          </button>
        }
      </div>
      <div class="ne__scroll" tabindex="0" role="region" aria-label="Next events">
        @if (state() === 'error') {
          <p class="ne__empty" role="alert" data-events-error>Couldn't load the events.</p>
        } @else if (events().length === 0 && state() === 'ready') {
          <p class="ne__empty" data-no-events>No events in the next 90 days.</p>
        } @else {
          <ul class="ne__list">
            @for (e of events(); track e.eventId) {
              <li data-event-item>
                <mf-event-icon [type]="e.typeCode" />
                <span class="ne__date">{{ when(e) }}</span>
                <span>{{ e.title }}</span>
              </li>
            }
          </ul>
        }
      </div>
      <p class="ne__foot">
        <a
          class="pg-link"
          data-open-calendar
          routerLink="/my-matters"
          [queryParams]="{ matterId: matterId(), tab: 'calendar' }"
          >Open in My Matters calendar</a
        >
      </p>
    </section>
  `,
})
export class MatterNextEvents {
  readonly matterId = input.required<number>();
  /** The viewer may add events here (a manager of this matter or a holder of Matter.Edit) and the matter is active. */
  readonly canAdd = input(false);
  /** Changes whenever the list should be read again (an event was added). */
  readonly reload = input(0);
  readonly addEvent = output<void>();

  private readonly api = inject(MatterEventsClient);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly all = signal<MatterEventResponse[]>([]);
  protected readonly events = computed(() => this.all().slice(0, 20));

  constructor() {
    effect(() => {
      this.matterId();
      this.reload();
      untracked(() => void this.load());
    });
  }

  private async load(): Promise<void> {
    try {
      const list = await firstValueFrom(this.api.listMatterEvents(this.matterId()));
      this.all.set(list.items);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  /** "11/03" and the time when there is one ("11/03 2:30 PM"). */
  protected when(e: MatterEventResponse): string {
    const [, m, d] = e.date.toString().split('-');
    const day = `${m}/${d}`;
    if (!e.time) return day;
    const [hh, mm] = e.time.split(':').map(Number);
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${day} ${h12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
  }
}
