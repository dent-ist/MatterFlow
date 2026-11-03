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

type BatteryState = 'loading' | 'ready' | 'error';

/**
 * The department capacity battery (epic #1063, DB-05): ONE indicator for everyone who takes work in the scope. The charge is the FREE capacity, the percentage REMAINING sits inside the battery next to a bolt,
 * a summary line says "8 of 12 can take work now", a compact legend counts people per state (icon and words, never colour alone), an info button explains the formula, and the People
 * button opens the list of names. After hours or when nobody can take work the API sends no percentage and the battery shows a neutral "After hours" state instead of 100 percent used.
 * It reads `GET /dashboard/capacity` for the page scope and again whenever `refreshKey` changes (the page refreshes, or a task was assigned); the People list is read when the popover opens.
 * Shown only with Dashboard.ViewUsers (the page decides).
 */
@Component({
  selector: 'mf-dash-battery',
  imports: [Tip, DashPeople],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="panel"
      data-battery
      aria-labelledby="db-h"
      [attr.aria-busy]="state() === 'loading' ? 'true' : null"
    >
      <div class="ph">
        <h2 id="db-h"><i class="pi pi-bolt" aria-hidden="true"></i>Team capacity</h2>
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
              class="mf-btn people"
              data-people-open
              [attr.aria-expanded]="peopleOpen()"
              (click)="togglePeople()"
            >
              <i class="pi pi-users" aria-hidden="true"></i>People
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
            <b>Team capacity could not be loaded.</b>
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
                Could not refresh. Showing the last figures.
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
                  <span class="val" [attr.data-level]="v.level" data-battery-big>
                    <i class="pi pi-bolt" aria-hidden="true"></i>{{ v.bigText }}
                  </span>
                </div>
                <div class="cap"></div>
              </div>
              <p class="sum" data-battery-summary>{{ v.summaryLine }}</p>
              <ul class="legend" aria-label="People by state" data-battery-legend>
                @for (l of v.legend; track l.state) {
                  <li class="lg" [attr.data-state]="l.state">
                    <span class="sw" [class]="'sw sw--' + l.swatch" aria-hidden="true">
                      <i class="pi" [class]="l.icon"></i>
                    </span>
                    <b>{{ l.count }}</b>
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
      flex-wrap: wrap;
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
      height: 34px;
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
    /* The number sits on its own pill in the step colour, so its contrast does not depend on how full the battery is. */
    .val {
      position: absolute;
      top: 50%;
      left: var(--mf-s2);
      z-index: 1;
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 0 var(--mf-s2);
      border-radius: 999px;
      transform: translateY(-50%);
      color: var(--mf-rem-fg, var(--mf-text));
      background: var(--mf-rem, var(--mf-surface));
      border: 1px solid var(--mf-surface);
      font-size: 15px;
      font-weight: 700;
      line-height: 22px;
      white-space: nowrap;
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
      margin: 9px 0;
      border-radius: 0 4px 4px 0;
      background: var(--mf-border-strong);
    }
    .sum {
      margin: var(--mf-s2) 0 0;
      font-size: 13px;
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
      height: 34px;
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
