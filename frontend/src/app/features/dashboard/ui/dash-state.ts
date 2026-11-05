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
import { StateBlock } from '../../../shared/ui/state-block';

export type DashStateVariant = 'error' | 'stale' | 'empty-filtered' | 'empty';

/**
 * The one state block of every Dashboard tab (UX review 2, P7):
 *  - `error`: a first load failed. The shared state block (`mf-state-block`, D-51): red triangle, "Couldn't load ...", the error reference when the API sent one, a secondary Retry.
 *  - `stale`: a refresh failed and the figures on screen are older. A banner, `role="status"`: "Couldn't refresh. Showing earlier data." (the time of those figures is its tooltip), Retry.
 *  - `empty-filtered`: filters hide everything; the state block with "Clear Filters" (the sentence can be the tab's own).
 *  - `empty`: nothing to show; the state block with the tab's own message and, optionally, one action that widens the view.
 * It renders inside the tab panel, so the tab row, the Refresh button and the page header stay. Selectors: `[data-dash-state="error|stale|empty"]`
 * and the button `[data-dash-retry]`. The variants are one element at a time (exactly one `role="alert"` is on screen).
 */
@Component({
  selector: 'mf-dash-state',
  imports: [ErrorReference, StateBlock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (variant()) {
      @case ('error') {
        <div role="alert" data-dash-state="error">
          <mf-state-block kind="error" [announce]="false">
            {{ message() }}
            <mf-error-reference mfStateReason />
            <button
              mfStateAction
              type="button"
              class="mf-btn"
              data-dash-retry
              (click)="retry.emit()"
            >
              Retry
            </button>
          </mf-state-block>
        </div>
      }
      @case ('stale') {
        <div
          class="state state--stale"
          role="status"
          data-dash-state="stale"
          [attr.title]="updated() ? 'Figures from ' + updated() : null"
        >
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          <div class="body">
            <span>Couldn't refresh. Showing earlier data.</span>
            <mf-error-reference />
          </div>
          <button type="button" class="mf-btn" data-dash-retry (click)="retry.emit()">Retry</button>
        </div>
      }
      @case ('empty-filtered') {
        <div role="status" data-dash-state="empty">
          <mf-state-block icon="pi-filter">
            {{ filteredText() || 'No results match these filters.' }}
            <button
              mfStateAction
              type="button"
              class="mf-btn"
              data-dash-clear
              (click)="clear.emit()"
            >
              Clear Filters
            </button>
          </mf-state-block>
        </div>
      }
      @case ('empty') {
        <div role="status" data-dash-state="empty">
          <mf-state-block>
            {{ message() }}
            @if (actionLabel(); as label) {
              <button
                mfStateAction
                type="button"
                class="mf-btn"
                data-dash-action
                (click)="action.emit()"
              >
                {{ label }}
              </button>
            }
          </mf-state-block>
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
    .state--stale {
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
      border-color: var(--mf-warning);
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
  /** `empty-filtered`: the tab's own sentence ("No unassigned tasks match these filters.") instead of the default. */
  readonly filteredText = input('');
  /** `empty`: a button that widens what is shown ("Show all pods"). */
  readonly actionLabel = input<string | null>(null);
  /** The time of the figures on screen (`stale`), already formatted for the person. */
  readonly updated = input<string | null>(null);
  readonly retry = output<void>();
  readonly clear = output<void>();
  readonly action = output<void>();

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
