import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DateInput } from 'form-engine';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { formatDateOnly, parseDateOnly } from '../../core/time/time';
import {
  DATE_PRESETS,
  DEFAULT_DATE_PRESETS,
  matchingPreset,
  presetRange,
  rangeReversed,
  todayInZone,
} from './date-presets';
import { RangeValue } from './filter-def';
import { FILTER_TRIGGER_STYLES, FilterPopover } from './filter-popover';

let nextId = 0;

/** "Oct 1 to Oct 16" (the year only when it is not this year) for the trigger button of a narrow column. */
export function shortRange(r: RangeValue, thisYear: number): string {
  const f = (iso: string): string => {
    const d = parseDateOnly(iso);
    if (!d) return iso;
    const full = formatDateOnly(iso); // "Oct 28, 2026"
    return d.year === thisYear ? full.replace(/,\s*\d{4}$/, '') : full;
  };
  if (r.from && r.to) return r.from === r.to ? f(r.from) : `${f(r.from)} to ${f(r.to)}`;
  return r.from ? `From ${f(r.from)}` : `Until ${f(r.to)}`;
}

/**
 * Date range column filter: a button ("Any date" / "Oct 1 to Oct 16") opening a popover with From and To (`mf-date-input`, applies when
 * the user leaves the field, presses Enter or picks from the calendar) and presets (Today, This week with weeks starting on Monday, Last
 * 7 / 30 days, This month, ...) worked out in the viewer's time zone. A preset fills both dates. A range whose From is after To shows an
 * error and is not applied. In the sheet (`inline`) the same group shows in place.
 */
@Component({
  selector: 'mf-column-date-range-filter',
  imports: [NgTemplateOutlet, FilterPopover, DateInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.ft--inline]': 'inline()' },
  template: `
    @if (!inline()) {
      <button
        #btn
        type="button"
        class="mf-control mf-control--compact ft-btn"
        aria-haspopup="dialog"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="open() ? uid + '-panel' : null"
        [attr.aria-label]="'Filter by ' + label() + ', ' + summary()"
        [attr.data-filter]="key() || label()"
        [attr.data-active]="hasValue() ? '' : null"
        [disabled]="disabled()"
        (click)="toggle()"
      >
        <span class="ft-text" [attr.data-empty]="hasValue() ? null : ''">{{ summary() }}</span>
        <i class="pi pi-calendar" aria-hidden="true"></i>
      </button>
      @if (open()) {
        <mf-filter-popover [anchor]="btn" [label]="'Filter by ' + label()" (closed)="close(false)">
          <ng-container *ngTemplateOutlet="panel" />
        </mf-filter-popover>
      }
    } @else {
      <ng-container *ngTemplateOutlet="panel" />
    }

    <ng-template #panel>
      <div class="dr" [id]="uid + '-panel'">
        <div class="ft-field">
          <label [for]="uid + '-from'">From</label>
          <mf-date-input
            [inputId]="uid + '-from'"
            [label]="label() + ' from'"
            [commitOnly]="true"
            [showError]="true"
            [isoValue]="draft().from || null"
            (isoChange)="setSide('from', $event)"
          />
        </div>
        <div class="ft-field">
          <label [for]="uid + '-to'">To</label>
          <mf-date-input
            [inputId]="uid + '-to'"
            [label]="label() + ' to'"
            [commitOnly]="true"
            [showError]="true"
            [isoValue]="draft().to || null"
            (isoChange)="setSide('to', $event)"
          />
        </div>
        @if (reversed()) {
          <p class="ft-error" role="alert" data-range-error>
            From is after To. Change one of the dates to apply the filter.
          </p>
        }
        <div class="dr-presets" role="group" aria-label="Presets">
          @for (p of presetList(); track p.key) {
            <button
              type="button"
              class="mf-btn dr-preset"
              [attr.data-preset]="p.key"
              [attr.aria-pressed]="chosen() === p.key"
              (click)="applyPreset(p.key)"
            >
              {{ p.label }}
            </button>
          }
        </div>
        <div class="ft-foot">
          <button
            type="button"
            class="mf-btn mf-btn--text"
            [disabled]="!hasDraft()"
            (click)="clearRange()"
          >
            Clear
          </button>
          @if (!inline()) {
            <button type="button" class="mf-btn" (click)="close(true)">Done</button>
          }
        </div>
      </div>
    </ng-template>
  `,
  styles: [
    FILTER_TRIGGER_STYLES,
    `
      .dr-presets {
        display: flex;
        flex-wrap: wrap;
        gap: var(--mf-s1);
      }
      .dr-preset {
        min-height: 28px;
        padding: 0 var(--mf-s2);
        font-size: var(--mf-fs-sm);
      }
      .dr-preset[aria-pressed='true'] {
        border-color: var(--mf-primary);
        background: var(--mf-selected-bg);
      }
    `,
  ],
})
export class ColumnDateRangeFilter {
  readonly label = input.required<string>();
  readonly key = input('');
  /** The committed range (ISO dates, from the URL). */
  readonly value = input<RangeValue>({ from: '', to: '' });
  /** Preset keys to offer (see DATE_PRESETS). */
  readonly presets = input<readonly string[]>(DEFAULT_DATE_PRESETS);
  readonly emptyLabel = input('Any date');
  readonly inline = input(false);
  readonly disabled = input(false);
  /** The valid range, when the user changed it. */
  readonly valueChange = output<RangeValue>();

  protected readonly uid = `mf-dr-${nextId++}`;
  protected readonly open = signal(false);
  protected readonly draft = signal<RangeValue>({ from: '', to: '' });
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly btn = viewChild<ElementRef<HTMLButtonElement>>('btn');

  protected readonly hasValue = computed(() => !!this.draft().from || !!this.draft().to);
  protected readonly hasDraft = this.hasValue;
  protected readonly reversed = computed(() => rangeReversed(this.draft()));
  protected readonly chosen = computed(() =>
    matchingPreset(this.draft(), todayInZone(this.clock.now(), this.zone), this.presets()),
  );

  /** The button text: the preset's name when both dates equal a preset ("Next 7 days", #155), else the dates. */
  protected readonly summary = computed(() => {
    if (!this.hasValue()) return this.emptyLabel();
    const draft = this.draft();
    const key = draft.from && draft.to ? this.chosen() : null;
    const named = key ? DATE_PRESETS.find((p) => p.key === key)?.label : null;
    return named ?? shortRange(draft, todayInZone(this.clock.now(), this.zone).year);
  });
  protected readonly presetList = computed(() =>
    this.presets()
      .map((k) => DATE_PRESETS.find((p) => p.key === k))
      .filter((p): p is (typeof DATE_PRESETS)[number] => !!p),
  );

  constructor() {
    effect(() => {
      const committed = this.value() ?? { from: '', to: '' };
      untracked(() => this.draft.set({ from: committed.from, to: committed.to }));
    });
  }

  protected toggle(): void {
    if (this.open()) this.close(true);
    else this.open.set(true);
  }

  protected close(refocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (refocus) this.btn()?.nativeElement.focus();
  }

  protected setSide(side: 'from' | 'to', iso: string | null): void {
    const next = { ...this.draft(), [side]: iso ?? '' } as RangeValue;
    this.draft.set(next);
    this.emitIfValid(next);
  }

  protected applyPreset(key: string): void {
    const range = presetRange(key, todayInZone(this.clock.now(), this.zone));
    if (!range) return;
    this.draft.set(range);
    this.emitIfValid(range);
  }

  protected clearRange(): void {
    const empty = { from: '', to: '' };
    this.draft.set(empty);
    this.emitIfValid(empty);
  }

  private emitIfValid(r: RangeValue): void {
    if (rangeReversed(r)) return;
    const c = this.value() ?? { from: '', to: '' };
    if (c.from === r.from && c.to === r.to) return;
    this.valueChange.emit(r);
  }
}
