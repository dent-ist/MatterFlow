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
import { Tip } from '../../../shared/ui/tip';
import { CapacityPerson, DashboardCapacity } from '../../../api/generated/api-client';
import { BatteryView, WORD_ICON, batteryView } from './capacity-model';
import { DashPeople } from './dash-people';
import { DashV4Api } from './dash-v4-api';
import { IntPipe } from '../../../shared/ui/number-format';

type BatteryState = 'loading' | 'ready' | 'error';

/**
 * The department capacity battery (epic #1063, DB-05): ONE indicator for everyone who takes work in the scope. The charge is the FREE capacity, the percentage REMAINING sits inside the battery next to a bolt,
 * a summary line says "9 unassigned waiting, 12 free slots" (the waiting part selects the Unassigned card; it is hidden when the caller may not see unassigned counts), "N tasks over capacity" in red only above zero, a compact legend counts people per state (icon and words, never colour alone), an info button explains the formula, and the People
 * button opens the list of names. People who are only outside their work hours count by default (decision AV), so the battery shows a percentage in the evening; the neutral words are only Everyone out, Holiday, No workers and, when the setting is off, After hours.
 * It reads `GET /dashboard/capacity` for the page scope and again whenever `refreshKey` changes (the page refreshes, or a task was assigned); the People list is read when the popover opens.
 * Shown only with Dashboard.ViewUsers (the page decides).
 */
@Component({
  selector: 'mf-dash-battery',
  imports: [IntPipe, Tip, DashPeople],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="panel"
      data-battery
      aria-labelledby="db-h"
      [attr.aria-busy]="state() === 'loading' ? 'true' : null"
    >
      <div class="ph">
        <h2 id="db-h"><i class="pi pi-bolt" aria-hidden="true"></i>Team Capacity</h2>
        @if (view()?.word; as word) {
          <span class="word" [attr.data-level]="view()?.level" data-battery-word>
            <i class="pi" [class]="icons[word]" aria-hidden="true"></i>
            {{ word }}
          </span>
        }
        <button
          type="button"
          class="mf-btn mf-btn--icon info"
          aria-label="How capacity is counted"
          data-battery-info
          [mfTip]="view()?.formula ?? defaultFormula"
        >
          <i class="pi pi-info-circle" aria-hidden="true"></i>
        </button>
        @if (view(); as v) {
          @if (v.mode !== 'empty') {
            <button
              #peopleBtn
              type="button"
              class="mf-btn mf-btn--icon people"
              data-people-open
              aria-label="People"
              mfTip="People"
              [attr.aria-expanded]="peopleOpen()"
              (click)="togglePeople()"
            >
              <i class="pi pi-users" aria-hidden="true"></i>
            </button>
          }
        }
      </div>

      @switch (state()) {
        @case ('loading') {
          <div class="skel" role="status" data-battery-loading>
            <span class="sr-only">Loading team capacity</span>
            <span class="sk sk--big"></span>
            <span class="sk sk--bar"></span>
            <span class="sk sk--line"></span>
          </div>
        }
        @case ('error') {
          <div class="msg" role="alert" data-battery-error>
            <b>Couldn't load team capacity.</b>
            <button type="button" class="mf-btn" data-battery-retry (click)="load(true)">
              Retry
            </button>
          </div>
        }
        @default {
          @if (view(); as v) {
            @if (stale()) {
              <p class="stale" data-battery-stale>
                <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                Couldn't refresh. Showing earlier data.
                <button type="button" class="mf-btn mf-btn--text" (click)="load(true)">
                  Retry
                </button>
              </p>
            }
            @if (v.mode === 'empty') {
              <div class="msg" data-battery-empty>
                <b>{{ v.summaryLine }}</b>
                <span>
                  A person takes work when they hold Workflow.Execute and belong to an active pod in
                  this scope.
                </span>
              </div>
            } @else {
              <div
                class="bat"
                role="img"
                data-battery-bar
                [attr.aria-label]="v.ariaLabel"
                [mfTip]="v.tooltip + '. ' + v.formula"
              >
                <div class="shell" [class.shell--neutral]="v.mode !== 'normal'">
                  <div
                    class="fill"
                    [style.width.%]="v.charge"
                    [attr.data-level]="v.level"
                    data-battery-fill
                  ></div>
                  <span class="tick" style="left: 25%"></span>
                  <span class="tick" style="left: 50%"></span>
                  <span class="tick" style="left: 75%"></span>
                  <span
                    class="val"
                    [class.val--empty]="v.charge < 28"
                    [style.left]="v.charge < 28 ? 'calc(' + v.charge + '% + var(--mf-s2))' : null"
                    [attr.data-level]="v.level"
                    data-battery-big
                  >
                    <i class="pi pi-bolt" aria-hidden="true"></i>{{ v.bigText }}
                  </span>
                </div>
                <div class="cap"></div>
              </div>
              <p class="sum" data-battery-summary>
                @if (v.waiting !== null) {
                  <button
                    type="button"
                    class="wait"
                    data-battery-waiting
                    aria-label="{{ v.waiting }} unassigned waiting. Show them"
                    (click)="showUnassigned.emit()"
                  >
                    {{ v.waiting }} unassigned waiting</button
                  >,
                }
                {{ v.freeText }}
              </p>
              @if (v.overText; as over) {
                <p class="over" data-battery-over>
                  <i class="pi pi-exclamation-circle" aria-hidden="true"></i>{{ over }}
                </p>
              }
              <ul class="legend" aria-label="People by state" data-battery-legend>
                @for (l of v.legend; track l.state) {
                  <li class="lg" [attr.data-state]="l.state" [mfTip]="l.hint">
                    <span class="sw" [class]="'sw sw--' + l.swatch" aria-hidden="true">
                      <i class="pi" [class]="l.icon"></i>
                    </span>
                    <b>{{ l.count | mfInt }}</b>
                    <span class="t">{{ l.label }}</span>
                  </li>
                }
              </ul>
              @if (v.rateHint; as rate) {
                <p class="fine" data-battery-rate>{{ rate }}</p>
              }
            }
          }
        }
      }

      @if (peopleOpen()) {
        <mf-dash-people
          [people]="people()"
          [trigger]="peopleButton()"
          (closed)="peopleOpen.set(false)"
        />
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      flex: none;
    }
    .panel {
      position: relative;
      padding: var(--mf-s3) var(--mf-s4);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-xl);
    }
    .ph {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin-bottom: var(--mf-s2);
    }
    h2 {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      white-space: nowrap;
    }
    .people {
      flex: none;
      margin-left: auto;
    }
    /* The status word beside the title: the colour of the remaining capacity plus the word and the icon, so colour is never the only signal. */
    .word {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 2px 10px;
      border-radius: 999px;
      color: var(--mf-rem-fg);
      background: var(--mf-rem);
      font-size: 12px;
      font-weight: 700;
    }
    [data-level='0'] {
      --mf-rem: var(--mf-rem-0);
      --mf-rem-fg: var(--mf-rem-0-fg);
    }
    [data-level='1'] {
      --mf-rem: var(--mf-rem-1);
      --mf-rem-fg: var(--mf-rem-1-fg);
    }
    [data-level='2'] {
      --mf-rem: var(--mf-rem-2);
      --mf-rem-fg: var(--mf-rem-2-fg);
    }
    [data-level='3'] {
      --mf-rem: var(--mf-rem-3);
      --mf-rem-fg: var(--mf-rem-3-fg);
    }
    [data-level='4'] {
      --mf-rem: var(--mf-rem-4);
      --mf-rem-fg: var(--mf-rem-4-fg);
    }
    [data-level='5'] {
      --mf-rem: var(--mf-rem-5);
      --mf-rem-fg: var(--mf-rem-5-fg);
    }
    .bat {
      display: flex;
      align-items: stretch;
      height: 51px;
    }
    .shell {
      position: relative;
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      padding: 3px;
      background: var(--mf-surface);
      border: 2px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
    }
    .fill {
      height: 100%;
      border-radius: var(--mf-radius-sm, 3px);
      background: var(--mf-rem);
      transition: width 0.4s ease;
    }
    .shell--neutral {
      background: repeating-linear-gradient(
        45deg,
        var(--mf-p-slate-bg) 0 4px,
        var(--mf-p-slate-line) 4px 7px
      );
    }
    /* The number is plain text on the fill (no ring); the fill colours are chosen so the text colour of each step passes 4.5:1. When the fill is shorter than the number (under about 20 percent) the number sits on the battery's empty part: see .val--empty. */
    .val {
      position: absolute;
      top: 50%;
      left: var(--mf-s2);
      z-index: 1;
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 0;
      transform: translateY(-50%);
      color: var(--mf-rem-fg, var(--mf-text));
      font-size: 18px;
      font-weight: 700;
      line-height: 22px;
      white-space: nowrap;
    }
    /* A short fill (under 28 percent): the number sits just after it, on the empty part, in the normal text colour. */
    .val--empty {
      color: var(--mf-text);
    }
    .tick {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 1px;
      background: var(--mf-surface);
      opacity: 0.7;
    }
    .cap {
      flex: none;
      width: 6px;
      margin: 14px 0;
      border-radius: 0 4px 4px 0;
      background: var(--mf-border-strong);
    }
    .sum {
      margin: var(--mf-s2) 0 0;
      font-size: 13px;
    }
    .wait {
      padding: 0;
      color: var(--mf-link);
      background: none;
      border: 0;
      font: inherit;
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
    }
    .wait:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    /* Tasks above the slot count: red text and icon, shown only above zero, so slack elsewhere never hides an overload. */
    .over {
      display: flex;
      align-items: center;
      gap: var(--mf-s1);
      margin: var(--mf-s1) 0 0;
      color: var(--mf-danger);
      font-size: 13px;
      font-weight: 600;
    }
    .legend {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 4px;
      margin: var(--mf-s2) 0 0;
      padding: 0;
      list-style: none;
    }
    .lg {
      display: grid;
      grid-template-columns: auto 1fr;
      grid-template-rows: auto auto;
      align-items: center;
      column-gap: 6px;
      padding: 4px 8px;
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
      font-size: 12px;
      line-height: 1.2;
    }
    .lg b {
      font-size: 17px;
      line-height: 1.1;
    }
    .lg .t {
      grid-column: 1 / -1;
      color: var(--mf-text-muted);
    }
    .sw {
      display: grid;
      place-items: center;
      width: 18px;
      height: 18px;
      border-radius: 3px;
      font-size: 11px;
    }
    .sw--cap-0 {
      color: var(--mf-cap-0-fg);
      background: var(--mf-cap-0);
      box-shadow: inset 0 0 0 1px var(--mf-border);
    }
    .sw--cap-1 {
      color: var(--mf-cap-1-fg);
      background: var(--mf-cap-1);
    }
    .sw--cap-2 {
      color: var(--mf-cap-2-fg);
      background: var(--mf-cap-2);
    }
    .sw--cap-3 {
      color: var(--mf-cap-3-fg);
      background: var(--mf-cap-3);
    }
    .sw--out {
      color: var(--mf-p-slate-fg);
      background: repeating-linear-gradient(
        45deg,
        var(--mf-p-slate-bg) 0 4px,
        var(--mf-p-slate-line) 4px 7px
      );
    }
    .sw--off {
      color: var(--mf-p-slate-fg);
      background: var(--mf-surface);
      border: 2px dashed var(--mf-p-slate-solid);
    }
    .fine {
      margin: var(--mf-s2) 0 0;
      color: var(--mf-text-muted);
      font-size: 12px;
    }
    .stale {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--mf-s1);
      margin: 0 0 var(--mf-s2);
      color: var(--mf-warning);
      font-size: 12px;
    }
    .msg {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--mf-s2);
      padding: var(--mf-s3) 0;
      color: var(--mf-text-muted);
      font-size: 13px;
    }
    .msg b {
      color: var(--mf-text);
    }
    .skel {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s2);
    }
    .sk {
      display: block;
      border-radius: var(--mf-radius-md);
      background: var(--mf-surface-alt);
    }
    .sk--big {
      width: 60%;
      height: 24px;
    }
    .sk--bar {
      height: 51px;
    }
    .sk--line {
      width: 40%;
      height: 14px;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    @media (max-width: 767.98px) {
      .legend {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .fill {
        transition: none;
      }
    }
  `,
})
export class DashBattery {
  private readonly api = inject(DashV4Api);

  /** The page scope (`all`, `mine` or a pod id). */
  readonly scope = input.required<string>();
  /** Changes whenever the figures should be read again (a page refresh, a task assigned). */
  readonly refreshKey = input<unknown>(null);
  /** The last good read, for the page's "updated" text. */
  readonly loaded = output<DashboardCapacity>();
  /** The "N unassigned waiting" part of the summary line was pressed: the page selects the Unassigned card. */
  readonly showUnassigned = output<void>();

  protected readonly icons = WORD_ICON;
  protected readonly state = signal<BatteryState>('loading');
  protected readonly data = signal<DashboardCapacity | null>(null);
  /** A refresh failed but older figures are still on screen. */
  protected readonly stale = signal(false);
  protected readonly view = computed<BatteryView | null>(() => {
    const d = this.data();
    return d ? batteryView(d) : null;
  });
  protected readonly defaultFormula = 'Free capacity = free slots / (3 x people who take work).';
  protected readonly peopleOpen = signal(false);
  protected readonly people = signal<readonly CapacityPerson[]>([]);
  private readonly peopleBtn = viewChild<ElementRef<HTMLButtonElement>>('peopleBtn');
  protected readonly peopleButton = computed(() => this.peopleBtn()?.nativeElement ?? null);
  private seq = 0;

  constructor() {
    effect(() => {
      this.scope();
      this.refreshKey();
      untracked(() => this.load(false));
    });
  }

  /** `visible`: the person pressed Retry, so the skeleton shows; a background read keeps the figures on screen. */
  protected load(visible: boolean): void {
    const id = ++this.seq;
    if (visible || !this.data()) this.state.set('loading');
    this.api.capacity(this.scope()).subscribe({
      next: (c) => {
        if (id !== this.seq) return;
        this.data.set(c);
        this.state.set('ready');
        this.stale.set(false);
        this.loaded.emit(c);
        if (this.peopleOpen()) this.readPeople();
      },
      error: () => {
        if (id !== this.seq) return;
        if (this.data()) {
          this.stale.set(true);
          this.state.set('ready');
        } else this.state.set('error');
      },
    });
  }

  protected togglePeople(): void {
    if (this.peopleOpen()) {
      this.peopleOpen.set(false);
      return;
    }
    this.peopleOpen.set(true);
    this.readPeople();
  }

  /** The People call happens on open only (and again while open when the figures are refreshed). */
  private readPeople(): void {
    this.api.people(this.scope()).subscribe({
      next: (p) => this.people.set(p),
      error: () => this.people.set([]),
    });
  }
}
