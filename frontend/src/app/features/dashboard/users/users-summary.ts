import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { Dismissable } from '../../../shared/ui/dismissable';
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
  legendStates,
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

export const WHO_IS_COUNTED =
  'This tab lists every active user with a role who is in a pod or holds open tasks. The Team capacity battery and the Calendar count only people who can execute workflow and are in a pod of the scope, so their number is lower.';

/**
 * The ONE filter bar above the cards (US-01, #1091, US-05, #1096): the four load levels (Idle, Light, Normal, Heavy) as buttons of one fixed size (not proportional to the people), then Out of office and Off hours, each a toggle (`aria-pressed`) with its icon, word and count. The unassigned link and the Assign work menu (projected as `mfBarEnd`)
 * sit at the end of the same row and the population line wraps under it. Load segments combine (any of them); Out of office and Off hours are the availability filter. Counts of
 * the load segments and Off hours follow the people on the board (the page scope and the name filter apply); Out of office while "Available" hides them comes from the team summary, which
 * follows the page scope and ignores the availability and name filters. An info button says who is counted (the capacity battery counts fewer people).
 */
@Component({
  selector: 'mf-users-summary',
  imports: [Dismissable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row">
      <div
        class="chips"
        role="group"
        [attr.aria-label]="groupLabel()"
        data-summary
        data-capacity-bar
      >
        @for (c of chips(); track c.key) {
          <button
            type="button"
            class="chip"
            [class]="'chip chip--' + c.key"
            [attr.data-chip]="c.key"
            [attr.data-segment]="isLevel(c.key) ? c.key : null"
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
        <span class="who-wrap">
          <button
            #whoBtn
            type="button"
            class="mf-btn mf-btn--icon info"
            data-who-counted
            aria-label="What the states mean and who is counted"
            title="What the states mean and who is counted"
            aria-haspopup="dialog"
            [attr.aria-expanded]="whoOpen()"
            (click)="whoOpen.set(!whoOpen())"
          >
            <i class="pi pi-info-circle" aria-hidden="true"></i>
          </button>
          @if (whoOpen()) {
            <div
              class="who"
              role="dialog"
              aria-label="What the states mean and who is counted"
              data-who-popover
              [mfDismissable]="whoBtn"
              (dismissed)="whoOpen.set(false)"
            >
              <section class="sec" aria-labelledby="wl-states-h" data-legend>
                <h3 id="wl-states-h">What the states mean</h3>
                <ul class="states" data-legend-states>
                  @for (st of states(); track st.key) {
                    <li [attr.data-state]="st.key">
                      <span class="chipk" [class]="'chipk chipk--' + st.key"
                        ><i class="pi" [class]="st.icon" aria-hidden="true"></i>{{ st.word }}</span
                      >&ngsp;<span class="line">{{ st.line }}</span>
                    </li>
                  }
                </ul>
              </section>
              <section class="sec" aria-labelledby="wl-who-h">
                <h3 id="wl-who-h">Who is counted</h3>
                <p class="wt" data-who-text>{{ who }}</p>
                @if (population(); as line) {
                  <p class="pop" data-users-population>
                    <span data-users-population-text>{{ line.text }}</span>
                    <button
                      type="button"
                      class="mf-btn mf-btn--text"
                      data-users-population-toggle
                      [attr.aria-pressed]="populationOn()"
                      (click)="populationToggle.emit()"
                    >
                      {{ line.action }}
                    </button>
                  </p>
                }
              </section>
            </div>
          }
        </span>
      </div>
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--mf-s2);
    }
    /* The unassigned link and Assign work (projected) sit at the right end of the state row; they wrap after the state buttons. */
    :host ::ng-deep [mfBarEnd] {
      margin-left: auto;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s3);
    }
    /* The state buttons are all the same size (the widest label with its count), left aligned and not stretched: the width does not follow the number of people. */
    .chips {
      display: flex;
      flex: 0 1 auto;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s2);
      min-width: 0;
    }
    .chip {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      gap: 5px;
      box-sizing: border-box;
      width: 8rem;
      min-height: 28px;
      padding: 0 var(--mf-s1);
      color: var(--mf-text);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      font: inherit;
      font-size: var(--mf-fs-sm);
      white-space: nowrap;
      cursor: pointer;
    }
    .chip .pi {
      font-size: var(--mf-icon-md);
    }
    .who-wrap {
      position: relative;
      display: inline-flex;
      align-self: center;
    }
    .who {
      position: absolute;
      top: calc(100% + var(--mf-s1));
      left: 0;
      z-index: 40;
      width: min(26rem, 90vw);
      max-height: calc(100vh - 14rem);
      overflow: auto;
      padding: var(--mf-s3);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      box-shadow: var(--mf-shadow-pop);
    }
    .who h3 {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-md);
    }
    .sec + .sec {
      margin-top: var(--mf-s3);
      padding-top: var(--mf-s3);
      border-top: 1px solid var(--mf-border-soft);
    }
    .who p {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    .who p:last-child {
      margin-bottom: 0;
    }
    .pop {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s2);
      color: var(--mf-text-muted);
    }
    .chip:hover {
      filter: brightness(0.96);
    }
    .chip[aria-pressed='true'] {
      outline: 2px solid var(--mf-primary);
      outline-offset: 1px;
      font-weight: 600;
    }
    .chip[aria-pressed='true'] .w {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .chip:focus-visible,
    .info:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
    }
    .n {
      font-variant-numeric: tabular-nums;
    }
    .info {
      align-self: center;
    }
    .states {
      display: grid;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .states li {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .chipk {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      box-sizing: border-box;
      min-width: 8rem;
      min-height: 28px;
      padding: 0 var(--mf-s2);
      color: var(--mf-text);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-sm);
      white-space: nowrap;
    }
    .chipk .pi {
      font-size: var(--mf-icon-md);
    }
    .chipk--idle {
      background: color-mix(in srgb, var(--mf-success-bg) 45%, var(--mf-surface));
      border-color: var(--mf-success);
    }
    .chipk--light {
      background: var(--mf-info-bg);
    }
    .chipk--normal {
      background: color-mix(in srgb, var(--mf-info-bg) 55%, var(--mf-surface-alt));
    }
    .chipk--heavy {
      background: var(--mf-danger-bg);
      border-color: var(--mf-danger);
    }
    .chipk--heavy .pi {
      color: var(--mf-danger);
    }
    .chipk--out {
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
    }
    .line {
      color: var(--mf-text);
      font-size: var(--mf-fs-sm);
    }

    /* The same tints as the tiles (U7): Idle the lightest, saturated colour only for Heavy. */
    .chip--idle {
      background: color-mix(in srgb, var(--mf-success-bg) 45%, var(--mf-surface));
      border-color: var(--mf-success);
    }
    .chip--light {
      background: var(--mf-info-bg);
    }
    .chip--normal {
      background: color-mix(in srgb, var(--mf-info-bg) 55%, var(--mf-surface-alt));
    }
    .chip--heavy {
      background: var(--mf-danger-bg);
      border-color: var(--mf-danger);
    }
    .chip--heavy .pi {
      color: var(--mf-danger);
    }
    .chip--out {
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
    }
    /* On a phone the bar is one line that scrolls sideways inside itself, so the tiles start higher. */
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

  protected readonly who = WHO_IS_COUNTED;
  /** The six states with their icon and ONE line each; the load lines use the real thresholds. */
  protected readonly states = computed(() => legendStates(this.thresholds()));
  protected readonly whoOpen = signal(false);

  /** The "Showing 60 people ... Show them" line (the page's population rule) and its action: both live in the Who is counted popover. */
  readonly population = input<{ text: string; action: string } | null>(null);
  readonly populationOn = input(false);
  readonly populationToggle = output<void>();

  protected isLevel(key: Chip['key']): boolean {
    return key !== 'out' && key !== 'off';
  }

  /** The group's name carries every count in words. */
  protected readonly groupLabel = computed(
    () =>
      'Quick filters: ' +
      this.chips()
        .map((c) => `${c.count} ${c.word.toLowerCase()}`)
        .join(', '),
  );

  protected toggle(key: Chip['key']): void {
    if (key === 'out' || key === 'off') this.availabilityToggle.emit(key);
    else this.loadToggle.emit(key);
  }
}
