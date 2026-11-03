import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { NumericDatePipe } from '../../ui/numeric-date';
import { ABSENCE_API } from './absence-api';
import { HolidayInfo } from './absence-contract';

/** The person's holiday calendar and the next holidays that apply to them (epic #1074, CAL-05): read-only, beside the Out of office list. */
@Component({
  selector: 'mf-holiday-card',
  imports: [NumericDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hc" aria-labelledby="hc-title" data-holiday-card>
      <h2 class="hc__title" id="hc-title">Holidays</h2>
      @if (info(); as i) {
        @if (i.holidayCalendar; as c) {
          <p class="hc__cal">
            Holiday calendar: <strong data-holiday-calendar>{{ c.name }}</strong>
          </p>
          @if (i.nextHolidays.length > 0) {
            <ul class="hc__list">
              @for (h of i.nextHolidays; track h.date) {
                <li>
                  <span class="hc__date">{{ h.date | mfNum }}</span> {{ h.name }}
                </li>
              }
            </ul>
          } @else {
            <p class="hc__none">No holidays coming up.</p>
          }
        } @else {
          <p class="hc__none">No holiday calendar applies to you yet. Ask an administrator.</p>
        }
        <p class="hc__help">Holidays are not out of office: you do not need to enter them.</p>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .hc {
      padding: var(--mf-s4) var(--mf-s5);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
    }
    .hc__title {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-h3);
      font-weight: 600;
    }
    .hc__cal,
    .hc__none,
    .hc__help {
      margin: 0 0 var(--mf-s2);
    }
    .hc__help,
    .hc__none {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .hc__list {
      margin: 0 0 var(--mf-s2);
      padding: 0;
      list-style: none;
    }
    .hc__list li {
      padding: var(--mf-s1) 0;
    }
    .hc__date {
      display: inline-block;
      min-width: 3.5rem;
      font-weight: 600;
    }
  `,
})
export class HolidayCard {
  readonly userId = input.required<number>();
  private readonly api = inject(ABSENCE_API);
  protected readonly info = signal<HolidayInfo | null>(null);

  constructor() {
    effect(() => {
      const id = this.userId();
      untracked(
        () =>
          void this.api
            .holidayInfo(id)
            .then((i) => this.info.set(i))
            .catch(() => this.info.set(null)),
      );
    });
  }
}
