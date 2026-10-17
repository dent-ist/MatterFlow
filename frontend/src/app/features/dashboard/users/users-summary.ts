import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  WorkloadSummary,
  WorkloadThresholds,
  WorkloadUser,
} from '../../../api/generated/api-client';
import {
  AvailabilityFilter,
  LOAD_ICONS,
  LOAD_LABELS,
  LoadFilter,
  UsersFilters,
  loadHelp,
  loadLevelOf,
} from './users-model';

interface Chip {
  key: 'idle' | 'light' | 'normal' | 'heavy' | 'out' | 'off';
  word: string;
  icon: string;
  title: string;
  count: string;
  /** The accessible name: the word, the people and what it means with its thresholds. */
  label: string;
  pressed: boolean;
}

/**
 * The quick filters above the tiles, which are also the first part of the legend: Idle (nothing open), Light, Normal and Heavy load,
 * Out of office and Off hours, each a toggle with its icon, a short word and how many people it holds, plus "Unassigned tasks" (an icon link to
 * the Task Queue with the count). Load chips combine (any of them); Out of office and Off hours are the availability filter. Counts of the load
 * chips and Off hours follow the people on the board (the page scope and the name filter apply); Unassigned (and Out of office while "Available" hides them)
 * come from the team summary, which follows the page scope and ignores the availability and name filters.
 */
@Component({
  selector: 'mf-users-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row">
      <div class="chips" role="group" aria-label="Quick filters" data-summary>
        @for (c of chips(); track c.key) {
          <button
            type="button"
            class="chip"
            [class]="'chip chip--' + c.key"
            [attr.data-chip]="c.key"
            [attr.aria-pressed]="c.pressed"
            [attr.title]="c.title"
            [attr.aria-label]="c.label"
            (click)="toggle(c.key)"
          >
            <i class="pi" [class]="c.icon" aria-hidden="true"></i>
            <span class="w">{{ c.word }}</span>
            <strong class="n" data-n>{{ c.count }}</strong>
          </button>
        }
      </div>
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--mf-s2);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s4);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s2);
    }
    /* On a phone the chips are one line that scrolls sideways inside itself, so the tiles start higher. */
    @media (max-width: 560px) {
      .row {
        display: block;
      }
      .chips {
        flex-wrap: nowrap;
        padding-bottom: 2px;
        overflow-x: auto;
      }
      .chip {
        flex: none;
      }
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      box-sizing: border-box;
      min-height: 28px;
      padding: 0 var(--mf-s2);
      color: var(--mf-text);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
      font: inherit;
      font-size: var(--mf-fs-sm);
      text-decoration: none;
      cursor: pointer;
    }
    .chip:hover {
      background: var(--mf-surface-alt);
    }
    .chip[aria-pressed='true'] {
      border-color: var(--mf-primary);
      border-width: 2px;
      padding: 0 calc(var(--mf-s2) - 1px);
      background: var(--mf-selected-bg);
      font-weight: 600;
    }
    .chip[aria-pressed='true'] .w {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .chip:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
    }
    .n {
      font-variant-numeric: tabular-nums;
    }
    /* Idle is a fact, not a trophy (U7): the lightest tint of the Idle token and a thin outline. */
    .chip--idle {
      color: var(--mf-success);
      background: color-mix(in srgb, var(--mf-success-bg) 45%, var(--mf-surface));
      border-color: var(--mf-success);
    }
    .chip--idle[aria-pressed='true'] {
      border-color: var(--mf-success);
    }
    .chip--heavy .pi {
      color: var(--mf-danger);
    }
    .chip--out {
      border-style: dashed;
      background: repeating-linear-gradient(
        135deg,
        var(--mf-surface-alt) 0 5px,
        var(--mf-surface) 5px 10px
      );
    }
  `,
})
export class UsersSummary {
  readonly summary = input<WorkloadSummary | null>(null);
  readonly users = input<readonly WorkloadUser[]>([]);
  readonly filters = input.required<UsersFilters>();
  readonly thresholds = input<WorkloadThresholds | null>(null);

  readonly loadToggle = output<LoadFilter>();
  readonly availabilityToggle = output<AvailabilityFilter>();

  protected readonly chips = computed<Chip[]>(() => {
    const f = this.filters();
    const users = this.users();
    const ready = this.summary() !== null;
    const count = (n: number) => (ready ? String(n) : '-');
    const byLevel = (l: string) => users.filter((u) => loadLevelOf(u) === l).length;
    const t = this.thresholds();
    const people = (n: number) => (ready ? ` ${n} ${n === 1 ? 'person' : 'people'}.` : '');
    // Out of office: counted on the page while the board holds everyone (or only them); with "Available" the API hides them, so the
    // team summary (which ignores the availability filter) has the number.
    const out = users.filter((u) => u.availability?.state === 'OUT_OF_OFFICE').length;
    const outCount = f.availability === 'available' ? (this.summary()?.outOfOffice ?? 0) : out;
    const level = (
      key: 'idle' | 'light' | 'normal' | 'heavy',
      lv: 'IDLE' | 'LIGHT' | 'NORMAL' | 'HEAVY',
    ): Chip => {
      const text = loadHelp(lv, t);
      const n = byLevel(lv);
      return {
        key,
        word: LOAD_LABELS[lv],
        icon: LOAD_ICONS[lv],
        title: text + '. Show only these people.',
        count: count(n),
        label: `${LOAD_LABELS[lv]}${ready ? ', ' + n : ''}. ${text}.${people(n)}`.replace(
          /\.\s+\./g,
          '.',
        ),
        pressed: f.load.includes(key),
      };
    };
    const off = users.filter((u) => u.availability?.state === 'OFF_HOURS').length;
    return [
      level('idle', 'IDLE'),
      level('light', 'LIGHT'),
      level('normal', 'NORMAL'),
      level('heavy', 'HEAVY'),
      {
        key: 'out',
        word: 'Out of office',
        icon: 'pi-calendar-minus',
        title: 'Out of office: show only these people',
        count: count(outCount),
        label: `Out of office${ready ? ', ' + outCount : ''}. Show only these people.`,
        pressed: f.availability === 'out',
      },
      {
        key: 'off',
        word: 'Off hours',
        icon: 'pi-moon',
        title: 'Off hours: outside their working hours right now',
        count: count(off),
        label: `Off hours${ready ? ', ' + off : ''}. Outside their working hours right now.`,
        pressed: f.availability === 'off',
      },
    ];
  });

  protected toggle(key: Chip['key']): void {
    if (key === 'out' || key === 'off') this.availabilityToggle.emit(key);
    else this.loadToggle.emit(key);
  }
}
