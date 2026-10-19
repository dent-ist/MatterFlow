import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

/** One link of a section nav: the element it leads to (by id), its words and an optional count shown after them. */
export interface SectionNavItem {
  readonly key: string;
  readonly label: string;
  /** Element id of the section; also the `#` target of the real link. */
  readonly target: string;
  /** A short count (`48`, `2/3`); null while it is not known yet. */
  readonly count?: string | null;
  /** The longer words for the count, as the link's tooltip (`2 of 3 steps resolved`). */
  readonly hint?: string | null;
}

/** The section the page is reading: the last one whose top has reached `line`, or the last one once the page is scrolled to its end. */
export function currentSection(
  tops: readonly { key: string; top: number }[],
  line: number,
  atEnd: boolean,
): string | null {
  if (tops.length === 0) return null;
  if (atEnd) return tops[tops.length - 1].key;
  let current = tops[0].key;
  for (const t of tops) {
    if (t.top <= line) current = t.key;
  }
  return current;
}

/**
 * A compact row of links to the sections of one long page (`Workflow 2/3  Comments 48  Assets 0`), at every width. The links are real
 * anchors; a click is handed to the page (`navigate`) so it can open a collapsed section and move focus to its heading. The section the
 * page is reading carries `aria-current="location"` (scroll-spy over the section elements, on the window's scroll; nothing is observed
 * while the page is not scrolling). From 640 px the row sticks under the app header (`--mf-header-h`), below it flows with the page. The
 * parent decides where it sits; it sticks inside its parent's box.
 *
 * Inputs: `items`, `label` (the navigation's name). Output: `navigate` (the item's key).
 */
@Component({
  selector: 'mf-section-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="sn" [attr.aria-label]="label()" data-section-nav>
      <ul class="sn__list">
        @for (item of items(); track item.key) {
          <li>
            <a
              class="sn__link"
              [href]="'#' + item.target"
              [attr.data-section-link]="item.key"
              [attr.aria-current]="active() === item.key ? 'location' : null"
              [attr.title]="item.hint || null"
              (click)="go($event, item.key)"
            >
              <span>{{ item.label }}</span>
              @if (item.count) {
                &ngsp;
                <span class="sn__count" data-count>{{ item.count }}</span>
              }
            </a>
          </li>
        }
      </ul>
    </nav>
  `,
  styles: `
    :host {
      display: block;
    }
    .sn {
      box-sizing: border-box;
      background: var(--mf-bg);
    }
    .sn__list {
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .sn__link {
      display: inline-flex;
      align-items: baseline;
      gap: var(--mf-s2);
      box-sizing: border-box;
      min-height: 1.75rem;
      padding: 2px var(--mf-s3);
      border-radius: var(--mf-radius);
      color: var(--mf-link);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      line-height: 1.5rem;
      text-decoration: none;
    }
    .sn__link:hover {
      background: var(--mf-surface-alt);
      text-decoration: underline;
    }
    .sn__link:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .sn__link[aria-current='location'] {
      background: var(--mf-surface-alt);
      box-shadow: inset 0 -2px 0 var(--mf-primary);
      color: var(--mf-text);
    }
    .sn__count {
      color: var(--mf-text-muted);
      font-weight: 400;
      font-variant-numeric: tabular-nums;
    }
    @media (min-width: 640px) {
      :host {
        position: sticky;
        top: var(--mf-header-h, 3.75rem);
        z-index: 5;
      }
      .sn {
        padding: 2px 0;
        box-shadow: 0 1px 0 var(--mf-border);
      }
    }
  `,
})
export class SectionNav {
  readonly items = input.required<readonly SectionNavItem[]>();
  readonly label = input('Sections');
  readonly navigate = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly read = signal<string | null>(null);
  /** The section the person chose with a click, held as current until they scroll by hand (at the end of a short page the last section would win). */
  private pinned: string | null = null;
  /** The section being read: scroll-spy, falling back to the first item. */
  protected readonly active = computed(() => this.read() ?? this.items()[0]?.key ?? null);

  protected go(event: MouseEvent, key: string): void {
    // A modified click (new tab) keeps the browser's own behaviour.
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    this.pinned = key;
    this.read.set(key);
    this.navigate.emit(key);
  }

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      let frame = 0;
      const measure = () => {
        frame = 0;
        const root = this.host.nativeElement;
        const doc = document.documentElement;
        const style = getComputedStyle(root);
        const sticky = style.position === 'sticky';
        // The reading line sits under the app header and the sticky row (computed `top` is the header's height in px).
        const line = (sticky ? (parseFloat(style.top) || 0) + root.offsetHeight : 60) + 24;
        const tops = this.items()
          .map((i) => ({ key: i.key, el: document.getElementById(i.target) }))
          .filter((i): i is { key: string; el: HTMLElement } => i.el !== null)
          .map((i) => ({ key: i.key, top: i.el.getBoundingClientRect().top }));
        // A pinned section that has scrolled out of the window no longer holds (a script or a scroll bar moved the page).
        const pin = this.pinned ? tops.find((t) => t.key === this.pinned) : null;
        if (this.pinned && (!pin || pin.top < 0 || pin.top > window.innerHeight))
          this.pinned = null;
        const atEnd = window.innerHeight + window.scrollY >= doc.scrollHeight - 2;
        this.read.set(this.pinned ?? currentSection(tops, line, atEnd && window.scrollY > 0));
      };
      const schedule = () => {
        if (frame === 0) frame = requestAnimationFrame(measure);
      };
      const release = () => {
        this.pinned = null;
        schedule();
      };
      window.addEventListener('wheel', release, { passive: true });
      window.addEventListener('touchmove', release, { passive: true });
      const releaseKey = (e: KeyboardEvent) => {
        if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(e.key))
          release();
      };
      window.addEventListener('keydown', releaseKey, { passive: true });
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule, { passive: true });
      destroyRef.onDestroy(() => {
        window.removeEventListener('wheel', release);
        window.removeEventListener('touchmove', release);
        window.removeEventListener('keydown', releaseKey);
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', schedule);
        if (frame !== 0) cancelAnimationFrame(frame);
      });
    });
  }
}
