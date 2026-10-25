import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { StillLoading } from '../../../shared/ui/still-loading';
import { PanelState } from '../panel-loader';

/**
 * The frame of every My Matters panel (README 6.9): an `h2` region, a skeleton while the first answer is on its way ("Still loading..."
 * after 8 s, as everywhere), "Couldn't load <name>" with the error reference and Retry, and the content once it is there. Panels load
 * independently, so one failing panel leaves the others alone. The heading's actions (a toggle, Mark all as read) go in `[mfPanelActions]`.
 */
@Component({
  selector: 'mf-mm-panel',
  imports: [ErrorReference, StillLoading],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-panel]': 'name()' },
  template: `
    <section
      class="mmp"
      [attr.aria-labelledby]="id() + '-h'"
      [attr.aria-busy]="busy() ? 'true' : null"
    >
      <header class="mmp__head">
        <h2 class="mmp__title" [id]="id() + '-h'" tabindex="-1">{{ title() }}</h2>
        <div class="mmp__actions"><ng-content select="[mfPanelActions]" /></div>
      </header>
      @switch (state()) {
        @case ('loading') {
          <p class="mf-sr-only" role="status" data-loading>Loading {{ title().toLowerCase() }}</p>
          <div class="mmp__sk" aria-hidden="true">
            <span class="mmp__bar"></span><span class="mmp__bar"></span
            ><span class="mmp__bar mmp__bar--short"></span>
          </div>
          <mf-still-loading (retry)="retry.emit()" />
        }
        @case ('error') {
          <div class="mmp__error" role="alert" data-panel-error>
            <p>Couldn't load {{ title().toLowerCase() }}.</p>
            <mf-error-reference />
            <button type="button" class="mf-btn" data-panel-retry (click)="retry.emit()">
              Retry
            </button>
          </div>
        }
        @default {
          <div class="mmp__body"><ng-content /></div>
        }
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .mmp {
      box-sizing: border-box;
      height: 100%;
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }
    .mmp__head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
      min-height: 32px;
      margin-bottom: var(--mf-s2);
    }
    .mmp__title {
      margin: 0;
      font-size: var(--mf-fs-lg);
      font-weight: 700;
    }
    /* The target of a skip link (#820): the heading takes the focus, with a ring a keyboard user can see. */
    .mmp__title:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .mmp__actions:empty {
      display: none;
    }
    .mmp__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      align-items: center;
    }
    .mmp__sk {
      display: grid;
      gap: var(--mf-s2);
    }
    .mmp__bar {
      height: 14px;
      border-radius: 4px;
      background: var(--mf-border);
    }
    .mmp__bar--short {
      width: 55%;
    }
    .mmp__error p {
      margin: 0 0 var(--mf-s2);
    }
    .mmp__error {
      display: grid;
      gap: var(--mf-s1);
      justify-items: start;
    }
    /* A button the page projects into the heading (a toggle, Mark as read) is a 44 px target on a phone. */
    @media (max-width: 639.98px) {
      :host ::ng-deep .mmp__actions .mf-btn {
        min-height: 44px;
      }
    }
  `,
})
export class PanelBox {
  readonly name = input.required<string>();
  readonly title = input.required<string>();
  readonly state = input.required<PanelState>();
  readonly busy = input(false);
  readonly retry = output<void>();
  protected id(): string {
    return 'mm-' + this.name();
  }
}
