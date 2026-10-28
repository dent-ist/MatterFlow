import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { StillLoading } from '../../../shared/ui/still-loading';
import { LoadGroup, PanelState } from '../panel-loader';

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
      [class.mmp--bare]="bare()"
      [class.mmp--flat]="flat()"
      [attr.aria-labelledby]="id() + '-h'"
      [attr.aria-busy]="busy() ? 'true' : null"
    >
      <header class="mmp__head">
        <h2 class="mmp__title" [id]="id() + '-h'" tabindex="-1">{{ title() }}</h2>
        <!-- No toolbar while the answer is on its way or has failed: it appears with the data (issue #921), so nothing jumps and nothing offers a choice about a list that is not there. -->
        @if (state() === 'ready') {
          <div class="mmp__actions"><ng-content select="[mfPanelActions]" /></div>
        }
      </header>
      @switch (state()) {
        @case ('loading') {
          <p class="mf-sr-only" role="status" data-loading>Loading {{ title().toLowerCase() }}</p>
          <div class="mmp__sk" aria-hidden="true">
            @for (r of skeletonList(); track $index) {
              <span class="mmp__row"
                ><span class="mmp__bar" [class.mmp__bar--short]="$last"></span
              ></span>
            }
          </div>
          <mf-still-loading (retry)="retry.emit()" />
        }
        @case ('error') {
          @if (group?.many()) {
            <!-- Several sections failed: the page's one banner has the message, the reference and the Retry. -->
            <p class="mmp__muted" data-panel-notloaded>{{ title() }} not loaded.</p>
          } @else {
            <div class="mmp__error" role="alert" data-panel-error>
              <p>Couldn't load {{ title().toLowerCase() }}.</p>
              <mf-error-reference />
              <button type="button" class="mf-btn" data-panel-retry (click)="retry.emit()">
                Retry
              </button>
            </div>
          }
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
    /* A panel with nothing to show (issue #920): no card, no toolbar, the heading and one muted line side by side. */
    .mmp--bare {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0 var(--mf-s3);
      padding: var(--mf-s1) 0;
      border-color: transparent;
      background: transparent;
    }
    .mmp--bare .mmp__head {
      min-height: 0;
      margin: 0;
    }
    .mmp--bare .mmp__title {
      font-size: var(--mf-fs-md);
    }
    .mmp--bare .mmp__actions {
      display: none;
    }
    .mmp--bare ::ng-deep p {
      margin: 0;
      padding: 0;
    }
    /* A section of the calm Overview (issue #903): no card, a heading row with a rule under it, the rows straight below. */
    .mmp--flat {
      height: auto;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
    }
    .mmp--flat .mmp__head {
      /* The Options button of a flat section is a little lower than a form control, so the heading row stays one line of text tall. */
      --mf-options-h: 28px;
      min-height: 28px;
      margin-bottom: 0;
      padding-bottom: var(--mf-s1);
      border-bottom: 1px solid var(--mf-border-strong, var(--mf-border));
    }
    .mmp--flat .mmp__title {
      font-size: var(--mf-fs-md);
      text-transform: none;
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
    }
    /* A placeholder row is as high as the row it stands for (36 px, a card on a phone), so the data do not move the page when they arrive (issue #921). */
    .mmp__row {
      display: flex;
      align-items: center;
      min-height: var(--mmp-row-h, 36px);
    }
    .mmp__bar {
      flex: 1 1 auto;
      height: 14px;
      border-radius: 4px;
      background: var(--mf-border);
    }
    .mmp__muted {
      margin: 0;
      padding: var(--mf-s2) 0;
      color: var(--mf-text-muted);
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
      /* The heading row of a section is as high as its 44 px Options button and View all link from the start, so they do not push the rows down when they appear (issue #921). */
      .mmp--flat .mmp__head {
        min-height: 44px;
      }
      .mmp__row {
        min-height: var(--mmp-row-h-phone, 112px);
      }
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
  /** Nothing to show: the panel draws as one muted line (the panel hides its own toolbar). */
  readonly bare = input(false);
  /** A section of the calm Overview: drawn without the card around it (issue #903). */
  readonly flat = input(false);
  /** How many rows the skeleton stands for (the list's usual length), so its height is the list's. */
  readonly skeleton = input(3);
  readonly retry = output<void>();
  protected readonly group = inject(LoadGroup, { optional: true });
  protected readonly skeletonList = computed(() =>
    Array.from({ length: this.skeleton() }, (_, i) => i),
  );
  protected id(): string {
    return 'mm-' + this.name();
  }
}
