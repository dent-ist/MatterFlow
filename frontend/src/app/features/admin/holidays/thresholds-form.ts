import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { HOLIDAY_API } from './holiday-api';
import { CalendarThresholds, PodRef } from './holiday-contract';

/** The rules of the form, apart from the component so a spec can state them. */
export function validateThresholds(
  min: number,
  pod: number,
  minimums: readonly { people: number }[],
): { min?: string; pod?: string; minimums?: string } {
  const out: { min?: string; pod?: string; minimums?: string } = {};
  if (!Number.isInteger(min) || min < 1 || min > 100)
    out.min = 'Enter a whole number from 1 to 100.';
  if (!Number.isInteger(pod) || pod < 1 || pod > 100)
    out.pod = 'Enter a whole number from 1 to 100.';
  else if (!out.min && pod > min)
    out.pod = 'The pod minimum cannot be higher than the firm minimum.';
  if (minimums.some((m) => !Number.isInteger(m.people) || m.people < 0 || m.people > 999))
    out.minimums = 'Pod minimums are whole numbers from 0 up.';
  return out;
}

/**
 * Settings > Dashboard > Calendar coverage (epic #1074, CAL-06): the two coverage thresholds (the firm minimum, default 75 %, and the pod minimum, default 60 %) and an optional minimum number
 * of people per pod. Reset to default only fills the form (nothing changes until Save). A version conflict says so and shows the latest values. Needs Settings.Manage (the Settings route).
 */
@Component({
  selector: 'mf-calendar-thresholds',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="th" novalidate (submit)="$event.preventDefault(); save()" data-calendar-thresholds>
      <h2 class="th__h">Calendar coverage</h2>
      <p class="th__i">
        The Dashboard Calendar colours each day by how many of the people expected to work are
        available. These limits decide where Good ends and Watch, Low and Critical begin.
      </p>
      @if (state() === 'loading') {
        <p role="status" aria-busy="true" class="th__m">Loading calendar coverage</p>
      } @else if (state() === 'error') {
        <p class="th__e" role="alert" data-th-load-error>
          We could not load the thresholds.
          <button type="button" class="mf-btn" (click)="load()">Retry</button>
        </p>
      } @else if (value(); as v) {
        @if (conflict()) {
          <p class="th__e" role="alert" data-th-conflict>
            Someone else changed these settings. The latest values are shown; make your changes
            again.
          </p>
        }
        @if (serverError()) {
          <p class="th__e" role="alert">{{ serverError() }}</p>
        }
        <div class="th__row">
          <div class="mf-field">
            <label class="mf-field__label" for="th-min">Firm minimum coverage (%)</label>
            <input
              id="th-min"
              class="mf-field__input"
              type="number"
              min="1"
              max="100"
              inputmode="numeric"
              [value]="min()"
              [attr.aria-invalid]="errors().min ? 'true' : null"
              aria-describedby="th-min-h"
              (input)="min.set(+$any($event.target).value)"
            />
            <p class="mf-field__help" id="th-min-h">
              Default {{ v.defaults.minCoveragePercent }}. Under this a day is Low; far under it,
              Critical.
            </p>
            @if (errors().min; as e) {
              <p class="mf-field__error" role="alert">
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
              </p>
            }
          </div>
          <div class="mf-field">
            <label class="mf-field__label" for="th-pod">Pod minimum (%)</label>
            <input
              id="th-pod"
              class="mf-field__input"
              type="number"
              min="1"
              max="100"
              inputmode="numeric"
              [value]="pod()"
              [attr.aria-invalid]="errors().pod ? 'true' : null"
              aria-describedby="th-pod-h"
              (input)="pod.set(+$any($event.target).value)"
            />
            <p class="mf-field__help" id="th-pod-h">
              Default {{ v.defaults.podMinimumPercent }}. A pod below this share of its people is
              under its minimum (Watch).
            </p>
            @if (errors().pod; as e) {
              <p class="mf-field__error" role="alert">
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
              </p>
            }
          </div>
        </div>
        <fieldset class="th__set">
          <legend>Minimum people per pod</legend>
          <p class="mf-field__help">
            When set, it replaces the percentage for that pod. Leave empty to use the pod minimum
            above.
          </p>
          <div class="th__pods">
            @for (p of pods(); track p.podId) {
              <label class="th__p">
                <span>{{ p.name }}</span>
                <input
                  class="mf-field__input"
                  type="number"
                  min="0"
                  max="999"
                  inputmode="numeric"
                  [attr.data-pod-min]="p.podId"
                  [value]="podMin(p.podId)"
                  (input)="setPodMin(p.podId, $any($event.target).value)"
                />
              </label>
            }
          </div>
          @if (errors().minimums; as e) {
            <p class="mf-field__error" role="alert">{{ e }}</p>
          }
        </fieldset>
        <div class="th__bar">
          <button
            type="submit"
            class="mf-btn mf-btn--primary"
            data-th-save
            [disabled]="busy() || !dirty()"
          >
            {{ busy() ? 'Saving...' : 'Save' }}
          </button>
          <button type="button" class="mf-btn" data-th-reset [disabled]="busy()" (click)="reset()">
            Reset to default
          </button>
        </div>
      }
    </form>
  `,
  styles: `
    :host {
      display: block;
    }
    .th {
      display: grid;
      gap: var(--mf-s3);
      max-width: 46rem;
      margin-top: var(--mf-s5);
      padding-top: var(--mf-s4);
      border-top: 1px solid var(--mf-border);
    }
    .th__h {
      margin: 0;
      font-size: var(--mf-fs-h3);
      font-weight: 600;
    }
    .th__i,
    .th__m {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .th__e {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0;
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-sem-overdue-line);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-sem-overdue-bg);
      color: var(--mf-sem-overdue-fg);
    }
    .th__row {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s4);
    }
    @media (max-width: 599.98px) {
      .th__row {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .th__set {
      margin: 0;
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
    }
    .th__set legend {
      padding: 0 var(--mf-s2);
      font-weight: 600;
    }
    .th__pods {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
      gap: var(--mf-s3);
    }
    .th__p {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s1);
    }
    .th__p input {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
    }
    .th__bar {
      display: flex;
      gap: var(--mf-s2);
    }
  `,
})
export class CalendarThresholdsForm implements OnInit {
  private readonly api = inject(HOLIDAY_API);
  private readonly notify = inject(NotificationService);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly value = signal<CalendarThresholds | null>(null);
  protected readonly pods = signal<PodRef[]>([]);
  protected readonly min = signal(75);
  protected readonly pod = signal(60);
  protected readonly minimums = signal<Record<number, number | null>>({});
  protected readonly busy = signal(false);
  protected readonly conflict = signal(false);
  protected readonly serverError = signal('');

  protected readonly errors = computed(() =>
    validateThresholds(
      this.min(),
      this.pod(),
      Object.values(this.minimums())
        .filter((n): n is number => n !== null)
        .map((people) => ({ people })),
    ),
  );
  protected readonly dirty = computed(() => {
    const v = this.value();
    if (!v) return false;
    return this.sig() !== this.sigOf(v);
  });

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const [v, pods] = await Promise.all([this.api.thresholds(), this.api.pods()]);
      this.pods.set(pods);
      this.apply(v);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  private apply(v: CalendarThresholds): void {
    this.value.set(v);
    this.min.set(v.minCoveragePercent);
    this.pod.set(v.podMinimumPercent);
    this.minimums.set(Object.fromEntries(v.podMinimums.map((m) => [m.podId, m.people])));
  }

  private sigOf(v: CalendarThresholds): string {
    return JSON.stringify([
      v.minCoveragePercent,
      v.podMinimumPercent,
      [...v.podMinimums].sort((a, b) => a.podId - b.podId).map((m) => [m.podId, m.people]),
    ]);
  }
  private sig(): string {
    const m = Object.entries(this.minimums())
      .filter(([, n]) => n !== null)
      .map(([id, n]) => [Number(id), n])
      .sort((a, b) => (a[0] as number) - (b[0] as number));
    return JSON.stringify([this.min(), this.pod(), m]);
  }

  protected podMin(podId: number): string {
    const n = this.minimums()[podId];
    return n === null || n === undefined ? '' : String(n);
  }

  protected setPodMin(podId: number, text: string): void {
    this.minimums.update((m) => ({ ...m, [podId]: text.trim() === '' ? null : Number(text) }));
  }

  /** Only fills the form with the defaults; nothing is saved until Save. */
  protected reset(): void {
    const v = this.value();
    if (!v) return;
    this.min.set(v.defaults.minCoveragePercent);
    this.pod.set(v.defaults.podMinimumPercent);
    this.minimums.set({});
  }

  protected async save(): Promise<void> {
    const v = this.value();
    if (!v || this.busy() || !this.dirty()) return;
    if (Object.keys(this.errors()).length > 0) return;
    this.busy.set(true);
    this.conflict.set(false);
    this.serverError.set('');
    try {
      const saved = await this.api.saveThresholds({
        minCoveragePercent: this.min(),
        podMinimumPercent: this.pod(),
        podMinimums: Object.entries(this.minimums())
          .filter(([, n]) => n !== null)
          .map(([id, people]) => ({ podId: Number(id), people: people as number })),
        rowVersion: v.rowVersion,
      });
      this.apply(saved);
      this.notify.success('Calendar coverage saved', undefined, { key: 'calendar-thresholds' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        this.conflict.set(true);
        await this.load();
      } else
        this.serverError.set(
          err instanceof ApiError ? err.message : "Couldn't save the calendar coverage. Try again.",
        );
    } finally {
      this.busy.set(false);
    }
  }
}
