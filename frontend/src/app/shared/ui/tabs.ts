import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FixedPage } from './fixed-page';
import { TabBox, pageLeft, revealLeft, scrollCues } from './tab-scroll';

export interface MfTab {
  key: string;
  label: string;
  /** Count shown in parentheses; omitted while unknown (a string such as `--` while it loads). */
  count?: number | string | null;
}

/**
 * The shared tab list (WAI-ARIA tabs pattern, automatic activation): the selected tab is the only tab stop (roving tabindex), Left
 * and Right move between tabs and wrap round, Home and End jump to the first and last, and moving to a tab selects it. The page owns
 * the selection (usually in the address) and renders the matching `role="tabpanel"` with `id="<idPrefix>-panel"` and
 * `aria-labelledby="<idPrefix>-tab-<key>"`. On a narrow screen the list scrolls sideways instead of wrapping (#279): the side that has more
 * tabs shows an edge fade and a chevron (a mouse and touch aid only: not a tab stop and hidden from assistive technology, because the
 * arrow keys already move between tabs), the selected tab is scrolled into view on load, link, click and key, a tab is not left cut at the
 * leading edge (`scroll-snap-type: x proximity`), and with reduced motion the scroll is instant.
 */
@Component({
  selector: 'mf-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.tabs--pinned]': 'pinned' },
  template: `
    <div class="strip" [attr.data-more-start]="cues().start" [attr.data-more-end]="cues().end">
      <div
        class="tabs"
        role="tablist"
        [attr.aria-label]="label()"
        (scroll)="measure()"
        (wheel)="touched = true"
        (touchstart)="touched = true"
        (pointerdown)="touched = true"
      >
        @for (t of tabs(); track t.key) {
          <button
            type="button"
            role="tab"
            class="tab"
            [id]="idPrefix() + '-tab-' + t.key"
            [attr.data-tab]="t.key"
            [attr.aria-selected]="t.key === selected()"
            [attr.aria-controls]="t.key === selected() ? idPrefix() + '-panel' : null"
            [attr.tabindex]="t.key === selected() ? 0 : -1"
            (click)="choose(t.key)"
            (keydown)="onKey($event)"
          >
            {{ t.label }}
            @if (t.count !== undefined && t.count !== null) {
              <span class="count">({{ t.count }})</span>
            }
          </button>
        }
      </div>
      @if (cues().start) {
        <button
          type="button"
          class="cue cue--start"
          tabindex="-1"
          aria-hidden="true"
          data-tab-cue="start"
          (click)="page(-1)"
        >
          <i class="pi pi-chevron-left"></i>
        </button>
      }
      @if (cues().end) {
        <button
          type="button"
          class="cue cue--end"
          tabindex="-1"
          aria-hidden="true"
          data-tab-cue="end"
          (click)="page(1)"
        >
          <i class="pi pi-chevron-right"></i>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--mf-s4);
    }
    .strip {
      position: relative;
      min-width: 0;
    }
    .tabs {
      display: flex;
      scroll-snap-type: x proximity;
      scroll-padding-inline: 1.75rem;
      overscroll-behavior-x: contain;
      gap: var(--mf-s1);
      overflow-x: auto;
      /* No vertical scrollbar: the tabs no longer overhang the strip (the hairline is an inset shadow, not a border + negative margin). */
      overflow-y: hidden;
      box-shadow: inset 0 -1px 0 var(--mf-border);
      scrollbar-width: thin;
    }
    /* The scroll cue: a chevron on a solid patch that fades out towards the tabs. Over the tabs, so a tab never shows under it. */
    .cue {
      position: absolute;
      top: 0;
      bottom: 1px;
      display: flex;
      align-items: center;
      width: 1.75rem;
      padding: 0;
      color: var(--mf-text);
      background: var(--mf-bg);
      border: 0;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .cue::after {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      width: var(--mf-s3);
      pointer-events: none;
    }
    .cue--start {
      left: 0;
      justify-content: flex-start;
      padding-left: var(--mf-s1);
    }
    .cue--start::after {
      left: 100%;
      background: linear-gradient(to right, var(--mf-bg), transparent);
    }
    .cue--end {
      right: 0;
      justify-content: flex-end;
      padding-right: var(--mf-s1);
    }
    .cue--end::after {
      right: 100%;
      background: linear-gradient(to left, var(--mf-bg), transparent);
    }
    .tab {
      flex: none;
      scroll-snap-align: start;
      min-height: 2.75rem;
      padding: 0 var(--mf-s4);
      color: var(--mf-text-muted);
      background: none;
      border: 0;
      border-bottom: 3px solid transparent;
      font: inherit;
      font-weight: 500;
      white-space: nowrap;
      cursor: pointer;
    }
    .tab:hover {
      color: var(--mf-text);
      background: var(--mf-surface-alt);
    }
    .tab[aria-selected='true'] {
      color: var(--mf-text);
      font-weight: 600;
      border-bottom-color: var(--mf-primary);
    }
    .tab:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .count {
      color: var(--mf-text-muted);
      font-weight: 400;
    }
    /* Pinned under the title of a fixed-header page: tighter, so the grid keeps its height. */
    @media (min-width: 768px) and (min-height: 561px) {
      :host(.tabs--pinned) {
        margin-bottom: var(--mf-s2);
      }
      :host(.tabs--pinned) .tab {
        min-height: 2.5rem;
      }
    }
  `,
})
export class Tabs {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly pinned = inject(FixedPage, { optional: true }) !== null;
  /** Which sides of the strip have more tabs (drives the cues). */
  protected readonly cues = signal({ start: false, end: false });
  /** The person scrolled the strip by hand since the last reveal: a later change of the tabs (a count arriving) leaves it where it is. */
  protected touched = false;
  private shown: string | null = null;
  private watcher: ResizeObserver | null = null;

  readonly tabs = input.required<readonly MfTab[]>();
  readonly selected = input.required<string>();
  readonly label = input('Views');
  /** Prefix of the element ids (`<prefix>-tab-<key>`; the page's panel is `<prefix>-panel`). */
  readonly idPrefix = input('mf');
  /** The tab the person chose (click or keyboard). */
  readonly tabChange = output<string>();

  constructor() {
    afterNextRender(() => this.measure());
    // The selected tab is brought into view on load, on a link, on a click and on a key; instantly the first time and with reduced motion.
    afterRenderEffect(() => {
      const key = this.selected();
      this.tabs();
      untracked(() => {
        const changed = key !== this.shown;
        if (!changed && this.touched) return;
        this.touched = false;
        this.reveal(key, changed && this.shown !== null);
        this.shown = key;
        this.watch();
      });
    });
    this.destroyRef.onDestroy(() => this.watcher?.disconnect());
  }

  private strip(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('.tabs');
  }

  private boxes(strip: HTMLElement): TabBox[] {
    const base = strip.getBoundingClientRect().left - strip.scrollLeft;
    return Array.from(strip.querySelectorAll<HTMLElement>('.tab')).map((tab) => {
      const r = tab.getBoundingClientRect();
      return { start: r.left - base, end: r.right - base };
    });
  }

  private scrollTo(strip: HTMLElement, left: number, animate: boolean): void {
    if (Math.abs(left - strip.scrollLeft) < 1) return;
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    strip.scrollTo?.({ left, behavior: animate && !reduced ? 'smooth' : 'instant' });
    if (!strip.scrollTo) strip.scrollLeft = left;
  }

  /** Scrolls the strip (never the document) so that the tab is whole and no tab is cut at the leading edge. */
  private reveal(key: string, animate: boolean): void {
    const strip = this.strip();
    if (!strip) return;
    const at = this.tabs().findIndex((t) => t.key === key);
    if (at >= 0) {
      this.scrollTo(
        strip,
        revealLeft(this.boxes(strip), at, strip.scrollLeft, strip.clientWidth, strip.scrollWidth),
        animate,
      );
    }
    this.measure();
  }

  /** Reads which sides have more tabs. */
  protected measure(): void {
    const strip = this.strip();
    if (!strip) return;
    const next = scrollCues(strip.scrollLeft, strip.clientWidth, strip.scrollWidth);
    const now = this.cues();
    if (now.start !== next.start || now.end !== next.end) this.cues.set(next);
  }

  /** Keeps the cues right when the strip or a tab changes width (a count arrives, the window turns, a font loads). */
  private watch(): void {
    const strip = this.strip();
    if (!strip || typeof ResizeObserver === 'undefined') return;
    this.watcher ??= new ResizeObserver(() => this.measure());
    this.watcher.disconnect();
    this.watcher.observe(strip);
    strip.querySelectorAll('.tab').forEach((tab) => this.watcher?.observe(tab));
  }

  /** A press on a chevron: one screen of tabs towards that side. */
  protected page(direction: 1 | -1): void {
    const strip = this.strip();
    if (!strip) return;
    this.touched = true;
    this.scrollTo(
      strip,
      pageLeft(
        this.boxes(strip),
        direction,
        strip.scrollLeft,
        strip.clientWidth,
        strip.scrollWidth,
      ),
      true,
    );
  }

  protected choose(key: string): void {
    if (key !== this.selected()) this.tabChange.emit(key);
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const keys = this.tabs().map((t) => t.key);
    const at = Math.max(0, keys.indexOf(this.selected()));
    let to: number;
    switch (event.key) {
      case 'ArrowRight':
        to = (at + 1) % keys.length;
        break;
      case 'ArrowLeft':
        to = (at - 1 + keys.length) % keys.length;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = keys.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    // Focus without the browser scrolling anything: the strip is moved by `reveal`, and never the document.
    this.host.nativeElement
      .querySelector<HTMLElement>(`[data-tab="${keys[to]}"]`)
      ?.focus({ preventScroll: true });
    this.choose(keys[to]);
    this.touched = false;
    this.reveal(keys[to], true);
  }
}
