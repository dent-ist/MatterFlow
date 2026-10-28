import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

/**
 * The one Options menu of a list or a tab (`mf-options-menu`, epic #893 issue #894): a single "Options" button that opens a small popover holding everything that
 * is a choice about the list rather than the list itself (Export now; sort, saved views and tab-specific switches as the tabs adopt it). It replaces the row of
 * four or five toolbar controls every list used to carry, and the four different popover styles (a menu, three `details`) that held them.
 *
 * Behaviour, the same everywhere: the button is a native `details` summary (keyboard and screen readers get the disclosure and its expanded state for free); it
 * says "Options" and, when something inside is in force, how many things (the number is also in its accessible name); the popover opens under the button, Escape
 * closes it and returns the focus to the button, a click or Tab outside closes it, and choosing an item marked `data-options-pick` closes it (a download, a copy). Never a shortcut (#420).
 * Put the entries in the default slot.
 *
 *   <mf-options-menu label="Needs my attention" [active]="1"> ...entries... </mf-options-menu>
 */
@Component({
  selector: 'mf-options-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'close(true)',
    '(document:click)': 'outside($event)',
    '(focusout)': 'leave($event)',
    '(click)': 'picked($event)',
  },
  styles: `
    :host {
      position: relative;
      display: inline-block;
    }
    .om__summary {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      min-height: var(--mf-options-h, 32px);
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      cursor: pointer;
      list-style: none;
    }
    .om__summary::-webkit-details-marker {
      display: none;
    }
    .om__summary:hover {
      background: var(--mf-surface-alt);
    }
    .om__n {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.25rem;
      padding: 0 var(--mf-s1);
      border-radius: 999px;
      background: var(--mf-primary);
      color: var(--mf-on-primary, #fff);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
    }
    .om__panel {
      position: absolute;
      z-index: 30;
      top: calc(100% + 2px);
      right: 0;
      display: grid;
      gap: var(--mf-s2);
      min-width: 12rem;
      width: max-content;
      max-width: min(24rem, 90vw);
      box-sizing: border-box;
      padding: var(--mf-s2);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-2, 0 4px 14px rgb(0 0 0 / 0.18));
    }
    /* A menu that holds whole controls (the phone's header menu): as wide as the screen allows, so a full-width switch fits. */
    .om--wide .om__panel {
      grid-template-columns: minmax(0, 1fr);
      width: min(24rem, calc(100vw - 2rem));
      max-width: none;
      max-height: calc(100dvh - 8rem);
      overflow-y: auto;
    }
    @media (max-width: 639.98px) {
      .om__summary {
        min-height: 44px;
      }
    }
  `,
  template: `
    <details #details data-options [class.om--wide]="wide()" (toggle)="toggled($event)">
      <summary
        class="om__summary"
        data-options-trigger
        [attr.aria-label]="
          triggerName() ||
          'Options for ' + label() + (active() > 0 ? ', ' + active() + ' in force' : '')
        "
      >
        <i class="pi" [class]="icon()" aria-hidden="true"></i>
        <span>{{ text() }}</span>
        @if (active() > 0) {
          <span class="om__n" aria-hidden="true" data-options-count>{{ active() }}</span>
        }
      </summary>
      <div class="om__panel" role="group" [attr.aria-label]="label() + ' options'">
        <ng-content />
      </div>
    </details>
  `,
})
export class OptionsMenu {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly details = viewChild<ElementRef<HTMLDetailsElement>>('details');

  /** The list or tab the options belong to ("Needs my attention"): the accessible name of the button and of the popover. */
  readonly label = input.required<string>();
  /** How many of the choices inside differ from the default; shown as a number on the button and said in its name. */
  readonly active = input(0);
  /** The button's words and icon: "Options" everywhere, except the person's Focus, which is the same menu under its own name (issue #919: one popover). */
  readonly text = input('Options');
  readonly icon = input('pi-sliders-h');
  /** The accessible name when the default sentence does not fit ("Focus, 2 task types set"); it must start with the visible words. */
  readonly triggerName = input('');
  /** The popover is as wide as the screen allows (it holds whole controls, such as a full-width switch). */
  readonly wide = input(false);
  /** The popover was opened (a menu that works from a draft starts the draft here). */
  readonly opened = output<void>();

  /** Closes the popover and returns the focus to its button (a menu that has its own Save / Clear buttons). */
  closeAndReturn(): void {
    this.close(true);
  }

  /** Closes the popover; with `back` the focus returns to the button (Escape). */
  protected close(back: boolean): void {
    const details = this.details()?.nativeElement;
    if (!details?.open) return;
    details.open = false;
    if (back) details.querySelector<HTMLElement>('summary')?.focus();
  }

  protected toggled(event: Event): void {
    if ((event.target as HTMLDetailsElement).open) this.opened.emit();
  }

  protected outside(event: Event): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }

  /** Tab (or a click on another control) moves the focus out of the menu: it closes without stealing the focus back. */
  protected leave(event: FocusEvent): void {
    const to = event.relatedTarget as Node | null;
    if (to && !this.host.nativeElement.contains(to)) this.close(false);
  }

  protected picked(event: Event): void {
    if ((event.target as HTMLElement).closest('[data-options-pick]')) this.close(true);
  }
}
