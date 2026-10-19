import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FixedPage } from './fixed-page';

/** Viewport width from which the Details panel sits to the right of the main area. */
export const DETAIL_WIDE_QUERY = '(min-width: 1100px)';
/** Viewport width from which the Details panel is always open (a `collapsible` layout lets people collapse it below this). */
export const DETAIL_XWIDE_QUERY = '(min-width: 1400px)';
/** Viewport width from which the collapsed summary starts expanded (tablets and up); phones start collapsed. */
export const DETAIL_TABLET_QUERY = '(min-width: 600px)';
/** The same, on a fixed-header page (record pages): only a tall window starts with the summary open, a short one leaves the height to the grid. */
export const DETAIL_TABLET_TALL_QUERY = '(min-width: 600px) and (min-height: 900px)';

/** The resizable layout (the Task page): the share of the width the main (left) column gets, in percent. */
export const SPLIT_DEFAULT = 60;
export const SPLIT_MIN = 35;
export const SPLIT_MAX = 70;
/** Width of the splitter handle between the columns, in px (the `1rem` of the grid). */
const SPLIT_HANDLE_PX = 16;

let nextId = 0;
const PANEL_KEY = 'mf.detail-panel.open';

function readPanelOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_KEY) === '1';
  } catch {
    return false;
  }
}

function clampSplit(value: number): number {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Number.isFinite(value) ? value : SPLIT_DEFAULT));
}

function readSplit(key: string): number {
  if (!key) return SPLIT_DEFAULT;
  try {
    const raw = localStorage.getItem(key);
    return raw === null || raw.trim() === '' ? SPLIT_DEFAULT : clampSplit(Number(raw));
  } catch {
    return SPLIT_DEFAULT;
  }
}

function saveSplit(key: string, value: number): void {
  if (!key) return;
  try {
    if (value === SPLIT_DEFAULT) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {
    // Not persisted (private window or blocked storage).
  }
}

function savePanelOpen(open: boolean): void {
  try {
    localStorage.setItem(PANEL_KEY, open ? '1' : '0');
  } catch {
    // Not persisted (private window or blocked storage).
  }
}

/**
 * The shared layout of the Client, Matter and Project detail pages: the record's main content (a grid) on the left and a Details panel
 * on the right.
 *
 * - From 1100 px: two columns, the main area fluid and an `aside` of about 340 px that stays in view while the page scrolls (and scrolls
 *   itself when it is taller than the window).
 * - `collapsible` (Matter and Project, whose main area is a wide task grid): between 1100 and 1399 px the panel can be collapsed to a
 *   slim "Details" button so the grid gets the width. It starts collapsed there and the choice is remembered. From 1400 px it is always open.
 * - Below 1100 px: one column; the panel moves ABOVE the main area (also in the reading and tab order) and its heading becomes a
 *   disclosure button (`aria-expanded`). It starts collapsed on phones and expanded on tablets. A `split` layout (the Task page) puts it
 *   LAST instead (main, `mfBelow`, then Details), closed at every width unless the person opened it (`narrowOpen`, remembered by the
 *   page), and the button carries a one-line `summary` (T5, #307).
 *
 * Slots: `mfMain` (the main area), `mfAside` (the Details content; the panel adds the "Details" heading, which names the `aside`) and the
 * optional `mfTop` and `mfBelow` (only with `split`: `mfTop` above the main area, for example the Task's section nav, which sticks while the
 * whole column scrolls; `mfBelow` under it, inside the same column, for example the Task's Comments and Assets).
 *
 * A wide panel that is taller than the window scrolls inside itself, hands the wheel on to the page at its ends (no scroll trap) and shows
 * a fade at its bottom edge while more is below (T5, #309).
 *
 * `split` (the Task page) makes the two columns resizable: the main column gets 60 % by default (35 to 70 %), a separator between the columns
 * is dragged (pointer and touch) or moved with the keyboard, the share is remembered under `splitKey` and a double click, Enter or the
 * "Reset layout" button restore 60 / 40. Below 1100 px there is no splitter: Details, main, then `mfBelow` in one column.
 *
 *   <mf-detail-layout><div mfMain>...</div><div mfAside>...</div></mf-detail-layout>
 */
@Component({
  selector: 'mf-detail-layout',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.dl--fixed]': 'fixed' },
  template: `
    <div
      class="dl"
      [style.--dl-aside]="asideWidth()"
      [style.--dl-cols]="splitting() ? splitColumns() : null"
      [class.dl--wide]="wide()"
      [class.dl--slim]="mid() && !isOpen()"
      [class.dl--split]="splitting()"
      [class.dl--dragging]="dragging()"
      data-detail-layout
      [attr.data-layout]="wide() ? (mid() ? 'wide-collapsible' : 'wide') : 'narrow'"
    >
      @if (!wide() && !split()) {
        <ng-container [ngTemplateOutlet]="panel" />
      }
      @if (split()) {
        <div class="dl__left" data-detail-left>
          <ng-content select="[mfTop]" />
          <div class="dl__main" data-detail-main>
            <ng-container [ngTemplateOutlet]="main" />
          </div>
          <div class="dl__below" data-detail-below>
            <ng-content select="[mfBelow]" />
          </div>
        </div>
      } @else {
        <div class="dl__main" data-detail-main>
          <ng-container [ngTemplateOutlet]="main" />
        </div>
      }
      @if (splitting()) {
        <div
          #handle
          class="dl__split"
          role="separator"
          tabindex="0"
          aria-orientation="vertical"
          aria-label="Resize Details panel"
          title="Drag to resize. Double-click to reset to 60 / 40."
          data-splitter
          [attr.aria-valuenow]="valueNow()"
          [attr.aria-valuemin]="splitMin"
          [attr.aria-valuemax]="splitMax"
          [attr.aria-valuetext]="valueText()"
          (pointerdown)="dragStart($event)"
          (pointermove)="dragMove($event)"
          (pointerup)="dragEnd($event)"
          (pointercancel)="dragEnd($event)"
          (lostpointercapture)="dragEnd($event)"
          (keydown)="onSplitKey($event)"
          (dblclick)="resetSplit()"
        >
          <span class="dl__grip" aria-hidden="true"></span>
        </div>
      }
      @if (wide() || split()) {
        <ng-container [ngTemplateOutlet]="panel" />
      }
    </div>

    <ng-template #main><ng-content select="[mfMain]" /></ng-template>

    <ng-template #panel>
      <aside
        #aside
        class="dl__aside"
        [class.dl__aside--more]="more()"
        [attr.aria-labelledby]="uid + '-h'"
        data-detail-panel
        (scroll)="measure()"
      >
        <div class="dl__bar">
          <h2 class="dl__h" [id]="uid + '-h'">
            @if (!wide() || mid()) {
              <button
                type="button"
                class="dl__toggle"
                data-detail-toggle
                [attr.aria-expanded]="isOpen()"
                [attr.aria-controls]="uid + '-body'"
                (click)="toggle()"
              >
                <span class="dl__ht">{{ heading() }}</span>
                @if (summary() && !wide()) {
                  <span class="dl__sum" data-detail-summary>{{ summary() }}</span>
                }
                <i class="pi dl__chevron" [class]="chevron()" aria-hidden="true"></i>
              </button>
            } @else {
              <span class="dl__t">{{ heading() }}</span>
            }
          </h2>
          @if (splitting() && pct() !== splitDefault) {
            <button type="button" class="dl__reset" data-split-reset (click)="resetSplit()">
              Reset layout
            </button>
          }
        </div>
        <div class="dl__body" [id]="uid + '-body'" [hidden]="!isOpen()" data-detail-body>
          <ng-content select="[mfAside]" />
        </div>
        <div class="dl__fade" aria-hidden="true" data-detail-fade></div>
      </aside>
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
    }
    .dl {
      display: block;
    }
    .dl--wide {
      display: grid;
      grid-template-columns: minmax(0, 1fr) var(--dl-aside, 340px);
      gap: var(--mf-s5);
      align-items: start;
    }
    .dl--slim {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    /* The resizable layout: left column, handle (1rem), Details; --dl-cols carries the two shares. */
    .dl--wide.dl--split {
      grid-template-columns: var(--dl-cols);
      column-gap: 0;
    }
    .dl__left {
      min-width: 0;
    }
    .dl__below {
      min-width: 0;
      margin-top: var(--mf-s5);
    }
    .dl__below:empty {
      display: none;
    }
    .dl__split {
      position: sticky;
      top: calc(var(--mf-header-h, 3.75rem) + var(--mf-s4));
      align-self: start;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      height: calc(100vh - var(--mf-header-h, 3.75rem) - var(--mf-s5) - var(--mf-s4));
      min-height: 8rem;
      cursor: col-resize;
      touch-action: none;
      user-select: none;
      border-radius: var(--mf-radius);
    }
    .dl__split::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 50%;
      width: 2px;
      transform: translateX(-50%);
      border-radius: 1px;
      background: var(--mf-border);
      transition: background-color 0.15s;
    }
    .dl__grip {
      position: relative;
      width: 6px;
      height: 2.5rem;
      border: 1px solid var(--mf-border-strong);
      border-radius: 3px;
      background: var(--mf-surface);
    }
    .dl__split:hover::before,
    .dl--dragging .dl__split::before {
      width: 4px;
      background: var(--mf-primary);
    }
    .dl__split:hover .dl__grip,
    .dl--dragging .dl__grip {
      border-color: var(--mf-primary);
      background: var(--mf-primary);
    }
    .dl__split:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .dl__split:focus-visible::before {
      width: 4px;
      background: var(--mf-focus);
    }
    .dl__split:focus-visible .dl__grip {
      border-color: var(--mf-focus);
      background: var(--mf-focus);
    }
    .dl--dragging {
      cursor: col-resize;
    }
    .dl__bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
      padding-right: var(--mf-s3);
    }
    .dl__bar .dl__h {
      flex: 1 1 auto;
      min-width: 0;
    }
    .dl__reset {
      flex: none;
      min-height: var(--mf-target-min, 2rem);
      padding: 0 var(--mf-s2);
      border: 0;
      background: transparent;
      color: var(--mf-link);
      font: inherit;
      font-size: var(--mf-fs-sm);
      text-decoration: underline;
      cursor: pointer;
    }
    .dl__main {
      min-width: 0;
    }
    .dl__aside {
      min-width: 0;
      margin-bottom: var(--mf-s4);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      box-shadow: var(--mf-shadow-1);
    }
    .dl--wide .dl__aside {
      position: sticky;
      top: calc(var(--mf-header-h, 3.75rem) + var(--mf-s4));
      max-height: calc(100vh - var(--mf-header-h, 3.75rem) - var(--mf-s5) - var(--mf-s4));
      margin-bottom: 0;
      overflow-y: auto;
      /* The wheel goes on to the page at the panel's ends (#309): the panel is never a scroll trap. */
      overscroll-behavior: auto;
    }
    /* The cue that more is below: a fade over the panel's bottom edge, only while the panel still has something to scroll to. */
    .dl__fade {
      display: none;
    }
    .dl--wide .dl__aside--more .dl__fade {
      display: block;
      position: sticky;
      bottom: 0;
      height: 2.5rem;
      margin-top: -2.5rem;
      border-radius: 0 0 var(--mf-radius) var(--mf-radius);
      background: linear-gradient(to bottom, transparent, var(--mf-surface));
      pointer-events: none;
    }
    .dl__h {
      margin: 0;
      font-size: var(--mf-fs-h3);
      line-height: 1.3;
    }
    .dl__t {
      display: block;
      padding: var(--mf-s3) var(--mf-s4);
    }
    .dl__toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s3);
      box-sizing: border-box;
      width: 100%;
      min-height: 2.75rem;
      padding: var(--mf-s3) var(--mf-s4);
      background: none;
      border: 0;
      color: inherit;
      font: inherit;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }
    .dl__ht {
      flex: none;
    }
    /* The one-line summary of a closed Details (#307): it takes the room that is left and ends in an ellipsis. */
    .dl__sum {
      flex: 1 1 0;
      min-width: 0;
      overflow: hidden;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 400;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dl__chevron {
      flex: none;
      margin-left: auto;
    }
    .dl__toggle:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .dl__body {
      padding: 0 var(--mf-s4) var(--mf-s4);
      overflow-wrap: anywhere;
    }
    .dl__body[hidden] {
      display: none;
    }
    /*
     * Inside a fixed-header page (mf-fixed-page) the layout fills what is left under the pinned header: the main area is a column
     * whose grid scrolls, and the Details panel scrolls inside itself (it does not stick to the window). Narrow screens stack them, the
     * panel capped to a third of the window so the grid keeps the rest.
     */
    @media (min-width: 768px) and (min-height: 561px) {
      :host(.dl--fixed) {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }
      :host(.dl--fixed) .dl {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }
      :host(.dl--fixed) .dl--wide {
        display: grid;
        grid-template-rows: minmax(0, 1fr);
        align-items: stretch;
      }
      :host(.dl--fixed) .dl__main {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }
      :host(.dl--fixed) .dl--wide .dl__aside {
        position: static;
        max-height: 100%;
      }
      :host(.dl--fixed) .dl:not(.dl--wide) .dl__aside {
        flex: none;
        max-height: 35dvh;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
    }
  `,
})
export class DetailLayout {
  /** Inside a fixed-header page (see the styles). */
  protected readonly fixed = inject(FixedPage, { optional: true }) !== null;

  readonly heading = input('Details');
  /** Lets the panel collapse between 1100 and 1399 px (see the class comment). */
  readonly collapsible = input(false);
  /** Width of the side panel from 1100 px (any CSS length); the Task page asks for more room for its Details. */
  readonly asideWidth = input('340px');
  /** Makes the two columns resizable and adds the `mfBelow` slot under the main area (the Task page). */
  readonly split = input(false);
  /** localStorage key that remembers the width (include the user id); empty means not remembered. */
  readonly splitKey = input('');
  /** One line that says what a closed Details holds (below 1100 px, `split` layouts: the button shows it next to the heading). */
  readonly summary = input('');
  /**
   * Whether Details is open below 1100 px in a `split` layout. `null` = nothing chosen: closed. The page remembers the choice (it
   * listens to `narrowOpenChange`, which fires for the person's own toggle only) and may set it to show Details (`?tab=details`).
   */
  readonly narrowOpen = model<boolean | null>(null);

  protected readonly splitDefault = SPLIT_DEFAULT;
  protected readonly splitMin = SPLIT_MIN;
  protected readonly splitMax = SPLIT_MAX;
  private readonly handle = viewChild<ElementRef<HTMLElement>>('handle');
  /** Share of the width for the main (left) column, in percent. Read from storage as soon as the key is known, so nothing jumps on load. */
  protected readonly pct = linkedSignal(() => readSplit(this.splitKey()));
  protected readonly dragging = signal(false);
  /** The splitter is shown in the two-column layout of a `split` layout only. */
  protected readonly splitting = computed(() => this.split() && this.wide());
  protected readonly splitColumns = computed(() => {
    const left = this.pct();
    return `minmax(0, ${left}fr) ${SPLIT_HANDLE_PX / 16}rem minmax(0, ${100 - left}fr)`;
  });
  protected readonly valueNow = computed(() => Math.round(this.pct()));
  protected readonly valueText = computed(
    () => `Main area ${this.valueNow()} percent, Details ${100 - this.valueNow()} percent`,
  );
  private dragPointer: number | null = null;
  private previousUserSelect = '';

  protected readonly uid = `dl-${nextId++}`;
  /** True from 1100 px (two columns). Without `matchMedia` (tests) the wide layout is used. */
  protected readonly wide = signal(true);
  /** True from 1400 px: the panel is always open. Without `matchMedia` (tests) it is true. */
  protected readonly xwide = signal(true);
  /** Whether the collapsible summary is open (only meaningful below 1100 px). */
  protected readonly open = signal(true);
  /** Whether the panel is open between 1100 and 1399 px in a `collapsible` layout (remembered; starts collapsed). */
  protected readonly midOpen = signal(false);
  /** Wide but not extra wide, in a collapsible layout: the panel has a toggle. */
  protected readonly mid = computed(() => this.collapsible() && this.wide() && !this.xwide());
  /** The disclosure below 1100 px: a `split` layout is closed until opened, the others follow the screen size. */
  private readonly narrowIsOpen = computed(() =>
    this.split() ? (this.narrowOpen() ?? false) : this.open(),
  );
  protected readonly isOpen = computed(() =>
    !this.wide() ? this.narrowIsOpen() : this.mid() ? this.midOpen() : true,
  );
  /** The wide panel scrolls and has more below its visible part (the fade cue). */
  protected readonly more = signal(false);
  private readonly aside = viewChild<ElementRef<HTMLElement>>('aside');
  protected readonly chevron = computed(() =>
    !this.wide()
      ? this.narrowIsOpen()
        ? 'pi-chevron-up'
        : 'pi-chevron-down'
      : this.midOpen()
        ? 'pi-chevron-right'
        : 'pi-chevron-left',
  );

  protected toggle(): void {
    if (this.wide()) {
      const next = !this.midOpen();
      this.midOpen.set(next);
      savePanelOpen(next);
    } else if (this.split()) {
      const next = !this.narrowIsOpen();
      this.narrowOpen.set(next);
    } else {
      this.open.set(!this.open());
    }
  }

  /** Reads the panel's scroll position for the fade cue. */
  protected measure(): void {
    const el = this.aside()?.nativeElement;
    if (!el) return;
    this.more.set(this.wide() && el.scrollHeight - el.scrollTop - el.clientHeight > 2);
  }

  /** Sets the share (clamped to 35 to 70 %); `persist` writes it to storage (end of a drag, every key press). */
  protected setSplit(value: number, persist = true): void {
    const next = clampSplit(Math.round(value * 10) / 10);
    this.pct.set(next);
    if (persist) saveSplit(this.splitKey(), next);
  }

  protected resetSplit(): void {
    this.setSplit(SPLIT_DEFAULT);
  }

  protected onSplitKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 10 : 2;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        next = this.pct() - step;
        break;
      case 'ArrowRight':
        next = this.pct() + step;
        break;
      case 'Home':
        next = SPLIT_MIN;
        break;
      case 'End':
        next = SPLIT_MAX;
        break;
      case 'Enter':
        next = SPLIT_DEFAULT;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.setSplit(next);
  }

  protected dragStart(event: PointerEvent): void {
    if (event.button !== undefined && event.button !== 0) return;
    this.dragPointer = event.pointerId;
    this.dragging.set(true);
    const el = event.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // No capture (older browsers or synthetic events): moves still arrive while the pointer is over the handle.
    }
    // No text selection while dragging; the previous value comes back when the drag ends (or the page goes away).
    this.previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    el.focus({ preventScroll: true });
    event.preventDefault();
  }

  protected dragMove(event: PointerEvent): void {
    if (this.dragPointer !== event.pointerId) return;
    const handle = this.handle()?.nativeElement;
    const grid = handle?.parentElement;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const usable = rect.width - SPLIT_HANDLE_PX;
    if (usable <= 0) return;
    this.setSplit(((event.clientX - rect.left - SPLIT_HANDLE_PX / 2) / usable) * 100, false);
  }

  protected dragEnd(event: PointerEvent): void {
    if (this.dragPointer === null || this.dragPointer !== event.pointerId) return;
    this.dragPointer = null;
    this.dragging.set(false);
    document.body.style.userSelect = this.previousUserSelect;
    saveSplit(this.splitKey(), this.pct());
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.dragPointer !== null) document.body.style.userSelect = this.previousUserSelect;
    });
    // The fade cue follows the panel's size (content arriving, the window resizing, the panel opening).
    effect((onCleanup) => {
      const el = this.aside()?.nativeElement;
      this.wide();
      if (!el || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => this.measure());
      observer.observe(el);
      const body = el.querySelector('[data-detail-body]');
      if (body) observer.observe(body);
      this.measure();
      onCleanup(() => observer.disconnect());
    });
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const wide = window.matchMedia(DETAIL_WIDE_QUERY);
    this.wide.set(wide.matches);
    // Tablets start with the summary open, but on a fixed-header page only when the window is tall: the grid needs the height.
    this.open.set(
      window.matchMedia(this.fixed ? DETAIL_TABLET_TALL_QUERY : DETAIL_TABLET_QUERY).matches,
    );
    const xwide = window.matchMedia(DETAIL_XWIDE_QUERY);
    this.xwide.set(xwide.matches);
    this.midOpen.set(readPanelOpen());
    const onChange = (e: MediaQueryListEvent) => this.wide.set(e.matches);
    const onXChange = (e: MediaQueryListEvent) => this.xwide.set(e.matches);
    wide.addEventListener('change', onChange);
    xwide.addEventListener('change', onXChange);
    inject(DestroyRef).onDestroy(() => {
      wide.removeEventListener('change', onChange);
      xwide.removeEventListener('change', onXChange);
    });
  }
}
