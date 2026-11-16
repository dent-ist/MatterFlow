import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IntPipe } from './number-format';

export interface JumpLink {
  key: string;
  label: string;
  /** A PrimeIcons class drawn before the label; decorative. */
  icon: string;
  /** Count shown in brackets; omitted while unknown or when the viewer may not see what it counts. */
  count?: number | string | null;
}

/**
 * The sticky jump strip of a long page (D-03b, #1396; first use: the Matter page). It looks like the tab strip (`mf-tabs`, D-15: 40 px, icon 20, label 14, count in
 * brackets, 2 px underline on the current one) but it is a `nav` landmark of links, not tabs: a click scrolls to the section (the page does it, smooth unless the person asks
 * for reduced motion), the section in view is `aria-current="location"`. It sticks under the top bar (`--mf-header-h`) and spans the width of the main area; the address does not change.
 * While it is stuck it gets the card shadow and shows `meta` (the record's number) at the right.
 *
 *   <mf-jump-strip label="Matter sections" [links]="links()" [current]="current()" [stuck]="stuck()" meta="00343-00012" (jump)="goTo($event)" />
 */
@Component({
  selector: 'mf-jump-strip',
  imports: [IntPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.js--stuck]': 'stuck()', '[attr.data-jump-strip]': '""' },
  template: `
    <nav class="js" [attr.aria-label]="label()">
      <ul class="js__list">
        @for (l of links(); track l.key) {
          <li>
            <a
              class="js__a"
              [attr.href]="'#section-' + l.key"
              [attr.data-jump]="l.key"
              [attr.aria-current]="l.key === current() ? 'location' : null"
              [attr.aria-label]="nameOf(l)"
              (click)="choose($event, l.key)"
            >
              <i class="pi js__icon" [class]="l.icon" aria-hidden="true"></i>
              {{ l.label }}
              @if (l.count !== undefined && l.count !== null) {
                <span class="js__count">({{ l.count | mfInt }})</span>
              }
            </a>
          </li>
        }
      </ul>
      @if (stuck() && meta()) {
        <span class="js__meta" data-jump-meta>{{ meta() }}</span>
      }
    </nav>
  `,
  styles: `
    :host {
      position: sticky;
      top: var(--mf-header-h, 53px);
      z-index: 10;
      display: block;
      /* Full width of the main area (its 24 px gutter included), so the rows that scroll under it never show beside it. */
      margin-inline: calc(-1 * var(--mf-s5));
      padding-inline: var(--mf-s5);
      background: var(--mf-bg);
      box-shadow: inset 0 -1px 0 var(--mf-border);
    }
    :host(.js--stuck) {
      box-shadow:
        inset 0 -1px 0 var(--mf-border),
        var(--mf-shadow-sticky, var(--mf-shadow-1));
    }
    .js {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
    }
    .js__list {
      display: flex;
      flex: 1 1 auto;
      gap: var(--mf-s1);
      min-width: 0;
      margin: 0;
      padding: 0;
      overflow-x: auto;
      overflow-y: hidden;
      list-style: none;
      scrollbar-width: thin;
    }
    .js__a {
      display: flex;
      align-items: center;
      box-sizing: border-box;
      height: var(--mf-tab-h);
      padding: 0 var(--mf-s3);
      border-bottom: 2px solid transparent;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-md);
      font-weight: 400;
      text-decoration: none;
      white-space: nowrap;
    }
    .js__a:hover {
      color: var(--mf-text);
      background: var(--mf-surface-alt);
      text-decoration: none;
    }
    .js__a[aria-current='location'] {
      color: var(--mf-primary);
      font-weight: 600;
      border-bottom-color: var(--mf-primary);
    }
    .js__a:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .js__icon {
      margin-right: var(--mf-s2);
      font-size: var(--mf-icon-lg);
    }
    .js__count {
      margin-left: var(--mf-s1);
      color: var(--mf-text-muted);
      font-variant-numeric: tabular-nums;
      font-weight: 400;
    }
    .js__meta {
      flex: none;
      color: var(--mf-text);
      font-family: var(--mf-font-mono);
      font-size: var(--mf-fs-md);
      font-weight: 600;
    }
  `,
})
export class JumpStrip {
  readonly links = input.required<readonly JumpLink[]>();
  /** The key of the section in view. */
  readonly current = input.required<string>();
  readonly label = input('Sections');
  /** True while the strip sticks to the top bar (the page reads it from the scroll position). */
  readonly stuck = input(false);
  /** Shown at the right while stuck (the record's number). */
  readonly meta = input('');
  /** A link was chosen (click or Enter). */
  readonly jump = output<string>();

  protected nameOf(l: JumpLink): string | null {
    return typeof l.count === 'number' || (typeof l.count === 'string' && /^\d+$/.test(l.count))
      ? `${l.label}, ${l.count}`
      : null;
  }

  protected choose(event: MouseEvent, key: string): void {
    // A modified click keeps the browser's own behaviour; the address never changes (no hash), so the plain click is ours.
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    this.jump.emit(key);
  }
}
