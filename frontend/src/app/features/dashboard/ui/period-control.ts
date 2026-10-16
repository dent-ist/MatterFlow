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
import { ActivatedRoute, Router } from '@angular/router';
import { DateInput } from 'form-engine';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { DashboardPrefs } from '../dashboard-prefs';
import {
  MAX_CUSTOM_DAYS,
  Period,
  PeriodKey,
  customProblem,
  isPeriodKey,
  periodToParams,
  presetsFor,
  rangeText,
  resolveRange,
} from '../dashboard-period';

let nextId = 0;

/**
 * The one Period control of the Dashboard (UX review 2, P3): the same label ("Period"), the same list and the same address on Summary, Trends and
 * Coverage. A choice is in effect at once, written to the address (`?period=`, `from` and `to` for a custom range; the default is left out) and
 * remembered; the tab reads its figures again when the shared period changes. Custom shows two date fields; a range that is reversed or over 366 days shows an inline error and the previous valid period stays in
 * effect. `scopeNote` is the one line that says where the period does not apply (read by screen readers with the select).
 */
@Component({
  selector: 'mf-period-control',
  imports: [DateInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pc" data-period-control>
      <div class="pc-row">
        <label class="pc-lbl" [for]="id + '-select'">Period</label>
        <select
          class="mf-control mf-control--compact"
          data-period
          [id]="id + '-select'"
          [value]="period().key"
          [attr.aria-describedby]="describedBy()"
          (change)="onSelect($any($event.target).value)"
        >
          @for (p of presets(); track p.key) {
            <option [value]="p.key" [selected]="p.key === period().key">{{ p.label }}</option>
          }
          <option value="custom" [selected]="period().key === 'custom'">Custom</option>
        </select>
        @if (period().key === 'custom') {
          <div class="pc-field">
            <label class="pc-lbl" [for]="id + '-from'">From</label>
            <mf-date-input
              [inputId]="id + '-from'"
              label="period from"
              [commitOnly]="true"
              [showError]="false"
              [isoValue]="draftFrom()"
              [invalid]="!!problem()"
              [describedBy]="problem() ? id + '-error' : ''"
              (isoChange)="onDate('from', $event)"
            />
          </div>
          <div class="pc-field">
            <label class="pc-lbl" [for]="id + '-to'">To</label>
            <mf-date-input
              [inputId]="id + '-to'"
              label="period to"
              [commitOnly]="true"
              [showError]="false"
              [isoValue]="draftTo()"
              [invalid]="!!problem()"
              [describedBy]="problem() ? id + '-error' : ''"
              (isoChange)="onDate('to', $event)"
            />
          </div>
        }
      </div>
      @if (problem(); as text) {
        <p class="pc-error" role="alert" data-period-error [id]="id + '-error'">
          <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
          {{ text }} Still showing {{ shownRange() }}.
        </p>
      }
      @if (scopeNote(); as note) {
        <p class="pc-note" data-period-note [id]="id + '-note'">{{ note }}</p>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .pc-row {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: var(--mf-s2) var(--mf-s3);
    }
    .pc-row > .pc-lbl {
      align-self: center;
    }
    .pc-field {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
    }
    .pc-field .pc-lbl {
      padding-top: var(--mf-s2);
    }
    .pc-field mf-date-input {
      flex: 1 1 auto;
      min-width: 0;
    }
    @media (max-width: 600px) {
      .pc-field {
        width: 100%;
      }
    }
    .pc-lbl {
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    .pc-error {
      margin: var(--mf-s2) 0 0;
      font-size: var(--mf-fs-sm);
      color: var(--mf-danger);
    }
    .pc-note {
      margin: var(--mf-s1) 0 0;
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    select {
      max-width: 100%;
    }
  `,
})
export class PeriodControl {
  private readonly prefs = inject(DashboardPrefs);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  /** The period in effect on this tab. */
  readonly period = input.required<Period>();
  /** Coverage appends "Last 6 months" and "Last 12 months". */
  readonly longWindows = input(false);
  /** One line under the control for the figures the period does not touch (Summary). */
  readonly scopeNote = input<string | null>(null);

  protected readonly id = `mf-period-${nextId++}`;
  protected readonly presets = computed(() => presetsFor(this.longWindows()));
  protected readonly draftFrom = signal<string | null>(null);
  protected readonly draftTo = signal<string | null>(null);
  protected readonly problem = computed(() =>
    this.period().key === 'custom' ? customProblem(this.draftFrom(), this.draftTo()) : null,
  );
  protected readonly describedBy = computed(
    () =>
      [this.scopeNote() ? this.id + '-note' : '', this.problem() ? this.id + '-error' : '']
        .filter(Boolean)
        .join(' ') || null,
  );
  protected readonly shownRange = computed(() =>
    rangeText(
      resolveRange(this.period(), this.clock.now(), this.zone),
      this.clock.now().getFullYear(),
    ),
  );

  constructor() {
    // The fields follow the period in effect (a link, Back, another tab's control), unless the person is mid-edit on an invalid range.
    effect(() => {
      const p = this.period();
      untracked(() => {
        if (p.key !== 'custom') {
          this.draftFrom.set(null);
          this.draftTo.set(null);
        } else if (p.from !== this.draftFrom() || p.to !== this.draftTo()) {
          this.draftFrom.set(p.from);
          this.draftTo.set(p.to);
        }
      });
    });
  }

  protected onSelect(value: string): void {
    if (!isPeriodKey(value)) return;
    if (value === 'custom') {
      // Custom starts from the range on screen, so the figures do not jump; it is capped to the longest custom range.
      const r = resolveRange(this.period(), this.clock.now(), this.zone);
      const from = r.days > MAX_CUSTOM_DAYS ? r.to : r.from;
      this.draftFrom.set(from);
      this.draftTo.set(r.to);
      this.apply({ key: 'custom', from, to: r.to });
      return;
    }
    this.apply({ key: value as PeriodKey, from: null, to: null });
  }

  protected onDate(side: 'from' | 'to', value: string | null): void {
    (side === 'from' ? this.draftFrom : this.draftTo).set(value);
    if (customProblem(this.draftFrom(), this.draftTo()) !== null) return; // the previous valid period stays in effect
    const from = this.draftFrom();
    const to = this.draftTo();
    const cur = this.period();
    if (cur.key === 'custom' && cur.from === from && cur.to === to) return;
    this.apply({ key: 'custom', from, to });
  }

  private apply(next: Period): void {
    this.prefs.choose(next);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: periodToParams(next),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
