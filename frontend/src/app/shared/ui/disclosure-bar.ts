import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * The header bar of a collapsible section (a disclosure): one full-width toggle BUTTON inside the section's heading (chevron, title, count,
 * a text badge and, while collapsed, a one-line preview), with the quick actions (projected buttons) at the right end. The button is not
 * nested with the actions, so the whole rest of the bar stays one click target. The host keeps the state and renders the panel `controls`
 * names. No animation.
 */
@Component({
  selector: 'mf-disclosure-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="db" [class.db--open]="open()">
      <h2 class="db__h" tabindex="-1" data-section-heading>
        <button
          type="button"
          class="db__toggle"
          data-toggle
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="controls()"
          [attr.aria-describedby]="preview() ? controls() + '-preview' : null"
          (click)="activated.emit()"
        >
          <i
            class="pi db__chev"
            [class.pi-chevron-down]="open()"
            [class.pi-chevron-right]="!open()"
            aria-hidden="true"
          ></i>
          <span class="db__main">
            <span class="db__line">
              <span class="db__title" data-bar-title>{{ label() }}</span>
              @if (badge()) {
                <span class="db__badge" data-new-badge>{{ badge() }}</span>
              }
            </span>
            @if (!open() && preview()) {
              <span class="db__preview" data-preview aria-hidden="true" [title]="preview()">{{
                preview()
              }}</span>
            }
          </span>
        </button>
      </h2>
      <span class="db__actions"><ng-content /></span>
      @if (preview()) {
        <span class="mf-sr-only" [id]="controls() + '-preview'">{{ preview() }}</span>
      }
      <span class="mf-sr-only" role="status" aria-live="polite" data-live>{{ announce() }}</span>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .db {
      container-type: inline-size;
      position: relative;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s2);
    }
    .db__h {
      flex: 1 1 8rem;
      min-width: 0;
      margin: 0;
      font-size: var(--mf-fs-h3);
      scroll-margin-top: calc(var(--mf-header-h, 3.75rem) + var(--mf-s4));
    }
    .db__h:focus {
      outline: none;
    }
    .db__h:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .db__toggle {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      width: 100%;
      min-height: var(--mf-target-min, 2rem);
      padding: var(--mf-s1) var(--mf-s2);
      border: 0;
      border-radius: var(--mf-radius);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .db__toggle:hover {
      background: var(--mf-surface-alt);
    }
    .db__toggle:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
    }
    .db__chev {
      flex: none;
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    .db__main {
      display: grid;
      flex: 1;
      min-width: 0;
    }
    .db__line {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0 var(--mf-s2);
    }
    .db__title {
      font-size: var(--mf-fs-h3);
      font-weight: 600;
    }
    .db__badge {
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius);
      background: var(--mf-text);
      color: var(--mf-surface);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      white-space: nowrap;
    }
    .db__preview {
      overflow: hidden;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 400;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .db__actions {
      display: inline-flex;
      flex: none;
      flex-wrap: wrap;
      gap: var(--mf-s2);
    }
  `,
})
export class DisclosureBar {
  /** Visible title with the count, e.g. `Comments (3)`. */
  readonly label = input.required<string>();
  readonly open = input.required<boolean>();
  /** Id of the panel the button controls (always in the page, hidden while collapsed). */
  readonly controls = input.required<string>();
  /** Text badge such as `2 new` (never colour alone). */
  readonly badge = input('');
  /** One line shown while collapsed (and read as the button's description). */
  readonly preview = input('');
  /** Text for the polite live region, set once. */
  readonly announce = input('');
  readonly activated = output<void>();
}
