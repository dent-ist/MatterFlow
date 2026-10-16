import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
  output,
} from '@angular/core';
import { ErrorReference } from '../../../shared/ui/error-reference';

export type DashStateVariant = 'error' | 'stale' | 'empty-filtered' | 'empty';

/**
 * The one state block of every Dashboard tab (UX review 2, P7):
 *  - `error`: a first load failed. Inline, `role="alert"`, a plain message, the error reference when the API sent one, and a text Retry.
 *  - `stale`: a refresh failed and the figures on screen are older. `role="status"` ("Could not refresh. Showing data from 10:42 AM."), Retry.
 *  - `empty-filtered`: filters hide everything; "Clear filters" undoes them.
 *  - `empty`: nothing to show; the tab passes its own message.
 * It renders inside the tab panel, so the tab row, the Refresh button and the page header stay. Selectors: `[data-dash-state="error|stale|empty"]`
 * and the button `[data-dash-retry]`. The variants are one element at a time (exactly one `role="alert"` is on screen).
 */
@Component({
  selector: 'mf-dash-state',
  imports: [ErrorReference],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (variant()) {
      @case ('error') {
        <div class="state state--error" role="alert" data-dash-state="error">
          <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
          <div class="body">
            <span>{{ message() }}</span>
            <mf-error-reference />
          </div>
          <button type="button" class="mf-btn" data-dash-retry (click)="retry.emit()">Retry</button>
        </div>
      }
      @case ('stale') {
        <div class="state state--stale" role="status" data-dash-state="stale">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          <div class="body">
            <span
              >Could not refresh.
              @if (updated()) {
                Showing data from {{ updated() }}.
              }
            </span>
            <mf-error-reference />
          </div>
          <button type="button" class="mf-btn" data-dash-retry (click)="retry.emit()">Retry</button>
        </div>
      }
      @case ('empty-filtered') {
        <div class="state state--empty" role="status" data-dash-state="empty">
          <i class="pi pi-filter" aria-hidden="true"></i>
          <div class="body">
            <span>Nothing matches these filters.</span>
          </div>
          <button type="button" class="mf-btn" data-dash-clear (click)="clear.emit()">
            Clear filters
          </button>
        </div>
      }
      @case ('empty') {
        <div class="state state--empty" role="status" data-dash-state="empty">
          <i class="pi pi-inbox" aria-hidden="true"></i>
          <div class="body">
            <span>{{ message() }}</span>
          </div>
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--mf-s3);
    }
    .state {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
      padding: var(--mf-s3) var(--mf-s4);
      border: 1px solid;
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-sm);
    }
    .body {
      flex: 1 1 14rem;
      min-width: 0;
    }
    .body span {
      overflow-wrap: anywhere;
    }
    .state--error {
      color: var(--mf-danger);
      background: var(--mf-danger-bg);
      border-color: var(--mf-danger);
    }
    .state--stale {
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
      border-color: var(--mf-warning);
    }
    .state--empty {
      color: var(--mf-text-muted);
      background: var(--mf-surface);
      border-color: var(--mf-border);
    }
    button {
      min-height: 1.75rem;
      min-width: 1.75rem;
    }
  `,
})
export class DashState {
  readonly variant = input.required<DashStateVariant>();
  /** The text of `error` and `empty`. */
  readonly message = input('');
  /** The time of the figures on screen (`stale`), already formatted for the person. */
  readonly updated = input<string | null>(null);
  readonly retry = output<void>();
  readonly clear = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Puts the keyboard focus on Retry (after a Retry that failed again). */
  focusRetry(): void {
    this.host.nativeElement.querySelector<HTMLElement>('[data-dash-retry]')?.focus();
  }
}

function isShown(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

const FOCUSABLE =
  'a[href], button:not([disabled]):not([aria-disabled="true"]), input:not([disabled]), select:not([disabled]), [tabindex="0"]';

/**
 * Focus rule after the person pressed Retry (P7): when the data arrived, focus goes to the first focusable element of the refreshed content
 * (the tab panel), and when it failed again to the Retry button. A first-load failure or a background failure never moves focus; call this
 * only for a Retry the person pressed.
 */
export function focusAfterRetry(
  scope: HTMLElement,
  injector: Injector,
  outcome: 'ready' | 'failed',
): void {
  afterNextRender(
    () => {
      if (outcome === 'failed') {
        scope.querySelector<HTMLElement>('[data-dash-state="error"] [data-dash-retry]')?.focus();
        return;
      }
      const content = scope.querySelector<HTMLElement>('[role="tabpanel"]') ?? scope;
      const first = Array.from(content.querySelectorAll<HTMLElement>(FOCUSABLE)).find(
        (el) =>
          // A scroll region (focusable only so the keyboard can scroll it) is not the first control of the content.
          !el.matches('[role="region"][tabindex="0"]') &&
          !el.closest('[data-dash-state], [hidden], [inert]') &&
          isShown(el),
      );
      first?.focus();
    },
    { injector },
  );
}
